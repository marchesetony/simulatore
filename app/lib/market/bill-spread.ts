import type { StructuredBillExtraction } from "../ingestion/structured-bill";
import type { MarketArchiveRecord } from "./types";

export type BillPunStructure = "MONO" | "F1_F2_F3" | "F1_F23" | "HOURLY";
export type BillSpreadBand = "F0" | "F1" | "F2" | "F3" | "F23";

export interface BillSpreadLine {
  readonly band: BillSpreadBand;
  /** Energy price applied on the bill, in EUR/kWh (null when the bill prints the spread itself). */
  readonly billPrice: number | null;
  /** Official GME PUN of the same months and band, in EUR/kWh. */
  readonly officialPun: number | null;
  readonly spread: number;
  /** The sale-of-energy rows that add up to the applied price (e.g. Prezzo Netto + Contributo sui consumi). */
  readonly components?: readonly { readonly label: string; readonly price: number }[];
}

/** The spread the current supplier applies, never printed on the bill: applied energy price minus the official PUN. */
export interface BillCurrentSpread {
  readonly status: "CALCULATED" | "PUN_MISSING" | "PUN_NOT_PUBLISHED" | "PUN_EXPIRED" | "PRICE_MISSING";
  /** For PUN_NOT_PUBLISHED: the date by which GME publishes the official value. */
  readonly publishedBy?: string;
  readonly structure: BillPunStructure;
  readonly months: readonly string[];
  readonly lines: readonly BillSpreadLine[];
  /** Consumption-weighted spread over the bands, EUR/kWh. */
  readonly spread: number | null;
  /** Official GME PUN of the billed months for the bill's structure (EUR/kWh), weighted on the bill's consumption. */
  readonly referencePun?: number | null;
  /** BILL: the sale-of-energy table prints the spread; CALCULATED: applied price minus official PUN. */
  readonly source?: "BILL" | "CALCULATED";
}

type MarketRates = { readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly monthly: number | null };

const NOT_ENERGY = /rete|trasport|distribu|oneri|arim|asos|\buc\d|dispacciament|perdit|sbilanc|capacit|accis|impost|\biva\b|misura|potenza|\bkw\b(?!h)|quota fissa|pcv|commercializ|spesa per|totale|quota per consumi|quadro sintetico/i;
const PER_KWH = /(€|eur[o]?)\s*\/\s*kwh|\/\s*kwh/i;

function decimal(value: string | null | undefined): number | null {
  if (!value) return null;
  const plain = value.replace(/[^\d,.-]/g, "");
  if (!plain) return null;
  const parsed = Number(plain.includes(",") ? plain.replace(/\./g, "").replace(",", ".") : plain);
  return Number.isFinite(parsed) ? parsed : null;
}
// Bills print energy prices in EUR/kWh; a value above 1 is EUR/MWh.
function perKwh(value: number | null): number | null { return value === null ? null : value > 1 ? value / 1000 : value; }

function bandOf(text: string): BillSpreadBand | null {
  if (/\bF23\b|F2\s*[-+/]\s*F3/i.test(text)) return "F23";
  if (/\bF1\b/i.test(text)) return "F1";
  if (/\bF2\b/i.test(text)) return "F2";
  if (/\bF3\b/i.test(text)) return "F3";
  if (/monorari|fascia unica|\bF0\b/i.test(text)) return "F0";
  return null;
}

const SPREAD_LINE = /spread|maggiorazion|corrispettivo (di |per la )?(vendita|commerciale) variabile|componente commerciale variabile|\balfa\b|\bα\b/i;
const PUN_LINE_CODES = new Set(["PUN_SINGLE", "PUN_F1", "PUN_F2", "PUN_F3", "ENERGY_INDEX"]);
function lineText(line: StructuredBillExtraction["economicChargeLines"][number]): string { return `${line.description} ${line.rawDescription ?? ""}`; }
// Formula tables print the unit once in the header ("prezzo unitario €/kWh"): a row with no unit and a price below 1 is per kWh.
function perKwhLine(line: StructuredBillExtraction["economicChargeLines"][number]): boolean {
  if (PER_KWH.test(`${line.unit} ${line.rawUnit ?? ""} ${line.unitPrice}`)) return true;
  const price = decimal(line.unitPrice);
  return !`${line.unit ?? ""}${line.rawUnit ?? ""}`.trim() && price !== null && price > 0 && price < 1;
}
// Per-kWh seller components billed on top of the index price, part of what the supplier earns on each kWh.
const SELLER_KWH = /contributo (sui|ai) consumi|corrispettivo (di |per la )?vendita|componente (di )?vendita|prezzo nett|prezzo (dell')?energia/i;
const HOURLY = /orari[oa]\b(?!.*(unico|fasc))|pun orario|prezzo orario|su base oraria|per ogni ora/i;
/** The index is applied hour by hour (PUN Index GME orario): consumption is still read in F1, F2, F3. */
export function hourlyIndex(extraction: StructuredBillExtraction): boolean {
  const facts = ["PRICE_TIME_STRUCTURE_RAW", "PRICE_MECHANISM_RAW", "PRICE_FORMULA_RAW", "INDEX_NAME"].map((code) => extraction.extendedFacts.find((item) => item.code === code && item.status === "FOUND")?.value ?? "").join(" ");
  return HOURLY.test(facts) && !/monorari|fascia unica|\bF23\b|biorari/i.test(facts);
}
function isSpreadLine(line: StructuredBillExtraction["economicChargeLines"][number]): boolean { return (line.code === "SPREAD" || line.code === "ENERGY_SPREAD" || SPREAD_LINE.test(lineText(line))) && perKwhLine(line) && !/dispacciament|perdit|capacit/i.test(lineText(line)); }

/** The spread when the sale-of-energy table prints it as its own row (index and markup billed apart). */
export function printedSpread(extraction: StructuredBillExtraction): Partial<Record<BillSpreadBand, { readonly spread: number; readonly quantity: number }>> {
  const result: Partial<Record<BillSpreadBand, { spread: number; quantity: number }>> = {};
  for (const line of extraction.economicChargeLines.filter(isSpreadLine)) {
    const spread = perKwh(decimal(line.unitPrice));
    if (spread === null) continue;
    const band = bandOf(lineText(line)) ?? "F0";
    const quantity = decimal(line.quantity) ?? 0;
    const current = result[band];
    result[band] = current ? { spread: current.quantity + quantity > 0 ? (current.spread * current.quantity + spread * quantity) / (current.quantity + quantity) : spread, quantity: current.quantity + quantity } : { spread, quantity };
  }
  return result;
}

/** The energy price per band the bill applies: stated prices first, then the unit price of the energy lines. */
export function billEnergyPrices(extraction: StructuredBillExtraction): Partial<Record<BillSpreadBand, number>> {
  return billEnergyPriceDetail(extraction).prices;
}
type PriceComponents = Partial<Record<BillSpreadBand, { label: string; price: number }[]>>;
export function billEnergyPriceDetail(extraction: StructuredBillExtraction): { readonly prices: Partial<Record<BillSpreadBand, number>>; readonly components: PriceComponents } {
  // The formula table read from the PDF text layer is the bill itself: it wins over the AI reading.
  const documentRows = (extraction.documentPriceRows ?? []).map((row) => ({ code: "ENERGY_INDEX", description: row.label, quantity: "", unit: "€/kWh", unitPrice: row.unitPrice, amount: "", periodRaw: row.period ?? "", status: "FOUND" }) as StructuredBillExtraction["economicChargeLines"][number]);
  const fromDocument = linePrices(documentRows);
  if (Object.keys(fromDocument.prices).length) return fromDocument;
  const prices: Partial<Record<BillSpreadBand, number>> = {};
  const fact = (code: string) => perKwh(decimal(extraction.extendedFacts.find((item) => item.code === code && item.status === "FOUND")?.value));
  ([["F1", "PRICE_F1"], ["F2", "PRICE_F2"], ["F3", "PRICE_F3"], ["F23", "PRICE_F23"], ["F0", "MONORARIO_PRICE"]] as const).forEach(([band, code]) => { const value = fact(code); if (value !== null && value > 0) prices[band] = value; });
  // An F23 price next to separate F2/F3 prices, or on an hourly index, contradicts the bill: the F23 reading is dropped.
  if (prices.F23 !== undefined && (prices.F2 !== undefined || prices.F3 !== undefined || hourlyIndex(extraction))) delete prices.F23;
  if (Object.keys(prices).length) return { prices, components: {} };
  return linePrices(extraction.economicChargeLines);
}
function linePrices(source: StructuredBillExtraction["economicChargeLines"]): { readonly prices: Partial<Record<BillSpreadBand, number>>; readonly components: PriceComponents } {
  const prices: Partial<Record<BillSpreadBand, number>> = {};
  const components: PriceComponents = {};
  const lines = source.filter((line) => {
    const text = `${line.description} ${line.rawDescription ?? ""}`;
    return perKwhLine(line) && !NOT_ENERGY.test(text) && (PUN_LINE_CODES.has(line.code) || isSpreadLine(line) || SELLER_KWH.test(text) || /energia|materia|prezzo|pun|componente|quota (variabile|energia)|F[0-3]/i.test(text));
  });
  const sums = new Map<BillSpreadBand, { amount: number; quantity: number; price: number | null; unitSum: number; quantities: Set<number> }>();
  for (const line of lines) {
    const band = bandOf(`${line.description} ${line.rawDescription ?? ""}`) ?? "F0";
    const price = perKwh(decimal(line.unitPrice));
    const quantity = decimal(line.quantity) ?? 0;
    const amount = decimal(line.amount) ?? (price !== null ? price * quantity : 0);
    const current = sums.get(band) ?? { amount: 0, quantity: 0, price: null, unitSum: 0, quantities: new Set<number>() };
    // Index and markup rows bill the same kWh: those kWh count once.
    const repeated = current.quantities.has(quantity);
    current.quantities.add(quantity);
    sums.set(band, { amount: current.amount + amount, quantity: current.quantity + (repeated ? 0 : quantity), price: current.price ?? price, unitSum: current.unitSum + (price ?? 0), quantities: current.quantities });
    if (price !== null) (components[band] ??= []).push({ label: line.description || line.rawDescription || line.code, price });
  }
  // Several lines of one band (PUN and its markup printed apart) add up to the price applied to each kWh;
  // a formula table prints only unit prices, which then add up directly.
  sums.forEach((value, band) => { const price = value.quantity > 0 && value.amount > 0 ? value.amount / value.quantity : value.unitSum > 0 ? value.unitSum : value.price; if (price !== null && price > 0) prices[band] = price; });
  return { prices, components };
}

function ratesFor(records: readonly MarketArchiveRecord[], month: string, isOfficial: (record: MarketArchiveRecord) => boolean): MarketRates | null {
  const candidate = records.filter((record) => record.status === "APPROVED" && record.vector === "EE" && record.index === "PUN" && record.month === month && isOfficial(record)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!candidate || candidate.record.vector !== "EE") return null;
  const market = candidate.record;
  const rate = (value: { readonly value: number } | undefined) => value && Number.isFinite(value.value) ? value.value / 1000 : null;
  return { f1: rate(market.f1), f2: rate(market.f2), f3: rate(market.f3), monthly: rate(market.monthly) };
}
function average(values: readonly (number | null)[]): number | null { const known = values.filter((value): value is number => value !== null); return known.length === values.length && known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null; }
function weighted(pairs: readonly (readonly [number | null, number])[]): number | null {
  if (pairs.some(([value]) => value === null)) return null;
  const weight = pairs.reduce((sum, [, w]) => sum + w, 0);
  return weight > 0 ? pairs.reduce((sum, [value, w]) => sum + (value as number) * w, 0) / weight : average(pairs.map(([value]) => value));
}

/** GME publishes the official PUN of a month by the 10th of the next one; the archive keeps about five closed months. */
export const PUN_PUBLICATION_DAY = 10;
export const PUN_ARCHIVE_MONTHS = 5;
function addMonths(month: string, count: number): string { const [year, number] = month.split("-").map(Number); return new Date(Date.UTC(year, number - 1 + count, 1)).toISOString().slice(0, 7); }
function missingReason(month: string, asOf: string): Pick<BillCurrentSpread, "status" | "publishedBy"> {
  const publishedBy = `${addMonths(month, 1)}-${String(PUN_PUBLICATION_DAY).padStart(2, "0")}`;
  if (asOf < publishedBy) return { status: "PUN_NOT_PUBLISHED", publishedBy };
  if (month < addMonths(asOf.slice(0, 7), -PUN_ARCHIVE_MONTHS)) return { status: "PUN_EXPIRED" };
  return { status: "PUN_MISSING" };
}

export function estimateBillSpread(extraction: StructuredBillExtraction | null, months: readonly string[], records: readonly MarketArchiveRecord[], isOfficial: (record: MarketArchiveRecord) => boolean, asOf = new Date().toISOString().slice(0, 10)): BillCurrentSpread | null {
  if (!extraction || extraction.vector.value !== "EE" || months.length === 0) return null;
  const kwh = (field: StructuredBillExtraction["f1Consumption"]) => field.status === "FOUND" && typeof field.value === "number" ? field.value : 0;
  const consumption = { F1: kwh(extraction.f1Consumption), F2: kwh(extraction.f2Consumption), F3: kwh(extraction.f3Consumption) };
  // A printed markup row is the spread only when the index itself is billed on its own row; otherwise
  // (e.g. "Prezzo Netto" + "Contributo sui consumi") the spread is the applied price minus the official PUN.
  const indexRow = extraction.economicChargeLines.some((line) => PUN_LINE_CODES.has(line.code) || /\bpun\b|indice|index/i.test(lineText(line)));
  const printed = indexRow ? printedSpread(extraction) : {};
  const printedBands = Object.keys(printed) as BillSpreadBand[];
  if (printedBands.length) {
    const lines = printedBands.map((band) => ({ band, billPrice: null, officialPun: null, spread: printed[band]!.spread }));
    const structure: BillPunStructure = printedBands.includes("F23") ? "F1_F23" : printedBands.some((band) => band === "F2" || band === "F3") ? "F1_F2_F3" : "MONO";
    return { status: "CALCULATED", source: "BILL", structure, months, lines, spread: weighted(printedBands.map((band) => [printed[band]!.spread, printed[band]!.quantity] as const)) };
  }
  const { prices, components } = billEnergyPriceDetail(extraction);
  const structure: BillPunStructure = prices.F23 !== undefined ? "F1_F23" : prices.F1 !== undefined && (prices.F2 !== undefined || prices.F3 !== undefined) ? "F1_F2_F3" : hourlyIndex(extraction) ? "HOURLY" : "MONO";
  const monthly = months.map((month) => ratesFor(records, month, isOfficial));
  const empty = { structure, months, lines: [], spread: null };
  const absent = months.find((_, index) => monthly[index] === null);
  if (absent) return { ...missingReason(absent, asOf), ...empty };
  const rates = monthly as MarketRates[];
  const pun = {
    F1: average(rates.map((rate) => rate.f1)), F2: average(rates.map((rate) => rate.f2)), F3: average(rates.map((rate) => rate.f3)),
    // GME does not publish F23: the F2 and F3 values weighted by the bill's own consumption.
    F23: average(rates.map((rate) => weighted([[rate.f2, consumption.F2], [rate.f3, consumption.F3]]))),
    F0: average(rates.map((rate) => rate.monthly ?? weighted([[rate.f1, consumption.F1], [rate.f2, consumption.F2], [rate.f3, consumption.F3]]))),
  };
  // Hourly index: the hourly PUN follows the customer's profile, approximated by the F1/F2/F3 PUN weighted on the bill's own consumption.
  const profiled = average(rates.map((rate) => consumption.F1 + consumption.F2 + consumption.F3 > 0 ? weighted([[rate.f1, consumption.F1], [rate.f2, consumption.F2], [rate.f3, consumption.F3]]) : null));
  if (structure === "HOURLY" && profiled !== null) pun.F0 = profiled;
  const referencePun = structure === "MONO" || structure === "HOURLY" ? pun.F0 : weighted([[pun.F1, consumption.F1], [pun.F2, consumption.F2], [pun.F3, consumption.F3]]) ?? pun.F0;
  const bands: readonly BillSpreadBand[] = structure === "F1_F23" ? ["F1", "F23"] : structure === "F1_F2_F3" ? (["F1", "F2", "F3"] as const).filter((band) => prices[band] !== undefined) : ["F0"];
  const lines: BillSpreadLine[] = [];
  for (const band of bands) {
    const billPrice = prices[band];
    const officialPun = pun[band];
    if (billPrice === undefined || officialPun === null) continue;
    const parts = components[band];
    lines.push({ band, billPrice, officialPun, spread: billPrice - officialPun, ...(parts && parts.length > 1 ? { components: parts } : {}) });
  }
  if (!lines.length) return { status: officialPunMissing(bands, pun) ? "PUN_MISSING" : "PRICE_MISSING", ...empty, referencePun };
  const weightOf = (band: BillSpreadBand) => band === "F23" ? consumption.F2 + consumption.F3 : band === "F0" ? consumption.F1 + consumption.F2 + consumption.F3 : consumption[band];
  return { status: "CALCULATED", source: "CALCULATED", structure, months, lines, referencePun, spread: weighted(lines.map((line) => [line.spread, weightOf(line.band)] as const)) };
}
function officialPunMissing(bands: readonly BillSpreadBand[], pun: Record<BillSpreadBand, number | null>): boolean { return bands.every((band) => pun[band] === null); }
