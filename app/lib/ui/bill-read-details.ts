import type { BillDocumentModel } from "./models";
import type { StructuredBillEconomicChargeLine, StructuredBillField } from "../ingestion/structured-bill";
import type { SupplyProfileField } from "../ingestion/bill-supply-profile";

// Tony (10/11/2026, fattura EE20369/2026: the 17 values were read and saved but "Dati letti" did not show them): the screen
// shows what the reading already holds, in four sections. A value read from the bill is shown as read; a value the reader
// says is not printed is "Non presente nella fattura"; a value the reading marked uncertain is "Da verificare"; a sum or a
// difference made here is labelled as calculated. Nothing is read again and nothing is inferred.

export type BillReadState = "READ" | "ABSENT" | "REVIEW" | "CALCULATED" | "NOT_READ";
export interface BillReadRow { readonly label: string; readonly value: string; readonly state: BillReadState; readonly note?: string }
export interface BillReadSection { readonly id: "SUPPLY" | "TECHNICAL" | "CONTRACT" | "ECONOMICS"; readonly title: string; readonly rows: readonly BillReadRow[]; readonly note?: string }

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
const kwh = (field: StructuredBillField<number> | undefined, unit = "kWh") => { const text = fieldText(field); return text === null ? null : `${italianDecimal(Number(text))} ${unit}`; };
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
  rows.push(row(bill, "Consumo complessivo fatturato", gas ? kwh(sb?.smcConsumption, "Smc") ?? kwh(sb?.billedConsumption, "Smc") : kwh(sb?.billedConsumption), gas ? ["consumoSmc", "consumoFatturato"] : ["consumoFatturato"], { review: needsReview(sb?.billedConsumption) }));
  if (!gas) {
    const bands = [sb?.f1Consumption, sb?.f2Consumption, sb?.f3Consumption] as const;
    bands.forEach((field, index) => rows.push(row(bill, `Consumo F${index + 1}`, kwh(field), [`consumoF${index + 1}`], { review: needsReview(field) })));
    // Tony (10/11, F1+F2+F3 = 2.672,08 against F0 2.672,07): the read values stay as printed; the sum is shown as calculated,
    // with its gap from the billed total. The calculation keeps using F1, F2 and F3 (structured-bill.ts), unchanged.
    const values = bands.map((field) => fieldText(field)).map((text) => text === null ? null : Number(text));
    if (values.every((value): value is number => value !== null && Number.isFinite(value))) {
      const decimals = Math.max(...values.map((value) => (String(value).split(".")[1] ?? "").length));
      const sum = Number(values.reduce((total, value) => total + value, 0).toFixed(decimals));
      const billedText = fieldText(sb?.billedConsumption);
      const gap = billedText === null ? null : Number((sum - Number(billedText)).toFixed(decimals));
      rows.push({ label: "Somma F1 + F2 + F3", value: `${italianDecimal(sum)} kWh`, state: "CALCULATED", note: gap === null ? "Calcolata dai consumi per fascia" : gap === 0 ? "Calcolata: coincide con il consumo fatturato" : `Calcolata: scostamento di ${italianDecimal(gap)} kWh rispetto al consumo fatturato` });
    }
  }
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
    pcvLines.length
      ? { label: "PCV / commercializzazione", value: pcvLines.map(lineText).join("; "), state: "READ", note: pcvLines.map((line) => line.rawDescription || line.description).join("; ") }
      : row(bill, "PCV / commercializzazione", pcvFact ? `${pcvFact.value}${pcvUnit ? ` ${unitText(pcvUnit)}` : ""}` : null, ["pcvMensile"], { review: pcvFact?.review }),
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
  rows.push(printedTotal === null ? { label: "Totale fatturato", value: NOT_IN_BILL, state: "ABSENT" } : { label: "Totale fatturato", value: euro(printedTotal), state: "READ" });
  const taxes = excise !== null || vat !== null ? (excise ?? 0) + (vat ?? 0) : printed?.taxes ?? null;
  if (printed?.seller != null && printed.networkAndSystem != null && taxes !== null && printedTotal !== null) {
    const sum = round2(printed.seller + printed.networkAndSystem + taxes);
    const gap = round2(sum - printedTotal);
    rows.push(calc("Somma delle componenti stampate", sum, gap === 0 ? "Calcolata: coincide con il totale fatturato" : `Calcolata: differenza di ${euro(gap)} dal totale fatturato (altre partite, bonus o canone non inclusi)`));
  }
  // The simulator's own grouping, shown apart and labelled: it may place a seller charge printed under rete elsewhere.
  const normalized: BillReadRow[] = [];
  if (totals) {
    const seller = [totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal].filter((value): value is number => value !== null);
    const add = (label: string, value: number | null) => { if (value !== null) normalized.push({ label: `${label} (classificazione del simulatore)`, value: euro(value), state: "CALCULATED", note: "Raggruppamento normalizzato delle righe lette, non stampato in fattura" }); };
    add("Vendita", seller.length ? round2(seller.reduce((total, value) => total + value, 0)) : null);
    add("Rete e trasporto", totals.regulatedNetworkTotal);
    add("Oneri generali di sistema", totals.systemChargesTotal);
    add("Accise e IVA", totals.taxTotal);
  }
  return { id: "ECONOMICS", title: "Ripartizione economica della fattura", rows: [...rows, ...normalized], ...(normalized.length ? { note: "Le prime righe sono i valori stampati in fattura; quelle marcate \"classificazione del simulatore\" sono il raggruppamento usato per il confronto e possono differire dalla fattura." } : {}) };
}

/** The bill as "Dati letti" reads it: the full reading when the user has "Dettaglio tecnico", otherwise the bill view the
 *  server sends to every user who may open the bill (foundation/bill-reading-view.ts). Tony, 10/11/2026. */
export function billForReading<T extends Pick<BillDocumentModel, "structuredBill" | "billReading">>(bill: T): T {
  return bill.structuredBill ? bill : { ...bill, structuredBill: bill.billReading ?? null };
}

/** The four sections of "Dati letti" for one bill; `calculated` are the screen's derived values (PUN, spread from the PUN). */
export function billReadSections(bill: Bill, calculated: readonly BillReadRow[] = []): readonly BillReadSection[] {
  if (!bill.structuredBill) return [];
  return [supplySection(bill), technicalSection(bill), contractSection(bill, calculated), economicsSection(bill)];
}
