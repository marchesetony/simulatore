import type { BillEconomicAnalysis } from "../foundation/bill-economic-analysis";

/**
 * Bolletta 2.0 style "scontrino dell'energia" for one offer, side by side with the bill it was simulated on.
 *
 * Only the supply cost changes with the supplier: transport, system charges and excise depend on the same
 * consumption and period, so they are carried over from the bill. VAT follows the new taxable amount.
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
  readonly validUntil: string | null;
  /** The same totals split the way the ARERA "scontrino dell'energia" asks: by consumption, fixed and power quota, then taxes. */
  readonly quotas: readonly QuoteReceiptQuota[];
}
export type QuoteReceiptQuotaKey = "CONSUMPTION" | "FIXED" | "POWER" | "OTHER" | "EXCISE" | "VAT" | "TAXES";
/** One line of the scontrino: what the bill paid, what the simulated CTE pays, and how much of it is the seller's. */
export interface QuoteReceiptQuota { readonly key: QuoteReceiptQuotaKey; readonly label: string; readonly basis: string; readonly current: number | null; readonly offer: number | null; readonly difference: number | null; readonly currentSeller: number | null; readonly offerSeller: number | null; readonly details: readonly QuoteReceiptDetail[] }
/** One named charge inside a quota (energia, dispacciamento, capacity, sbilanciamento, PCV, trasporto, oneri), bill against CTE. */
export interface QuoteReceiptDetail { readonly key: string; readonly label: string; readonly current: number | null; readonly offer: number | null; readonly difference: number | null }
export interface QuoteReceiptOfferComponent { readonly category: string; readonly sign: string; readonly label?: string; readonly formulaId?: string; readonly amount: { readonly amount: number }; readonly formulaInputs?: Readonly<Record<string, string | number | boolean>> }
export interface QuoteReceiptInput {
  readonly vector: "EE" | "GAS";
  readonly offerSupplyCost: number;
  readonly analysis: Pick<BillEconomicAnalysis, "components" | "totals"> | null;
  readonly domestic: boolean;
  readonly validUntil: string | null;
  readonly offerComponents?: readonly QuoteReceiptOfferComponent[];
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
// Charges the bill and the CTE both name, so each one is compared on its own line and never hidden in an aggregate (Tony, 26/10).
const DETAIL_LABEL: Readonly<Record<string, string>> = {
  ENERGY: "Prezzo energia (indice + spread o prezzo fisso)", LOSSES: "Perdite di rete", COMMERCIALIZATION: "Commercializzazione", DISPATCHING: "Dispacciamento",
  CAPACITY: "Mercato della capacità (capacity market)", IMBALANCE: "Sbilanciamento", SELLER_OTHER: "Altri corrispettivi di vendita", PCV: "Quota fissa di vendita (PCV)",
  OPTIONS: "Opzioni e servizi a pagamento (es. Flex)", NETWORK: "Trasporto e gestione del contatore", SYSTEM: "Oneri di sistema",
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
  if (component.category === "IMBALANCE" || /sbilanciament|imbalance/i.test(text)) return "IMBALANCE";
  if (/capacit/i.test(text)) return "CAPACITY";
  if (/dispacciament|dispatching/i.test(text)) return "DISPATCHING";
  if (/perdit|loss/i.test(text)) return "LOSSES";
  if (/flex|opzion|servizi/i.test(text)) return "OPTIONS";
  if (component.category === "FIXED_FEE") return "PCV";
  if (/commercializzazion/i.test(text)) return "COMMERCIALIZATION";
  return component.category === "ONE_OFF_FEE" ? "SELLER_OTHER" : "COMMERCIALIZATION";
}

function quotasOf(input: QuoteReceiptInput, currentEnergy: number | null, offerEnergy: number, network: number | null, system: number | null, currentTaxes: number | null, offerTaxes: number | null): readonly QuoteReceiptQuota[] {
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
    // Transport and system charges are the same on both sides.
    if (key === "NETWORK" || key === "SYSTEM") addDetail(quota, key, "offer", value);
    if (SELLER_GROUPS.has(line.group ?? "")) bill[quota].seller += value;
  }
  const offer = { CONSUMPTION: 0, FIXED: 0, POWER: 0, ONE_OFF: 0 };
  for (const component of input.offerComponents ?? []) {
    const value = (component.sign === "DISCOUNT" ? -1 : 1) * component.amount.amount; const quota = offerQuota(component);
    offer[quota] += value;
    addDetail(quota, offerDetail(component), "offer", value);
  }
  const detailsOf = (quota: keyof typeof detail, withBill: boolean): readonly QuoteReceiptDetail[] => [...detail[quota].entries()]
    .sort(([a], [b]) => DETAIL_ORDER.indexOf(a) - DETAIL_ORDER.indexOf(b))
    .map(([key, value]) => ({ key, label: DETAIL_LABEL[key] ?? key, current: !withBill || value.current === null ? null : cents(value.current), offer: value.offer === null ? null : cents(value.offer), difference: !withBill ? null : cents((value.offer ?? 0) - (value.current ?? 0)) }));
  // Transport and system charges stay those of the bill: the offer side swaps only the seller's part of each quota.
  const regulated = (quota: Quota) => cents(bill[quota].all - bill[quota].seller);
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
  const supplyOffer = offerEnergy + (network ?? 0) + (system ?? 0);
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
    return [...merged.entries()].sort(([a], [b]) => (DETAIL_ORDER.indexOf(a) + 1 || 99) - (DETAIL_ORDER.indexOf(b) + 1 || 99)).map(([key, value]) => ({ key, label: value.label, current: hasBill && value.current !== null ? cents(value.current) : null, offer: value.offer === null ? null : cents(value.offer), difference: hasBill ? cents((value.offer ?? 0) - (value.current ?? 0)) : null }));
  };
  const seller = entries([
    ...components.filter((line) => SELLER_GROUPS.has(line.group ?? "")).flatMap((line) => { const value = amountOf(line.amount); const key = billDetail(line); return value === null ? [] : [[key, DETAIL_LABEL[key] ?? key, value, null] as const]; }),
    ...(input.offerComponents ?? []).map((component) => { const key = offerDetail(component); return [key, DETAIL_LABEL[key] ?? key, null, (component.sign === "DISCOUNT" ? -1 : 1) * component.amount.amount] as const; }),
  ]);
  const regulated = (group: string) => entries(components.filter((line) => line.group === group).flatMap((line) => {
    const value = amountOf(line.amount); if (value === null) return [];
    const quota = billQuota(line); const key = quota ?? "OTHER";
    return [[key, quota ? QUOTA_LABEL[quota].replace("\u20ac/kWh", consumptionUnit) : "altre voci", value, value] as const];
  }));
  const excise = sumKnown(components.filter((line) => line.classification === "ACCISE").map((line) => amountOf(line.amount)));
  return rows.map((row) => {
    const difference = row.current === null || row.offer === null ? null : cents(row.offer - row.current);
    if (row.key === "ENERGY") return { ...row, difference, details: seller };
    if (row.key === "NETWORK") return { ...row, difference, details: regulated("REGULATED_NETWORK") };
    if (row.key === "SYSTEM") return { ...row, difference, details: regulated("SYSTEM_CHARGES") };
    if (row.current === null || row.offer === null || excise === null) return { ...row, difference, details: [] };
    // Excise follows the kWh and is the same for every supplier; VAT follows the new taxable amount.
    return { ...row, difference, details: [
      { key: "EXCISE", label: "Accise", current: excise, offer: excise, difference: 0 },
      { key: "VAT", label: "IVA", current: cents(row.current - excise), offer: cents(row.offer - excise), difference: cents(row.offer - row.current) },
    ] };
  });
}

export function buildQuoteReceipt(input: QuoteReceiptInput): QuoteReceipt {
  const offerEnergy = cents(input.offerSupplyCost);
  const totals = input.analysis?.totals ?? null;
  const currentEnergy = totals ? sumKnown([totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal]) : null;
  const network = totals?.regulatedNetworkTotal ?? null;
  const system = totals?.systemChargesTotal ?? null;
  const currentTaxes = totals?.taxTotal ?? null;
  const printedRate = input.analysis ? billVatRate(input.analysis) : null;
  const vatRate = printedRate ?? (input.domestic && input.vector === "EE" ? 0.1 : 0.22);
  const taxesIncluded = currentTaxes !== null && currentEnergy !== null;
  const offerTaxes = taxesIncluded ? cents(currentTaxes + (offerEnergy - currentEnergy) * vatRate) : null;
  const rows: QuoteReceiptRow[] = [
    { key: "ENERGY", label: input.vector === "EE" ? "Spesa per la materia energia" : "Spesa per la materia gas naturale", current: currentEnergy, offer: offerEnergy },
    { key: "NETWORK", label: "Trasporto e gestione del contatore", current: network, offer: network },
    { key: "SYSTEM", label: "Oneri di sistema", current: system, offer: system },
    { key: "TAXES", label: "Imposte (accise e IVA)", current: taxesIncluded ? currentTaxes : null, offer: offerTaxes },
  ];
  if (currentEnergy === null) {
    return { status: "OFFER_ONLY", rows: withDetails(input, rows, false), currentTotal: null, offerTotal: null, savings: null, savingsPercent: null, taxesIncluded: false, vatRate: null, vatRateEstimated: false, validUntil: input.validUntil, quotas: quotasOf(input, null, offerEnergy, network, system, null, null) };
  }
  const shared = (network ?? 0) + (system ?? 0);
  const currentTotal = cents(currentEnergy + shared + (taxesIncluded ? currentTaxes : 0));
  const offerTotal = cents(offerEnergy + shared + (offerTaxes ?? 0));
  const savings = cents(currentTotal - offerTotal);
  const savingsPercent = currentTotal > 0 ? Math.round((savings / currentTotal) * 1000) / 10 : null;
  return { status: "COMPLETE", rows: withDetails(input, rows, true), currentTotal, offerTotal, savings, savingsPercent, taxesIncluded, vatRate: taxesIncluded ? vatRate : null, vatRateEstimated: taxesIncluded && printedRate === null, validUntil: input.validUntil, quotas: quotasOf(input, currentEnergy, offerEnergy, network, system, taxesIncluded ? currentTaxes : null, offerTaxes) };
}
