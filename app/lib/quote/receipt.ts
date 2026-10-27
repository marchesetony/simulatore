import type { BillEconomicAnalysis } from "../foundation/bill-economic-analysis";
import type { BillRegulatoryAuditDTO } from "../foundation/bill-regulatory-audit";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { referenceDomainForComponent } from "../foundation/regulatory-domains.ts";

/**
 * Bolletta 2.0 style "scontrino dell'energia" for one offer, side by side with the bill it was simulated on.
 *
 * The seller's part comes from the CTE. Transport and system charges of the simulated column are the official ARERA values
 * of the period computed by the engine on the same consumption, and the bill is checked against them quota by quota: the
 * two columns need not match (Tony, 26/10: "non è detto che la bolletta e la simulazione debbano essere uguali, verifica
 * sempre la CTE e i dati ufficiali ARERA o Terna"). Only when no official value was computed are the bill's carried over.
 * Excise is the bill's; VAT follows the new taxable amount.
 */
export type QuoteReceiptRowKey = "ENERGY" | "NETWORK" | "SYSTEM" | "TAXES";
export interface QuoteReceiptRow { readonly key: QuoteReceiptRowKey; readonly label: string; readonly current: number | null; readonly offer: number | null; readonly difference?: number | null; readonly details?: readonly QuoteReceiptDetail[] }
export interface QuoteReceipt {
  readonly status: "COMPLETE" | "OFFER_ONLY";
  readonly rows: readonly QuoteReceiptRow[];
  readonly currentTotal: number | null;
  readonly offerTotal: number | null;
  readonly savings: number | null;
  readonly savingsPercent: number | null;
  readonly taxesIncluded: boolean;
  readonly vatRate: number | null;
  readonly vatRateEstimated: boolean;
  /** The VAT rate of the bill; vatRate is the one applied to the new offer. */
  readonly billVatRate?: number | null;
  readonly validUntil: string | null;
  /** The same totals split the way the ARERA "scontrino dell'energia" asks: by consumption, fixed and power quota, then taxes. */
  readonly quotas: readonly QuoteReceiptQuota[];
  /** The bill's transport and system charges checked against the official ARERA values computed on the same consumption. */
  readonly officialCheck?: Readonly<Record<"NETWORK" | "SYSTEM", OfficialCheck>>;
  /** Bill items left out of the comparison (prior-period adjustments, late-payment interest, deposits, TV licence...). */
  readonly excluded?: readonly { readonly label: string; readonly amount: number }[];
}
export interface OfficialCheck { readonly status: "VERIFIED" | "DIFFERENCE" | "NOT_AVAILABLE"; readonly official: number | null; readonly difference: number | null; readonly reason: string | null }
export type QuoteReceiptQuotaKey = "CONSUMPTION" | "FIXED" | "POWER" | "OTHER" | "EXCISE" | "VAT" | "TAXES";
/** One line of the scontrino: what the bill paid, what the simulated CTE pays, and how much of it is the seller's. */
export interface QuoteReceiptQuota { readonly key: QuoteReceiptQuotaKey; readonly label: string; readonly basis: string; readonly current: number | null; readonly offer: number | null; readonly difference: number | null; readonly currentSeller: number | null; readonly offerSeller: number | null; readonly details: readonly QuoteReceiptDetail[] }
/** One named charge inside a quota (energia, dispacciamento, capacity, sbilanciamento, PCV, trasporto, oneri), bill against CTE. */
export interface QuoteReceiptDetail { readonly key: string; readonly label: string; readonly current: number | null; readonly offer: number | null; readonly difference: number | null; readonly missingReason?: string }
export interface QuoteReceiptOfferComponent { readonly category: string; readonly sign: string; readonly label?: string; readonly formulaId?: string; readonly amount: { readonly amount: number }; readonly formulaInputs?: Readonly<Record<string, string | number | boolean>> }
export interface QuoteReceiptInput {
  readonly vector: "EE" | "GAS";
  readonly offerSupplyCost: number;
  readonly analysis: Pick<BillEconomicAnalysis, "components" | "totals"> | null;
  readonly domestic: boolean;
  readonly validUntil: string | null;
  readonly offerComponents?: readonly QuoteReceiptOfferComponent[];
  /** VAT rate chosen for the new offer when the company qualifies for a reduced rate; excise stays the bill's (Tony, 26/10). */
  readonly offerVatRate?: number | null;
  /** The calculation's warnings: OFFICIAL_VALUE_MISSING:<kind>:<reason> marks a charge priced only from official values that were missing. */
  readonly warnings?: readonly string[];
}

const VAT_RATES = [0.04, 0.05, 0.1, 0.22] as const;
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const amountOf = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const token = String(value).replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!token) return null;
  const parsed = Number(token.includes(",") ? token.replace(/\./g, "").replace(",", ".") : token);
  return Number.isFinite(parsed) ? parsed : null;
};
const sumKnown = (values: readonly (number | null)[]): number | null => values.some((value) => value !== null) ? cents(values.reduce<number>((total, value) => total + (value ?? 0), 0)) : null;

/** The VAT rate printed on the bill, else the one implied by its amounts, else null. */
export function billVatRate(analysis: Pick<BillEconomicAnalysis, "components" | "totals">): number | null {
  const vatLines = analysis.components.filter((item) => item.classification === "IVA" && !item.aggregate);
  for (const line of vatLines) {
    for (const text of [line.description, line.rawDescription, line.unitPrice ?? "", line.rawUnitPrice, line.rawValue]) {
      const match = /(\d{1,2}(?:[.,]\d+)?)\s*%/.exec(text ?? "");
      const rate = match ? Number(match[1].replace(",", ".")) / 100 : null;
      if (rate !== null && VAT_RATES.some((known) => Math.abs(known - rate) < 0.0001)) return rate;
    }
  }
  const vat = sumKnown(vatLines.map((line) => amountOf(line.amount)));
  const excise = sumKnown(analysis.components.filter((item) => item.classification === "ACCISE" && !item.aggregate).map((line) => amountOf(line.amount)));
  const totals = analysis.totals;
  const base = sumKnown([totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal, totals.regulatedNetworkTotal, totals.systemChargesTotal, excise]);
  if (vat === null || base === null || base <= 0) return null;
  const implied = vat / base;
  const nearest = VAT_RATES.find((known) => Math.abs(known - implied) <= 0.015);
  return nearest ?? null;
}

type Quota = "CONSUMPTION" | "FIXED" | "POWER";
const SUPPLY_GROUPS = new Set(["ENERGY_PRICE", "COMMERCIALIZATION", "DISPATCHING_OR_PASS_THROUGH", "CAPACITY_MARKET", "OTHER_SELLER_CHARGES", "REGULATED_NETWORK", "SYSTEM_CHARGES"]);
const SELLER_GROUPS = new Set(["ENERGY_PRICE", "COMMERCIALIZATION", "DISPATCHING_OR_PASS_THROUGH", "CAPACITY_MARKET", "OTHER_SELLER_CHARGES"]);
// ARERA scontrino: quota per consumi (kWh or Smc x unit prices), quota fissa (months x €/mese), quota potenza (kW x €/kW).
function billQuota(line: { readonly unit?: string | null; readonly rawUnit?: string | null; readonly description: string; readonly rawDescription?: string | null }): Quota | null {
  const unit = `${line.unit ?? ""} ${line.rawUnit ?? ""}`.toLowerCase();
  const text = `${line.description} ${line.rawDescription ?? ""}`.toLowerCase();
  if (/kwh|mwh|smc|\bmc\b/.test(unit)) return "CONSUMPTION";
  if (/\bkw\b|kw\s*\/|\/\s*kw\b/.test(unit) || /quota potenza|potenza impegnata/.test(text)) return "POWER";
  if (/mese|mes\b|anno|giorn|\bgg\b|pod|pdr|cliente|month|year|day/.test(unit) || /quota fissa/.test(text)) return "FIXED";
  return null;
}
function offerQuota(component: QuoteReceiptOfferComponent): Quota | "ONE_OFF" {
  const unit = String(component.formulaInputs?.feeUnit ?? "");
  if (component.category === "ONE_OFF_FEE" || unit === "EUR_PER_CONTRACT") return "ONE_OFF";
  if (unit === "EUR_PER_MONTH" || unit === "EUR_PER_YEAR" || unit === "EUR_PER_POD" || unit === "EUR_PER_DAY") return "FIXED";
  if (unit === "EUR_PER_KW" || unit === "EUR_PER_KW_MONTH") return "POWER";
  return component.category === "FIXED_FEE" ? "FIXED" : "CONSUMPTION";
}
// Official regulated components computed by the engine (ARERA tariffs of the period). Bolletta 2.0 (delibera 501/2014/R/com)
// groups distribution, metering, transmission and UC3/UC6 under "trasporto e gestione del contatore" and ARIM/ASOS under
// "oneri di sistema", each split into quota fissa, quota potenza and quota energia: the bill may print only those
// aggregates, so the check is made on the same aggregates.
type RegulatedSide = "NETWORK" | "SYSTEM" | "DISPATCHING";
function regulatedSide(component: QuoteReceiptOfferComponent): RegulatedSide | null {
  if (!component.category.startsWith("REGULATED_")) return null;
  const code = String(component.formulaInputs?.componentCode ?? "");
  if (code === "ARIM" || code === "ASOS") return "SYSTEM";
  if (code === "DISPATCHING_TOTAL") return "DISPATCHING";
  return "NETWORK";
}
function regulatedQuota(component: QuoteReceiptOfferComponent): Quota {
  return component.category === "REGULATED_POWER" ? "POWER" : component.category === "REGULATED_FIXED" ? "FIXED" : "CONSUMPTION";
}
const signed = (component: QuoteReceiptOfferComponent): number => (component.sign === "DISCOUNT" ? -1 : 1) * component.amount.amount;
const sellerComponents = (input: QuoteReceiptInput) => (input.offerComponents ?? []).filter((component) => regulatedSide(component) === null || regulatedSide(component) === "DISPATCHING");
const officialOf = (input: QuoteReceiptInput, side: "NETWORK" | "SYSTEM") => (input.offerComponents ?? []).filter((component) => regulatedSide(component) === side);
// No resolution grants a tolerance: tariffs carry 6 decimals and each line is rounded to the cent, so the bill may differ
// from the official amount by at most 0,01 EUR per component summed (base di calcolo approvata da Tony, 26/10).
function officialCheck(bill: number | null, components: readonly QuoteReceiptOfferComponent[], hasOfficial: boolean, unavailable: string): OfficialCheck {
  if (!hasOfficial) return { status: "NOT_AVAILABLE", official: null, difference: null, reason: unavailable };
  const official = cents(components.reduce((total, component) => total + signed(component), 0));
  if (bill === null) return { status: "NOT_AVAILABLE", official, difference: null, reason: "importo non letto in bolletta" };
  const difference = cents(bill - official);
  return Math.abs(difference) <= 0.01 * components.length + 1e-9 ? { status: "VERIFIED", official, difference, reason: null } : { status: "DIFFERENCE", official, difference, reason: null };
}

// Why the ARERA transport/system tables could not be applied (engine warning OFFICIAL_VALUE_MISSING:REGULATED:<code>).
function regulatedUnavailable(input: QuoteReceiptInput): string {
  const code = (input.warnings ?? []).find((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:REGULATED:"))?.slice("OFFICIAL_VALUE_MISSING:REGULATED:".length) ?? "";
  if (code.startsWith("SCOPE_UNREGISTERED_")) return `tabelle ARERA non ancora caricate per questa tipologia di fornitura (${code.slice("SCOPE_UNREGISTERED_".length)})`;
  if (/^(POWER_|AVAILABLE_POWER|CONTRACTED_POWER|BTA6_)/.test(code)) return `potenza impegnata/disponibile non letta in bolletta (${code})`;
  if (/^SUPPLY_USE/.test(code)) return `uso della fornitura (domestico/altri usi) non letto in bolletta (${code})`;
  if (/^VOLTAGE_LEVEL/.test(code)) return `livello di tensione non letto in bolletta (${code})`;
  if (/^(REGULATORY_SCOPE|DOMESTIC_)/.test(code)) return `tipologia cliente non determinabile dalla bolletta (${code})`;
  if (code) return `dati tecnici della bolletta incompleti (${code})`;
  return "valori ufficiali ARERA del periodo non calcolati per questa fornitura";
}

const MISSING_KEY: Readonly<Record<string, string>> = { DISPATCHING: "DISPATCHING", CAPACITY_MARKET: "CAPACITY", LOSSES: "LOSSES" };
const MISSING_REASON: Readonly<Record<string, string>> = {
  OFFICIAL_VALUE_MISSING: "valore ufficiale ARERA/Terna del periodo non in archivio",
  PEAK_HOUR_KWH_MISSING: "servono i kWh prelevati nelle ore di picco Terna",
  AVAILABLE_POWER_MISSING: "potenza disponibile non letta in bolletta",
  CTE_REFERENCE_MISSING: "la CTE in archivio non indica come si applica: va riletta la CTE",
};
function missingOfficial(input: QuoteReceiptInput): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const warning of input.warnings ?? []) {
    const [prefix, kind, reason] = warning.split(":");
    const key = MISSING_KEY[kind ?? ""];
    if (prefix === "OFFICIAL_VALUE_MISSING" && key && !result.has(key)) result.set(key, MISSING_REASON[reason ?? ""] ?? "valore ufficiale mancante");
  }
  return result;
}
// Reactive energy is an ARERA charge tied to the customer's plant: the same on both sides (base di calcolo, 26/10).
// Every other "altre partite" line (prior periods, interest, deposits, indemnities, TV licence) stays out of the comparison.
type BillLine = NonNullable<QuoteReceiptInput["analysis"]>["components"][number];
const otherItems = (input: QuoteReceiptInput): readonly BillLine[] => (input.analysis?.components ?? []).filter((line) => line.group === "OTHER_ITEMS" && !line.aggregate && line.includedInReconciliation !== false && amountOf(line.amount) !== null);
const isReactive = (line: BillLine): boolean => line.classification !== "RICALCOLI" && /reattiv/i.test(`${line.description} ${line.rawDescription ?? ""}`);

// Charges the bill and the CTE both name, so each one is compared on its own line and never hidden in an aggregate (Tony, 26/10).
const DETAIL_LABEL: Readonly<Record<string, string>> = {
  ENERGY: "Prezzo energia (indice + spread o prezzo fisso)", LOSSES: "Perdite di rete", COMMERCIALIZATION: "Commercializzazione", DISPATCHING: "Dispacciamento",
  CAPACITY: "Mercato della capacità (capacity market)", CAPACITY_CTE: "Capacity market libero (da CTE)", IMBALANCE: "Sbilanciamento", SELLER_OTHER: "Altri corrispettivi di vendita", PCV: "Quota fissa di vendita (PCV)",
  OPTIONS: "Opzioni e servizi a pagamento (es. Flex)", ONE_OFF: "Corrispettivi una tantum", REACTIVE: "Energia reattiva", NETWORK: "Trasporto e gestione del contatore", SYSTEM: "Oneri di sistema",
};
const DETAIL_ORDER = Object.keys(DETAIL_LABEL);
function billDetail(line: { readonly classification: string; readonly group?: string; readonly description: string }): string {
  switch (line.classification) {
    case "NETWORK_LOSS_CHARGE": return "LOSSES";
    case "COMMERCIALIZATION_VARIABLE_FEE": return "COMMERCIALIZATION";
    case "DISPATCHING_SELLER_CHARGE": return /capacit/i.test(line.description) ? "CAPACITY" : "DISPATCHING";
    case "CAPACITY_MARKET_SELLER_CHARGE": return "CAPACITY";
    case "BALANCING_CHARGE": return "IMBALANCE";
    case "PCV": case "COMMERCIALIZATION_FIXED_FEE": case "SELLER_FIXED_FEE": return /flex|opzion/i.test(line.description) ? "OPTIONS" : "PCV";
    case "ARERA_NETWORK": return "NETWORK";
    case "ARERA_SYSTEM_CHARGES": return "SYSTEM";
    case "OTHER_SELLER_ENERGY_CHARGE": case "OTHER_SELLER_FIXED_CHARGE": return /capacit/i.test(line.description) ? "CAPACITY" : /dispacciament/i.test(line.description) ? "DISPATCHING" : /sbilanciament/i.test(line.description) ? "IMBALANCE" : /commercializzazion/i.test(line.description) ? "COMMERCIALIZATION" : "SELLER_OTHER";
    default: return "ENERGY";
  }
}
function offerDetail(component: QuoteReceiptOfferComponent): string {
  const text = `${component.label ?? ""} ${component.formulaInputs?.kind ?? ""} ${component.formulaInputs?.feeId ?? ""}`;
  if (component.category === "ENERGY") return "ENERGY";
  // A one-off fee ("gestione APP e servizi 1,50 €") is not a recurring option.
  if (component.category === "ONE_OFF_FEE") return "ONE_OFF";
  if (component.category === "IMBALANCE" || /sbilanciament|imbalance/i.test(text)) return "IMBALANCE";
  // The CTE's own capacity charge stays apart, so a missing official capacity value still shows its reason.
  if (component.formulaInputs?.source === "CTE_STATED_VALUE" && /capacit/i.test(text)) return "CAPACITY_CTE";
  if (/capacit/i.test(text)) return "CAPACITY";
  if (/dispacciament|dispatching/i.test(text)) return "DISPATCHING";
  if (/perdit|loss/i.test(text)) return "LOSSES";
  if (/flex|opzion|servizi/i.test(text)) return "OPTIONS";
  if (component.category === "FIXED_FEE") return "PCV";
  if (/commercializzazion/i.test(text)) return "COMMERCIALIZATION";
  return "COMMERCIALIZATION";
}

function quotasOf(input: QuoteReceiptInput, currentEnergy: number | null, offerEnergy: number, network: number | null, system: number | null, currentTaxes: number | null, offerTaxes: number | null, offerNetwork: number | null = network, offerSystem: number | null = system): readonly QuoteReceiptQuota[] {
  const hasOfficial = officialOf(input, "NETWORK").length + officialOf(input, "SYSTEM").length > 0;
  const lines = (input.analysis?.components ?? []).filter((line) => line.includedInReconciliation !== false && !line.aggregate && SUPPLY_GROUPS.has(line.group ?? ""));
  const bill = { CONSUMPTION: { all: 0, seller: 0 }, FIXED: { all: 0, seller: 0 }, POWER: { all: 0, seller: 0 } };
  const detail = { CONSUMPTION: new Map<string, { current: number | null; offer: number | null }>(), FIXED: new Map<string, { current: number | null; offer: number | null }>(), POWER: new Map<string, { current: number | null; offer: number | null }>(), ONE_OFF: new Map<string, { current: number | null; offer: number | null }>() };
  const addDetail = (quota: keyof typeof detail, key: string, side: "current" | "offer", value: number) => { const entry = detail[quota].get(key) ?? { current: null, offer: null }; entry[side] = (entry[side] ?? 0) + value; detail[quota].set(key, entry); };
  for (const line of lines) {
    const value = amountOf(line.amount); const quota = billQuota(line);
    if (value === null || quota === null) continue;
    bill[quota].all += value;
    const key = billDetail(line);
    addDetail(quota, key, "current", value);
    // Without official values the bill's transport and system charges are carried over to the simulated column.
    if ((key === "NETWORK" || key === "SYSTEM") && !hasOfficial) addDetail(quota, key, "offer", value);
    if (SELLER_GROUPS.has(line.group ?? "")) bill[quota].seller += value;
  }
  const offer = { CONSUMPTION: 0, FIXED: 0, POWER: 0, ONE_OFF: 0 };
  for (const component of sellerComponents(input)) {
    const value = signed(component); const quota = offerQuota(component);
    offer[quota] += value;
    addDetail(quota, offerDetail(component), "offer", value);
  }
  const official = { CONSUMPTION: 0, FIXED: 0, POWER: 0 };
  for (const side of ["NETWORK", "SYSTEM"] as const) for (const component of officialOf(input, side)) {
    const quota = regulatedQuota(component);
    official[quota] += signed(component);
    addDetail(quota, side, "offer", signed(component));
  }
  const detailsOf = (quota: keyof typeof detail, withBill: boolean): readonly QuoteReceiptDetail[] => [...detail[quota].entries()]
    .sort(([a], [b]) => DETAIL_ORDER.indexOf(a) - DETAIL_ORDER.indexOf(b))
    .map(([key, value]) => ({ key, label: DETAIL_LABEL[key] ?? key, current: !withBill || value.current === null ? null : cents(value.current), offer: value.offer === null ? null : cents(value.offer), difference: !withBill ? null : cents((value.offer ?? 0) - (value.current ?? 0)) }));
  // The simulated column's transport and system charges: the official values when computed, else the bill's.
  const regulated = (quota: Quota) => hasOfficial ? cents(official[quota]) : cents(bill[quota].all - bill[quota].seller);
  const row = (key: QuoteReceiptQuotaKey, label: string, basis: string, current: number | null, offerValue: number | null, currentSeller: number | null = null, offerSeller: number | null = null, details: readonly QuoteReceiptDetail[] = []): QuoteReceiptQuota =>
    ({ key, label, basis, current: current === null ? null : cents(current), offer: offerValue === null ? null : cents(offerValue), difference: current === null || offerValue === null ? null : cents(offerValue - current), currentSeller: currentSeller === null ? null : cents(currentSeller), offerSeller: offerSeller === null ? null : cents(offerSeller), details });
  const withBill = currentEnergy !== null;
  const consumptionUnit = input.vector === "EE" ? "kWh" : "Smc";
  const rows: QuoteReceiptQuota[] = [
    row("CONSUMPTION", "Quota per consumi", `${consumptionUnit} consumati \u00d7 prezzi unitari`, currentEnergy === null ? null : bill.CONSUMPTION.all, regulated("CONSUMPTION") + offer.CONSUMPTION, currentEnergy === null ? null : bill.CONSUMPTION.seller, offer.CONSUMPTION, detailsOf("CONSUMPTION", withBill)),
    row("FIXED", "Quota fissa", "mesi \u00d7 corrispettivi in \u20ac/mese", currentEnergy === null ? null : bill.FIXED.all, regulated("FIXED") + offer.FIXED, currentEnergy === null ? null : bill.FIXED.seller, offer.FIXED, detailsOf("FIXED", withBill)),
  ];
  if (input.vector === "EE") rows.push(row("POWER", "Quota potenza", "kW \u00d7 corrispettivi in \u20ac/kW", currentEnergy === null ? null : bill.POWER.all, regulated("POWER") + offer.POWER, currentEnergy === null ? null : bill.POWER.seller, offer.POWER, detailsOf("POWER", withBill)));
  // Whatever the bill does not tie to a quota (a line without unit) and the CTE's one-off fees, so the quotas add up to the same totals.
  const supplyCurrent = currentEnergy === null ? null : currentEnergy + (network ?? 0) + (system ?? 0);
  const supplyOffer = offerEnergy + (offerNetwork ?? 0) + (offerSystem ?? 0);
  const placedCurrent = rows.reduce((total, item) => total + (item.current ?? 0), 0);
  const placedOffer = rows.reduce((total, item) => total + (item.offer ?? 0), 0);
  const otherCurrent = supplyCurrent === null ? null : cents(supplyCurrent - placedCurrent);
  const otherOffer = cents(supplyOffer - placedOffer);
  if (Math.abs(otherCurrent ?? 0) >= 0.01 || Math.abs(otherOffer) >= 0.01) rows.push(row("OTHER", "Altre voci della fornitura", "corrispettivi senza unit\u00e0 in bolletta e una tantum della CTE", otherCurrent, otherOffer, null, null, detailsOf("ONE_OFF", false)));
  if (currentTaxes !== null && offerTaxes !== null) {
    const excise = sumKnown((input.analysis?.components ?? []).filter((line) => line.classification === "ACCISE" && !line.aggregate).map((line) => amountOf(line.amount)));
    if (excise !== null) {
      rows.push(row("EXCISE", "Accise", "kWh \u00d7 aliquota di legge (uguale per ogni fornitore)", excise, excise));
      rows.push(row("VAT", "IVA", "aliquota sull'imponibile", currentTaxes - excise, offerTaxes - excise));
    } else rows.push(row("TAXES", "Imposte e IVA", "accise e IVA", currentTaxes, offerTaxes));
  }
  return rows;
}

const QUOTA_LABEL: Readonly<Record<Quota, string>> = { CONSUMPTION: "quota energia (\u20ac/kWh)", FIXED: "quota fissa (\u20ac/mese)", POWER: "quota potenza (\u20ac/kW)" };
// Scontrino order asked by Tony (26/10): the four Bolletta 2.0 sections first, aggregated, then each charge they contain on its own line.
function withDetails(input: QuoteReceiptInput, rows: readonly QuoteReceiptRow[], hasBill: boolean): readonly QuoteReceiptRow[] {
  const components = (input.analysis?.components ?? []).filter((line) => line.includedInReconciliation !== false && !line.aggregate);
  const consumptionUnit = input.vector === "EE" ? "\u20ac/kWh" : "\u20ac/Smc";
  const entries = (pairs: readonly (readonly [string, string, number | null, number | null])[]): readonly QuoteReceiptDetail[] => {
    const merged = new Map<string, { label: string; current: number | null; offer: number | null }>();
    for (const [key, label, current, offer] of pairs) {
      const entry = merged.get(key) ?? { label, current: null, offer: null };
      if (current !== null) entry.current = (entry.current ?? 0) + current;
      if (offer !== null) entry.offer = (entry.offer ?? 0) + offer;
      merged.set(key, entry);
    }
    return [...merged.entries()].sort(([a], [b]) => (DETAIL_ORDER.indexOf(a) + 1 || 99) - (DETAIL_ORDER.indexOf(b) + 1 || 99)).map(([key, value]) => {
      const missingReason = value.offer === null ? missing.get(key) : undefined;
      return { key, label: value.label, current: hasBill && value.current !== null ? cents(value.current) : null, offer: value.offer === null ? null : cents(value.offer), difference: hasBill && missingReason === undefined ? cents((value.offer ?? 0) - (value.current ?? 0)) : null, ...(missingReason ? { missingReason } : {}) };
    });
  };
  const missing = missingOfficial(input);
  const seller = entries([
    ...components.filter((line) => SELLER_GROUPS.has(line.group ?? "")).flatMap((line) => { const value = amountOf(line.amount); const key = billDetail(line); return value === null ? [] : [[key, DETAIL_LABEL[key] ?? key, value, null] as const]; }),
    ...sellerComponents(input).map((component) => { const key = regulatedSide(component) === "DISPATCHING" ? "DISPATCHING" : offerDetail(component); return [key, DETAIL_LABEL[key] ?? key, null, signed(component)] as const; }),
    // A charge the base requires but whose official value is missing still gets its line, with the reason.
    ...[...missing.keys()].map((key) => [key, DETAIL_LABEL[key] ?? key, null, null] as const),
  ]);
  const label = (quota: Quota | null) => quota ? QUOTA_LABEL[quota].replace("\u20ac/kWh", consumptionUnit) : "altre voci";
  const regulated = (group: string, side: "NETWORK" | "SYSTEM") => {
    const official = officialOf(input, side);
    return entries([
      ...components.filter((line) => line.group === group).flatMap((line) => {
        const value = amountOf(line.amount); if (value === null) return [];
        const quota = billQuota(line);
        return [[quota ?? "OTHER", label(quota), value, official.length ? null : value] as const];
      }),
      ...official.map((component) => { const quota = regulatedQuota(component); return [quota, label(quota), null, signed(component)] as const; }),
      ...(side === "NETWORK" ? otherItems(input).filter(isReactive).map((line) => ["REACTIVE", DETAIL_LABEL.REACTIVE, amountOf(line.amount), amountOf(line.amount)] as const) : []),
    ]);
  };
  const excise = sumKnown(components.filter((line) => line.classification === "ACCISE").map((line) => amountOf(line.amount)));
  return rows.map((row) => {
    const difference = row.current === null || row.offer === null ? null : cents(row.offer - row.current);
    if (row.key === "ENERGY") return { ...row, difference, details: seller };
    if (row.key === "NETWORK") return { ...row, difference, details: regulated("REGULATED_NETWORK", "NETWORK") };
    if (row.key === "SYSTEM") return { ...row, difference, details: regulated("SYSTEM_CHARGES", "SYSTEM") };
    if (row.current === null || row.offer === null || excise === null) return { ...row, difference, details: [] };
    // Excise follows the kWh and is the same for every supplier; VAT follows the new taxable amount.
    return { ...row, difference, details: [
      { key: "EXCISE", label: "Accise", current: excise, offer: excise, difference: 0 },
      { key: "VAT", label: "IVA", current: cents(row.current - excise), offer: cents(row.offer - excise), difference: cents(row.offer - row.current) },
    ] };
  });
}

export function buildQuoteReceipt(input: QuoteReceiptInput): QuoteReceipt {
  // Regulated dispatching (domestic TIDE) belongs to the materia energia even though the engine prices it as regulated.
  const regulatedDispatching = (input.offerComponents ?? []).filter((component) => regulatedSide(component) === "DISPATCHING").reduce((total, component) => total + signed(component), 0);
  const offerEnergy = cents(input.offerSupplyCost + regulatedDispatching);
  const totals = input.analysis?.totals ?? null;
  const currentEnergy = totals ? sumKnown([totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal]) : null;
  const billNetwork = totals?.regulatedNetworkTotal ?? null;
  const reactive = sumKnown(otherItems(input).filter(isReactive).map((line) => amountOf(line.amount)));
  const network = billNetwork === null && reactive === null ? null : cents((billNetwork ?? 0) + (reactive ?? 0));
  const system = totals?.systemChargesTotal ?? null;
  // Prior-period adjustments are one item, as in the bill's own summary ("Ricalcoli").
  const recalculations = otherItems(input).filter((line) => line.classification === "RICALCOLI");
  const excluded = [
    ...(recalculations.length ? [{ label: "Ricalcoli e conguagli dei mesi precedenti", amount: cents(recalculations.reduce((total, line) => total + (amountOf(line.amount) ?? 0), 0)) }] : []),
    ...otherItems(input).filter((line) => !isReactive(line) && line.classification !== "RICALCOLI").map((line) => ({ label: line.description, amount: amountOf(line.amount) ?? 0 })),
  ];
  const officialNetwork = officialOf(input, "NETWORK");
  const officialSystem = officialOf(input, "SYSTEM");
  const hasOfficial = officialNetwork.length + officialSystem.length > 0;
  const check = { NETWORK: officialCheck(billNetwork, officialNetwork, hasOfficial, regulatedUnavailable(input)), SYSTEM: officialCheck(system, officialSystem, hasOfficial, regulatedUnavailable(input)) };
  const offerNetwork = hasOfficial ? cents((check.NETWORK.official ?? 0) + (reactive ?? 0)) : network;
  const offerSystem = hasOfficial ? check.SYSTEM.official ?? 0 : system;
  const currentTaxes = totals?.taxTotal ?? null;
  const printedRate = input.analysis ? billVatRate(input.analysis) : null;
  const vatRate = printedRate ?? (input.domestic && input.vector === "EE" ? 0.1 : 0.22);
  const taxesIncluded = currentTaxes !== null && currentEnergy !== null;
  const chosenRate = input.offerVatRate ?? null;
  const exciseLines = sumKnown((input.analysis?.components ?? []).filter((line) => line.classification === "ACCISE" && !line.aggregate).map((line) => amountOf(line.amount)));
  // Without excise lines on the bill, excise is what is left of the taxes once VAT at the bill's rate is taken out.
  const excise = !taxesIncluded ? null : exciseLines ?? Math.max(0, cents((currentTaxes - (currentEnergy + (network ?? 0) + (system ?? 0)) * vatRate) / (1 + vatRate)));
  // The bill's own rate keeps the bill's VAT and moves it only with the supply cost, as before.
  const supplyDelta = taxesIncluded ? offerEnergy + (offerNetwork ?? 0) + (offerSystem ?? 0) - (currentEnergy + (network ?? 0) + (system ?? 0)) : 0;
  const offerTaxes = !taxesIncluded ? null : chosenRate === null || excise === null || Math.abs(chosenRate - vatRate) < 0.0001
    ? cents(currentTaxes + supplyDelta * vatRate)
    : cents(excise + (offerEnergy + (offerNetwork ?? 0) + (offerSystem ?? 0) + excise) * chosenRate);
  const rows: QuoteReceiptRow[] = [
    { key: "ENERGY", label: input.vector === "EE" ? "Spesa per la materia energia" : "Spesa per la materia gas naturale", current: currentEnergy, offer: offerEnergy },
    { key: "NETWORK", label: "Trasporto e gestione del contatore", current: network, offer: offerNetwork },
    { key: "SYSTEM", label: "Oneri di sistema", current: system, offer: offerSystem },
    { key: "TAXES", label: "Imposte (accise e IVA)", current: taxesIncluded ? currentTaxes : null, offer: offerTaxes },
  ];
  if (currentEnergy === null) {
    return { status: "OFFER_ONLY", rows: withDetails(input, rows, false), currentTotal: null, offerTotal: null, savings: null, savingsPercent: null, taxesIncluded: false, vatRate: null, vatRateEstimated: false, validUntil: input.validUntil, quotas: quotasOf(input, null, offerEnergy, network, system, null, null, offerNetwork, offerSystem), officialCheck: check, excluded };
  }
  const currentTotal = cents(currentEnergy + (network ?? 0) + (system ?? 0) + (taxesIncluded ? currentTaxes : 0));
  const offerTotal = cents(offerEnergy + (offerNetwork ?? 0) + (offerSystem ?? 0) + (offerTaxes ?? 0));
  const savings = cents(currentTotal - offerTotal);
  const savingsPercent = currentTotal > 0 ? Math.round((savings / currentTotal) * 1000) / 10 : null;
  return { status: "COMPLETE", rows: withDetails(input, rows, true), currentTotal, offerTotal, savings, savingsPercent, taxesIncluded, vatRate: taxesIncluded ? chosenRate ?? vatRate : null, vatRateEstimated: taxesIncluded && chosenRate === null && printedRate === null, billVatRate: taxesIncluded ? vatRate : null, validUntil: input.validUntil, quotas: quotasOf(input, currentEnergy, offerEnergy, network, system, taxesIncluded ? currentTaxes : null, offerTaxes, offerNetwork, offerSystem), officialCheck: check, excluded };
}

/** Whether the bill's regulated charges match the official ARERA (network, system charges) and Terna (dispatching, capacity) values of the period. */
// Excise and VAT are not checked: the same excise applies to every supplier and the VAT rate is the customer's (Tony, 26/10).
export type RegulatedDomain = "NETWORK" | "SYSTEM_CHARGES" | "DISPATCHING" | "CAPACITY_MARKET";
export interface RegulatedVerification { readonly status: "VERIFIED" | "DIFFERENCE" | "NOT_VERIFIABLE" | "NOT_AVAILABLE"; readonly checked: number; readonly difference: number; readonly reason: string | null }
const VERIFIED = new Set(["MATCH", "ROUNDING_DIFFERENCE"]);
const DIFFERENT = new Set(["MISMATCH", "OVERCHARGE", "UNDERCHARGE"]);
const REASON: Readonly<Record<string, string>> = {
  REGULATORY_SOURCE_MISSING: "manca il valore ufficiale del periodo in archivio", SCOPE_UNDETERMINED: "tipologia cliente non determinata", CUSTOMER_SCOPE_UNDETERMINED: "tipologia cliente non determinata",
  QUANTITY_MISSING: "quantit\u00e0 non letta in bolletta", UNIT_PRICE_MISSING: "prezzo unitario non letto in bolletta", AGGREGATED_BILL_LINE: "voce aggregata in bolletta", UNIT_SEMANTICS_INCONSISTENT: "unit\u00e0 di misura incoerente",
  INSUFFICIENT_DOCUMENT_DATA: "dati della bolletta insufficienti", SOURCE_AUTHORITY_NOT_IMPLEMENTED: "fonte ufficiale non ancora collegata", FORMULA_MISSING: "formula non disponibile",
};
function domainOf(line: BillRegulatoryAuditDTO["lines"][number]): RegulatedDomain | null {
  const mapped = referenceDomainForComponent(line.code);
  if (mapped === "NETWORK" || mapped === "SYSTEM_CHARGES" || mapped === "DISPATCHING" || mapped === "CAPACITY_MARKET") return mapped;
  if (line.category === "DISPATCHING" || line.category === "CAPACITY_MARKET") return line.category;
  if (line.category === "REGULATED_ARERA") return /asos|arim|uc3|uc6|oneri/i.test(`${line.code} ${line.description}`) ? "SYSTEM_CHARGES" : "NETWORK";
  return null;
}
export function regulatedVerification(audit: BillRegulatoryAuditDTO | null | undefined, domain: RegulatedDomain): RegulatedVerification {
  const lines = (audit?.lines ?? []).filter((line) => domainOf(line) === domain);
  if (!lines.length) return { status: "NOT_AVAILABLE", checked: 0, difference: 0, reason: audit ? "nessuna voce confrontabile in bolletta" : "verifica non eseguita per questa bolletta" };
  const different = lines.filter((line) => DIFFERENT.has(line.auditStatus));
  const verified = lines.filter((line) => VERIFIED.has(line.auditStatus));
  if (different.length) return { status: "DIFFERENCE", checked: verified.length + different.length, difference: cents(different.reduce((total, line) => total + (line.differenceAmount ?? 0), 0)), reason: null };
  if (verified.length === lines.length) return { status: "VERIFIED", checked: verified.length, difference: 0, reason: null };
  const open = lines.find((line) => !VERIFIED.has(line.auditStatus));
  const reason = open ? REASON[open.notComparableReason] ?? REASON[open.auditStatus] ?? "non confrontabile" : null;
  return { status: "NOT_VERIFIABLE", checked: verified.length, difference: 0, reason: verified.length ? `${verified.length} di ${lines.length} voci verificate; le altre: ${reason}` : reason };
}
