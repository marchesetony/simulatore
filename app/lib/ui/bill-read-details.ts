import type { BillDocumentModel } from "./models";
import type { StructuredBillEconomicChargeLine, StructuredBillField } from "../ingestion/structured-bill";
import type { SupplyProfileField } from "../ingestion/bill-supply-profile";
import { BANDS_SUM_TOLERANCE_KWH } from "../reading/bill-reader-checks";
import { formatKwh } from "./format";

// Tony (10/11/2026, fattura EE20369/2026: the 17 values were read and saved but "Dati letti" did not show them): the screen
// shows what the reading already holds, in four sections. A value read from the bill is shown as read; a value the reader
// says is not printed is "Non presente nella fattura"; a value the reading marked uncertain is "Da verificare"; a sum or a
// difference made here is labelled as calculated. Nothing is read again and nothing is inferred.

export type BillReadState = "READ" | "ABSENT" | "REVIEW" | "CALCULATED" | "NOT_READ";
export interface BillReadRow {
  readonly label: string; readonly value: string; readonly state: BillReadState; readonly note?: string;
  /** Tony (10/11/2026, "ottimizzazione grafica"): shown under "Altri dettagli" of its section, never dropped. */
  readonly secondary?: boolean;
  /** The note is part of the value (a gap, a mismatch): shown next to it, not only on demand. */
  readonly noteShown?: boolean;
  /** "SIMULATOR": the simulator's own grouping where it differs from the bill, listed apart in its section. */
  readonly group?: "SIMULATOR";
}
export type BillReadSectionId = "SUPPLY" | "TECHNICAL" | "CONTRACT" | "ECONOMICS";
export interface BillReadSection { readonly id: BillReadSectionId; readonly title: string; readonly rows: readonly BillReadRow[]; readonly note?: string }

export const NOT_IN_BILL = "Non presente nella fattura";
export const TO_CHECK = "Da verificare";
export const NOT_READ = "Non letto";

type Bill = Pick<BillDocumentModel, "fields" | "structuredBill" | "analystReview" | "resolvedVector">;

/** "2672.07" → "2.672,07": the decimals the bill printed, Italian separators, no rounding. */
export function italianDecimal(value: number): string {
  const [whole, fraction] = String(Math.abs(value)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}${grouped}${fraction ? `,${fraction}` : ""}`;
}
const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const euro = (value: number): string => EURO.format(value);
const round2 = (value: number) => Math.round(value * 100) / 100;
/** "1.234,56 €" / "1234.56" / "0,49" → number; null when the text holds no number. */
function amountOf(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[€\s]/g, "").replace(/[−–]/g, "-").replace(/[^\d.,+-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : /^[+-]?\d{1,3}(\.\d{3})+$/.test(cleaned) ? cleaned.replace(/\./g, "") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
const italianDate = (value: string): string => { const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()); return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value.trim(); };
const unitText = (unit: string) => unit.replace(/\bKWH\b/gi, "kWh").replace(/\bKW\b/g, "kW").replace(/^Euro\//i, "€/").replace(/^EUR\//, "€/");

function absentReason(bill: Bill, ...fields: readonly string[]): string | null {
  const found = bill.structuredBill?.readingAbsent?.find((item) => fields.includes(item.field));
  return found ? found.reason : null;
}
/** A row from a value, the reader's "not printed" list, or nothing read. */
function row(bill: Bill, label: string, value: string | null, absentFields: readonly string[], options: { readonly review?: boolean; readonly note?: string } = {}): BillReadRow {
  if (value && value.trim()) return options.review ? { label, value: value.trim(), state: "REVIEW", note: options.note ? `${TO_CHECK}: ${options.note}` : TO_CHECK } : { label, value: value.trim(), state: "READ", ...(options.note ? { note: options.note } : {}) };
  const reason = absentReason(bill, ...absentFields);
  if (reason !== null) return { label, value: NOT_IN_BILL, state: "ABSENT", note: reason };
  return { label, value: NOT_READ, state: "NOT_READ" };
}
const fieldText = <T>(field: StructuredBillField<T> | undefined | null): string | null => field && (field.status === "FOUND" || field.status === "NEEDS_REVIEW") && field.value !== null && field.value !== undefined ? String(field.value) : null;
const needsReview = (field: { readonly status: string } | undefined | null) => field?.status === "NEEDS_REVIEW";
function fact(bill: Bill, ...codes: readonly string[]): { readonly value: string; readonly review: boolean } | null {
  for (const code of codes) {
    const found = bill.structuredBill?.extendedFacts.find((item) => item.code === code && (item.status === "FOUND" || item.status === "NEEDS_REVIEW") && item.value.trim() && !/^NOT_FOUND$/i.test(item.value.trim()));
    if (found) return { value: found.value.trim(), review: found.status === "NEEDS_REVIEW" };
  }
  return null;
}
const profileText = (field: SupplyProfileField | undefined) => field && (field.status === "FOUND" || field.status === "NEEDS_REVIEW") && field.rawValue?.trim() ? field.rawValue.trim() : null;
// Tony (11/11/2026): kWh without decimals; Smc as printed.
const kwh = (field: StructuredBillField<number> | undefined, unit = "kWh") => { const text = fieldText(field); return text === null ? null : unit === "kWh" ? formatKwh(Number(text)) : `${italianDecimal(Number(text))} ${unit}`; };
// The F1 + F2 + F3 gap is a consistency check, not a consumption: two decimals (Tony, 11/11/2026).
const GAP = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const lines = (bill: Bill, ...codes: readonly string[]): readonly StructuredBillEconomicChargeLine[] => (bill.structuredBill?.economicChargeLines ?? []).filter((line) => codes.includes(line.code));
const sumOf = (items: readonly StructuredBillEconomicChargeLine[]): number | null => { const values = items.map((line) => amountOf(line.rawAmount || line.amount)).filter((value): value is number => value !== null); return values.length ? round2(values.reduce((total, value) => total + value, 0)) : null; };

function supplySection(bill: Bill): BillReadSection {
  const sb = bill.structuredBill;
  const profile = sb?.supplyProfile ?? bill.analystReview.supplyProfile ?? undefined;
  const gas = bill.resolvedVector === "GAS";
  const address = bill.analystReview.supply.address;
  const place = [address.value, bill.analystReview.supply.cap.value, bill.analystReview.supply.city.value, bill.analystReview.supply.province.value].filter((item) => item && String(item).trim()).join(" ");
  const use = profileText(profile?.supplyUseCategory);
  const period = fact(bill, "BILLING_PERIOD_RAW")?.value ?? (sb?.billingPeriod.value ? `${italianDate(sb.billingPeriod.value.from)} - ${italianDate(sb.billingPeriod.value.to)}` : null);
  const rows: BillReadRow[] = [
    row(bill, "Intestatario", fieldText(sb?.customerName) ?? bill.fields.customerName?.value ?? null, ["intestatario"], { review: needsReview(sb?.customerName) }),
    row(bill, "Fornitore attuale", fieldText(sb?.supplier) ?? bill.fields.supplier?.value ?? null, ["fornitore"], { review: needsReview(sb?.supplier) }),
    gas ? row(bill, "PDR", fieldText(sb?.pdr), ["pdr"], { review: needsReview(sb?.pdr) }) : row(bill, "POD", fieldText(sb?.pod), ["pod"], { review: needsReview(sb?.pod) }),
    // The reader does not ask for the supply address: the row appears only on bills that carry it.
    ...(place ? [row(bill, "Indirizzo della fornitura", place, [], { review: address.status === "NEEDS_REVIEW" })] : []),
    use && /dedott/i.test(use)
      ? { label: "Tipologia cliente", value: use.replace(/\s*\(dedott[oa] dalla bolletta\)/i, ""), state: "CALCULATED" as const, note: "Dedotta dagli altri dati della bolletta, non stampata" }
      : row(bill, "Tipologia cliente", use, ["tipoClienteStampato", "tipoCliente"], { review: profile?.supplyUseCategory.status === "NEEDS_REVIEW" }),
    row(bill, "Mercato", profileText(profile?.marketRegime) ?? fact(bill, "MARKET_REGIME_RAW")?.value ?? null, ["mercato"]),
    row(bill, "Periodo fatturato", period, ["periodoStampato", "periodoDal", "periodoAl"], { review: needsReview(sb?.billingPeriod) }),
  ];
  return { id: "SUPPLY", title: "Identificazione fornitura", rows };
}

// Without a billed total the sum of the bands is the only total: it stays in view.
const gapUnknown = (note: string) => / \(calcolata\)$/.test(note);

function technicalSection(bill: Bill): BillReadSection {
  const sb = bill.structuredBill;
  const profile = sb?.supplyProfile ?? bill.analystReview.supplyProfile ?? undefined;
  const gas = bill.resolvedVector === "GAS";
  const rows: BillReadRow[] = [];
  if (!gas) {
    const printed = profileText(profile?.nominalVoltage) ?? fact(bill, "NOMINAL_VOLTAGE")?.value ?? null;
    const level = fieldText(sb?.voltageLevel);
    const levelText = level === "LV" ? "bassa tensione (BT)" : level === "MV" ? "media tensione (MT)" : level === "HV" ? "alta tensione (AT)" : null;
    rows.push(row(bill, "Tensione di alimentazione", printed ? `${printed}${levelText ? ` · ${levelText}` : ""}` : levelText ? levelText.charAt(0).toUpperCase() + levelText.slice(1) : null, ["tensioneStampata", "livelloTensione"], { review: needsReview(sb?.voltageLevel) }));
    const power = (field: SupplyProfileField | undefined) => { const text = profileText(field); return text ? unitText(text) : null; };
    const committed = power(profile?.powerCommitted) ?? (fieldText(sb?.powerKw) ? `${italianDecimal(Number(fieldText(sb?.powerKw)))} kW` : null);
    rows.push(row(bill, "Potenza impegnata", committed, ["potenzaImpegnataKw"], { review: profile?.powerCommitted.status === "NEEDS_REVIEW" }));
    rows.push(row(bill, "Potenza disponibile", power(profile?.powerAvailable), ["potenzaDisponibileKw"], { review: profile?.powerAvailable.status === "NEEDS_REVIEW" }));
    rows.push(row(bill, "Potenza massima prelevata", power(profile?.powerMaximumDrawn), ["potenzaMassimaPrelevataKw"], { review: profile?.powerMaximumDrawn.status === "NEEDS_REVIEW" }));
  }
  const billedRow = row(bill, "Consumo complessivo fatturato", gas ? kwh(sb?.smcConsumption, "Smc") ?? kwh(sb?.billedConsumption, "Smc") : kwh(sb?.billedConsumption), gas ? ["consumoSmc", "consumoFatturato"] : ["consumoFatturato"], { review: needsReview(sb?.billedConsumption) });
  const bandRows: BillReadRow[] = [];
  let bandNote: string | null = null;
  let bandWarning = false;
  if (!gas) {
    const bands = [sb?.f1Consumption, sb?.f2Consumption, sb?.f3Consumption] as const;
    bands.forEach((field, index) => bandRows.push(row(bill, `Consumo F${index + 1}`, kwh(field), [`consumoF${index + 1}`], { review: needsReview(field) })));
    // Tony (10/11, F1+F2+F3 = 2.672,08 against F0 2.672,07): the read values stay as printed. Tony (10/11, "semplificazione"):
    // the sum is not a second total; a gap from the billed consumption is a discreet note on it. The calculation keeps using
    // F1, F2 and F3 (structured-bill.ts), unchanged.
    const values = bands.map((field) => fieldText(field)).map((text) => text === null ? null : Number(text));
    if (values.every((value): value is number => value !== null && Number.isFinite(value))) {
      const decimals = Math.max(...values.map((value) => (String(value).split(".")[1] ?? "").length));
      const sum = Number(values.reduce((total, value) => total + value, 0).toFixed(decimals));
      const billedText = fieldText(sb?.billedConsumption);
      const gap = billedText === null ? null : Number((sum - Number(billedText)).toFixed(decimals));
      // Tony (11/11/2026, "pulizia finale"): a gap within the tolerance of the reading check (BANDS_SUM, 1 kWh) is no longer
      // written next to F0, it stays available on the value; a gap above it stays in view as a warning.
      if (gap === null) bandNote = `F1 + F2 + F3 = ${formatKwh(sum)} (calcolata)`;
      else if (Math.abs(gap) > BANDS_SUM_TOLERANCE_KWH) { bandNote = `Attenzione: F1 + F2 + F3 = ${formatKwh(sum)}, scostamento di ${GAP.format(gap)} kWh dal consumo totale, oltre la tolleranza di ${italianDecimal(BANDS_SUM_TOLERANCE_KWH)} kWh (calcolato)`; bandWarning = true; }
      else if (gap !== 0) bandNote = `F1 + F2 + F3 = ${formatKwh(sum)}, scostamento ${GAP.format(gap)} kWh entro la tolleranza (calcolato)`;
    }
  }
  rows.push(bandNote ? { ...billedRow, note: billedRow.note ? `${billedRow.note} · ${bandNote}` : bandNote, ...(bandWarning || gapUnknown(bandNote) ? { noteShown: true } : {}) } : billedRow, ...bandRows);
  rows.push(row(bill, "Consumo annuo dichiarato", kwh(sb?.annualConsumption, gas ? "Smc" : "kWh"), ["consumoAnnuo"], { review: needsReview(sb?.annualConsumption) }));
  return { id: "TECHNICAL", title: "Caratteristiche tecniche", rows };
}

const COMMERCIAL_CODES = ["COMMERCIALIZATION_VARIABLE_FEE", "OTHER_SELLER_ENERGY_CHARGE", "OTHER_SELLER_FIXED_CHARGE", "SELLER_ENERGY_FEE", "SELLER_FIXED", "COMMERCIALIZATION"] as const;
const PCV_CODES = ["PCV", "COMMERCIALIZATION_FIXED_FEE", "SELLER_FIXED_FEE"] as const;
function lineText(line: StructuredBillEconomicChargeLine): string {
  const price = (line.rawUnitPrice || line.unitPrice).trim();
  const unit = unitText((line.rawUnit || line.unit).trim());
  const amount = amountOf(line.rawAmount || line.amount);
  return [price ? `${price}${unit ? ` ${unit}` : ""}` : "", amount === null ? "" : `importo ${euro(amount)}`].filter(Boolean).join(" · ");
}

// Tony (11/11/2026, "pulizia finale"): the PCV is shown as a monthly amount with two decimals ("10,39 €/mese"); the unit price
// as printed ("10,392500 €/POD/mese · importo 10,39 €") stays under "Altri dettagli". Only a single monthly PCV is rounded.
const PER_MONTH = /\/\s*(?:pod\s*\/\s*)?mese\b|al\s+mese|mensil/i;
function pcvRows(bill: Bill, pcvLines: readonly StructuredBillEconomicChargeLine[], pcvFact: { readonly value: string; readonly review: boolean } | null, pcvUnit: string | undefined): BillReadRow[] {
  const PRINTED = "PCV stampata (valore unitario)";
  if (pcvLines.length) {
    const printed: BillReadRow = { label: "PCV / commercializzazione", value: pcvLines.map(lineText).join("; "), state: "READ", note: pcvLines.map((line) => line.rawDescription || line.description).join("; ") };
    const single = pcvLines.length === 1 ? pcvLines[0] : null;
    const price = single ? amountOf(single.rawUnitPrice || single.unitPrice) : null;
    if (!single || price === null || !PER_MONTH.test(single.rawUnit || single.unit)) return [printed];
    return [{ ...printed, value: `${euro(round2(price))}/mese` }, { ...printed, label: PRINTED }];
  }
  const printed = row(bill, "PCV / commercializzazione", pcvFact ? `${pcvFact.value}${pcvUnit ? ` ${unitText(pcvUnit)}` : ""}` : null, ["pcvMensile"], { review: pcvFact?.review });
  const price = pcvFact ? amountOf(pcvFact.value) : null;
  if (!pcvFact || price === null || !pcvUnit || !PER_MONTH.test(pcvUnit)) return [printed];
  return [{ ...printed, value: `${euro(round2(price))}/mese` }, { ...printed, label: PRINTED }];
}

function contractSection(bill: Bill, calculated: readonly BillReadRow[]): BillReadSection {
  const sb = bill.structuredBill;
  const box = sb?.documentOfferBox ?? null;
  const name = fieldText(sb?.offerName) ?? sb?.documentOfferName ?? null;
  const code = fieldText(sb?.offerCode);
  const conditionsExpiry = fact(bill, "ECONOMIC_EXPIRY")?.value ?? box?.economicConditionsExpiry ?? null;
  const contractEnd = fact(bill, "CONTRACT_INDEFINITE", "CONTRACT_EXPIRY")?.value ?? box?.contractExpiry ?? null;
  const pcvLines = lines(bill, ...PCV_CODES);
  const pcvFact = fact(bill, "PCV", "COMMERCIALIZATION_FIXED_FEE", "SELLER_FIXED_FEE");
  const pcvUnit = bill.structuredBill?.extendedFacts.find((item) => item.code === "PCV")?.unit;
  const rows: BillReadRow[] = [
    row(bill, "Offerta", name ? (code && code !== name ? `${name} · codice ${code}` : name) : code, ["offertaNome", "offertaCodice"]),
    row(bill, "Attivazione fornitura", fact(bill, "CONTRACT_START_DATE")?.value ? italianDate(fact(bill, "CONTRACT_START_DATE")!.value) : null, ["attivazioneFornitura"]),
    row(bill, "Decorrenza condizioni economiche", (fact(bill, "ECONOMIC_CONDITIONS_START_DATE")?.value ?? box?.economicConditionsStart) ? italianDate((fact(bill, "ECONOMIC_CONDITIONS_START_DATE")?.value ?? box?.economicConditionsStart)!) : null, ["decorrenzaCondizioni"]),
    // Tony (10/11): conditions without an end date, a contract without an end date and a missing date are three different things.
    row(bill, "Scadenza condizioni economiche", conditionsExpiry ? /indetermin/i.test(conditionsExpiry) ? "Condizioni economiche a tempo indeterminato" : italianDate(conditionsExpiry) : null, ["scadenzaCondizioni"]),
    row(bill, "Scadenza contratto", contractEnd ? /indetermin/i.test(contractEnd) ? "Contratto a tempo indeterminato" : italianDate(contractEnd) : null, ["scadenzaContratto"]),
    row(bill, "Tipologia prezzo", fact(bill, "PRICE_MECHANISM_RAW")?.value ?? box?.offerType ?? null, ["tipologiaOfferta"]),
    row(bill, "Struttura del prezzo", fact(bill, "PRICE_TIME_STRUCTURE_RAW")?.value ?? box?.priceStructure ?? null, ["tipologiaPrezzo"]),
    row(bill, "Indice", fact(bill, "INDEX_NAME")?.value ?? box?.indexName ?? null, ["indice"]),
    // Tony (10/11): the printed spread is shown as printed, never replaced by the one calculated from the PUN.
    row(bill, "Spread contrattuale (stampato)", fact(bill, "SPREAD")?.value ?? box?.spread ?? null, ["spread"]),
    ...pcvRows(bill, pcvLines, pcvFact, pcvUnit),
    ...lines(bill, ...COMMERCIAL_CODES).map((line): BillReadRow => ({ label: line.rawDescription || line.description, value: lineText(line), state: line.status === "NEEDS_REVIEW" ? "REVIEW" : "READ", note: line.status === "NEEDS_REVIEW" ? TO_CHECK : "Altro corrispettivo commerciale letto" })),
    ...calculated,
  ];
  return { id: "CONTRACT", title: "Contratto e condizioni economiche attuali", rows };
}

function economicsSection(bill: Bill): BillReadSection {
  const totals = bill.analystReview.economics.economicAnalysis?.totals;
  const printed = totals?.printedSummary;
  const sb = bill.structuredBill;
  const oneriLines = lines(bill, "ASOS", "ARIM");
  const oneri = sumOf(oneriLines);
  const excise = sumOf(lines(bill, "EXCISE"));
  const vat = sumOf(lines(bill, "VAT"));
  const printedTotal = sumOf(lines(bill, "BILL_TOTAL")) ?? (fieldText(sb?.totalAmount) === null ? null : Number(fieldText(sb?.totalAmount)));
  const money = (label: string, value: number | null, note?: string): BillReadRow => value === null ? { label, value: NOT_IN_BILL, state: "ABSENT", note: "Non letto come voce separata" } : { label, value: euro(value), state: "READ", ...(note ? { note } : {}) };
  const calc = (label: string, value: number, note: string): BillReadRow => ({ label, value: euro(value), state: "CALCULATED", note });
  const rows: BillReadRow[] = [];
  // Original values: the quadro sintetico as printed and the detail rows as printed.
  rows.push(money("Spesa per la vendita di energia", printed?.seller ?? null, "Quadro sintetico: somma dei \"di cui spesa per la vendita\""));
  if (printed?.networkAndSystem != null) {
    rows.push(money("Spesa per la rete e gli oneri generali di sistema", printed.networkAndSystem, "Quadro sintetico, come stampato (rete e oneri insieme)"));
    if (oneri !== null) rows.push(calc("di cui spesa per la rete e il trasporto", round2(printed.networkAndSystem - oneri), "Calcolata: rete e oneri stampati meno gli oneri ASOS e ARIM del dettaglio"));
  } else rows.push(money("Spesa per la rete e gli oneri generali di sistema", null));
  rows.push(oneri === null ? money("Oneri generali di sistema", null) : { label: "Oneri generali di sistema", value: euro(oneri), state: "CALCULATED", note: `Somma delle ${oneriLines.length} righe ASOS e ARIM stampate nel dettaglio` });
  rows.push(money("Accise", excise, "Righe di accisa del dettaglio"));
  rows.push(money("IVA", vat, "Righe IVA del dettaglio"));
  if (excise === null && vat === null && printed?.taxes != null) rows.push(money("Accise e IVA", printed.taxes, "Quadro sintetico, come stampato (insieme)"));
  const taxes = excise !== null || vat !== null ? (excise ?? 0) + (vat ?? 0) : printed?.taxes ?? null;
  // Tony (10/11, "semplificazione"): the total appears once; the sum of the printed components is a note on it only when it
  // does not match.
  let totalNote: string | null = null;
  if (printed?.seller != null && printed.networkAndSystem != null && taxes !== null && printedTotal !== null) {
    const gap = round2(round2(printed.seller + printed.networkAndSystem + taxes) - printedTotal);
    if (gap !== 0) totalNote = `Le componenti stampate sommano ${euro(round2(printed.seller + printed.networkAndSystem + taxes))}: differenza di ${euro(gap)} (altre partite, bonus o canone non inclusi; calcolata)`;
  }
  rows.push(printedTotal === null ? { label: "Totale fatturato", value: NOT_IN_BILL, state: "ABSENT" } : { label: "Totale fatturato", value: euro(printedTotal), state: "READ", ...(totalNote ? { note: totalNote } : {}) });
  // The simulator's own grouping, shown apart and labelled, only where it differs from what the bill prints (Tony, 10/11,
  // "solo le differenze rilevanti"): it may place a seller charge printed under rete elsewhere.
  const normalized: BillReadRow[] = [];
  if (totals) {
    const seller = [totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal].filter((value): value is number => value !== null);
    const network = printed?.networkAndSystem != null && oneri !== null ? round2(printed.networkAndSystem - oneri) : null;
    const add = (label: string, value: number | null, printedValue: number | null | undefined) => {
      if (value === null || (printedValue !== null && printedValue !== undefined && Math.abs(round2(value - printedValue)) < 0.01)) return;
      normalized.push({ label: `${label} (classificazione del simulatore)`, value: euro(value), state: "CALCULATED", note: printedValue === null || printedValue === undefined ? "Raggruppamento normalizzato delle righe lette, non stampato in fattura" : `Raggruppamento normalizzato delle righe lette: in fattura ${euro(printedValue)}` });
    };
    add("Vendita", seller.length ? round2(seller.reduce((total, value) => total + value, 0)) : null, printed?.seller);
    add("Rete e trasporto", totals.regulatedNetworkTotal, network);
    add("Oneri generali di sistema", totals.systemChargesTotal, oneri);
    add("Accise e IVA", totals.taxTotal, taxes);
  }
  return { id: "ECONOMICS", title: "Ripartizione economica della fattura", rows: [...rows, ...normalized], ...(normalized.length ? { note: "Le righe marcate \"classificazione del simulatore\" sono il raggruppamento usato per il confronto dove differisce dalla fattura; le altre sono i valori stampati." } : {}) };
}

/** What the bill prints for the contract, so the screen adds a simulator value only where the bill does not print it or prints
 *  something else (Tony, 10/11/2026, "semplificazione"). */
export function printedContractValues(bill: Bill): { readonly priceType: string | null; readonly priceStructure: string | null; readonly spread: string | null; readonly monthlyPcv: number | null } {
  const box = bill.structuredBill?.documentOfferBox ?? null;
  const perMonth = /mese|month/i;
  const pcvLine = lines(bill, ...PCV_CODES).find((line) => perMonth.test(`${line.rawUnit || line.unit}`) && amountOf(line.rawUnitPrice || line.unitPrice) !== null);
  const pcvFact = fact(bill, "PCV", "COMMERCIALIZATION_FIXED_FEE", "SELLER_FIXED_FEE");
  const pcvUnit = bill.structuredBill?.extendedFacts.find((item) => item.code === "PCV")?.unit ?? "";
  const monthlyPcv = pcvLine ? amountOf(pcvLine.rawUnitPrice || pcvLine.unitPrice) : pcvFact && (!pcvUnit || perMonth.test(pcvUnit)) ? amountOf(pcvFact.value) : null;
  return {
    priceType: fact(bill, "PRICE_MECHANISM_RAW")?.value ?? box?.offerType ?? null,
    priceStructure: fact(bill, "PRICE_TIME_STRUCTURE_RAW")?.value ?? box?.priceStructure ?? null,
    spread: fact(bill, "SPREAD")?.value ?? box?.spread ?? null,
    monthlyPcv,
  };
}

/** Tony (11/11/2026, "pulizia finale"): the simulator's customer segment repeats the use printed on the bill ("altri usi" →
 *  Business, "domestico" → Consumer); then it moves under "Altri dettagli". A segment that differs from the use stays in view. */
export function segmentRepeatsUse(bill: Bill, segment: "RESIDENTIAL" | "NON_RESIDENTIAL" | null): boolean {
  const profile = bill.structuredBill?.supplyProfile ?? bill.analystReview.supplyProfile ?? undefined;
  const use = profile?.supplyUseCategory;
  if (!segment || !use || !profileText(use)) return false;
  return segment === "RESIDENTIAL" ? use.normalizedValue === "DOMESTIC" : ["OTHER_USE", "PUBLIC_LIGHTING", "PUBLIC_EV_CHARGING"].includes(use.normalizedValue);
}

/** The bill as "Dati letti" reads it: the full reading when the user has "Dettaglio tecnico", otherwise the bill view the
 *  server sends to every user who may open the bill (foundation/bill-reading-view.ts). Tony, 10/11/2026. */
export function billForReading<T extends Pick<BillDocumentModel, "structuredBill" | "billReading">>(bill: T): T {
  return bill.structuredBill ? bill : { ...bill, structuredBill: bill.billReading ?? null };
}

/** The four sections of "Dati letti" for one bill; `calculated` are the screen's derived values (PUN, spread from the PUN). */
export function billReadSections(bill: Bill, calculated: readonly BillReadRow[] = []): readonly BillReadSection[] {
  if (!bill.structuredBill) return [];
  return [supplySection(bill), technicalSection(bill), contractSection(bill, calculated), economicsSection(bill)].map(compactSection);
}

// Tony (10/11/2026, "ottimizzazione grafica dati letti"): four compact sections with short labels; every value stays, the
// secondary ones (not printed, zero, auxiliary) move under "Altri dettagli". Only labels, order and visibility change here:
// the values are the ones built above.
const SECTION_TITLE: Readonly<Record<BillReadSectionId, string>> = { SUPPLY: "Fornitura", TECHNICAL: "Consumi e potenza", CONTRACT: "Contratto attuale", ECONOMICS: "Costi della bolletta" };
const SHORT_LABEL: Readonly<Record<string, string>> = {
  "Fornitore attuale": "Fornitore", "Periodo fatturato": "Periodo", "Tipologia cliente": "Uso", "Indirizzo della fornitura": "Indirizzo",
  "Consumo complessivo fatturato": "Consumo totale (F0)", "Consumo F1": "F1", "Consumo F2": "F2", "Consumo F3": "F3", "Consumo annuo dichiarato": "Consumo annuo",
  "Potenza massima prelevata": "Potenza massima", "Tensione di alimentazione": "Tensione",
  "Tipologia prezzo": "Prezzo", "Struttura del prezzo": "Fasce", "Spread contrattuale (stampato)": "Spread", "PCV / commercializzazione": "PCV",
  "Decorrenza condizioni economiche": "Decorrenza condizioni", "Attivazione fornitura": "Attivazione", "Scadenza condizioni economiche": "Scadenza condizioni",
  "Spesa per la vendita di energia": "Vendita", "di cui spesa per la rete e il trasporto": "Rete e trasporto", "Oneri generali di sistema": "Oneri di sistema",
  "Spesa per la rete e gli oneri generali di sistema": "Rete e oneri di sistema", "Totale fatturato": "Totale fattura",
};
const ORDER: Readonly<Record<BillReadSectionId, readonly string[]>> = {
  SUPPLY: ["Intestatario", "Fornitore", "POD", "PDR", "Periodo", "Uso"],
  TECHNICAL: ["Consumo totale (F0)", "F1", "F2", "F3", "Consumo annuo", "Potenza impegnata", "Potenza massima"],
  CONTRACT: ["Offerta", "Prezzo", "Fasce", "Indice", "Spread", "PCV", "Scadenza condizioni", "Scadenza contratto"],
  ECONOMICS: ["Vendita", "Rete e oneri di sistema", "Accise", "IVA", "Accise e IVA", "Totale fattura", "Rete e trasporto", "Oneri di sistema"],
};
const isZero = (value: string) => { const amounts = [...value.matchAll(/-?\d[\d.]*,\d+|-?\d+(?:\.\d+)?/g)].map((match) => amountOf(match[0])); return amounts.length > 0 && amounts.every((amount) => amount === 0); };

function secondaryRow(id: BillReadSectionId, row: BillReadRow, rows: readonly BillReadRow[]): boolean {
  const label = row.label;
  if (row.group === "SIMULATOR") return false;
  if (id === "SUPPLY") return label === "Mercato" || label === "Indirizzo";
  if (id === "TECHNICAL") {
    // Tension and available power only when they add something: a low-voltage supply, or the same power as the committed one.
    if (label === "Tensione") return row.state !== "REVIEW" && (row.state !== "READ" || /bassa tensione|\bBT\b/i.test(row.value));
    if (label === "Potenza disponibile") return row.state !== "READ" || row.value === rows.find((item) => item.label === "Potenza impegnata")?.value;
    return false;
  }
  if (id === "CONTRACT") {
    if (label === "Decorrenza condizioni" || label === "Attivazione" || label === "PCV stampata (valore unitario)") return true;
    if (ORDER.CONTRACT.includes(label)) return false;
    // Other commercial charges: in view unless zero.
    return isZero(row.value);
  }
  // Tony (11/11/2026, "pulizia finale"): the economic summary shows the bill's values only; what is calculated here (rete
  // as a difference, oneri as a sum of the detail rows) and what is not printed stay under "Altri dettagli".
  return (row.state === "ABSENT" || row.state === "CALCULATED") && label !== "Totale fattura";
}

function compactSection(section: BillReadSection): BillReadSection {
  const renamed = section.rows.map((row): BillReadRow => {
    if (/ \(classificazione del simulatore\)$/.test(row.label)) return { ...row, label: row.label.replace(/ \(classificazione del simulatore\)$/, ""), group: "SIMULATOR", ...(row.note ? { note: row.note.replace(/^Raggruppamento normalizzato delle righe lette: /, "") } : {}) };
    const label = SHORT_LABEL[row.label] ?? row.label;
    // F0 decides its own (only a gap above the tolerance, or the sum when no total is printed); the total's note is a mismatch.
    const { noteShown: shown, ...rest } = row;
    const noteShown = label === "Consumo totale (F0)" ? Boolean(shown) : label === "Totale fattura" && Boolean(row.note);
    return { ...rest, label, ...(noteShown ? { noteShown } : {}) };
  });
  const order = ORDER[section.id];
  const rank = (row: BillReadRow) => { const index = order.indexOf(row.label); return index < 0 ? order.length : index; };
  const rows = renamed.map((row) => ({ ...row, ...(secondaryRow(section.id, row, renamed) ? { secondary: true } : {}) }))
    .map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map((item) => item.row);
  return { id: section.id, title: SECTION_TITLE[section.id], rows };
}
