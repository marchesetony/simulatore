export const BILL_ECONOMIC_CLASSIFICATIONS = [
  "ENERGY_INDEX", "ENERGY_SPREAD", "ENERGY_FIXED_PRICE", "PCV", "COMMERCIALIZATION_FIXED_FEE", "COMMERCIALIZATION_VARIABLE_FEE", "SELLER_FIXED_FEE", "SELLER_ENERGY_FEE",
  "NETWORK_LOSS_CHARGE", "DISPATCHING_SELLER_CHARGE", "CAPACITY_MARKET_SELLER_CHARGE", "BALANCING_CHARGE", "OTHER_SELLER_ENERGY_CHARGE", "OTHER_SELLER_FIXED_CHARGE",
  "ARERA_NETWORK", "ARERA_SYSTEM_CHARGES", "TERNA_DISPATCHING_REFERENCES", "GME_MARKET_REFERENCE", "IVA", "ACCISE", "TAX_SUBTOTAL",
  "BONUS", "CANONE_RAI", "INTERESSI_MORA", "CMOR", "ADMINISTRATIVE_FEES", "DELIVERY_DISCOUNT", "SERVIZI_AGGIUNTIVI", "RICALCOLI", "RESTITUZIONI", "ADDEBITI", "ACCREDITI", "ALTRE_PARTITE",
  "UNCLASSIFIED_BILL_CHARGE", "BILL_TOTAL", "AMOUNT_DUE", "PRIOR_BALANCE",
] as const;

export type BillEconomicClassification = typeof BILL_ECONOMIC_CLASSIFICATIONS[number];
export type BillCalculationCheck = "MATCH" | "MISMATCH" | "NOT_CHECKABLE";
export type BillAccountingRole = "ATOMIC" | "DETAIL_INCLUDED_IN_SUBTOTAL" | "SUBTOTAL" | "TOTAL" | "PRIOR_BALANCE";
export type BillEconomicGroup = "ENERGY_PRICE" | "COMMERCIALIZATION" | "DISPATCHING_OR_PASS_THROUGH" | "CAPACITY_MARKET" | "OTHER_SELLER_CHARGES" | "REGULATED_NETWORK" | "SYSTEM_CHARGES" | "TAX" | "OTHER_ITEMS";

export interface BillEconomicComponentInput {
  readonly code?: string | null; readonly description?: string | null; readonly value?: string | number | null;
  readonly quantity?: string | number | null; readonly unit?: string | null; readonly unitPrice?: string | number | null; readonly amount?: string | number | null; readonly period?: string | null;
  readonly rawDescription?: string | null; readonly rawValue?: string | number | null; readonly rawUnit?: string | null; readonly rawQuantity?: string | number | null; readonly rawUnitPrice?: string | number | null; readonly rawAmount?: string | number | null; readonly rawPeriod?: string | null;
  readonly documentEvidence?: string | null; readonly status?: string;
}

export interface BillEconomicComponent {
  readonly lineId: string; readonly code: string; readonly normalizedCode: string; readonly classification: BillEconomicClassification; readonly group: BillEconomicGroup; readonly accountingRole: BillAccountingRole; readonly includedInReconciliation: boolean;
  readonly aggregate: boolean; readonly atomic: boolean; readonly parentComponent: string | null; readonly childComponents: readonly string[];
  readonly description: string; readonly quantity: string | null; readonly unitPrice: string | null; readonly unit: string | null; readonly amount: string | null; readonly period: string | null;
  readonly rawDescription: string; readonly rawValue: string; readonly rawUnit: string; readonly rawQuantity: string; readonly rawUnitPrice: string; readonly rawAmount: string; readonly rawPeriod: string;
  readonly documentEvidence: string; readonly calculationCheck: BillCalculationCheck; readonly status: string;
}

export interface BillEconomicTotals {
  readonly sellerEnergyTotal: number | null; readonly sellerCommercializationTotal: number | null; readonly sellerOtherTotal: number | null;
  readonly regulatedNetworkTotal: number | null; readonly systemChargesTotal: number | null; readonly taxTotal: number | null; readonly otherItemsTotal: number | null;
  readonly reconstructedCurrentSupplyTotal: number | null; readonly currentPeriodTotal: number | null; readonly priorBalanceTotal: number | null; readonly tvFeeTotal: number | null;
  readonly billTotal: number | null; readonly amountDue: number | null; readonly currentBillReconstructedTotal: number | null; readonly reconciliationDifference: number | null;
  readonly currentInvoiceAtomicTotal: number | null; readonly currentInvoiceAggregateTotal: number | null; readonly fiscalTotal: number | null; readonly extraordinaryTotal: number | null;
  readonly totalExcludingTvFee: number | null; readonly totalToPay: number | null; readonly previousDebtIncludedInCurrentInvoiceTotal: boolean | null;
  readonly reconciliationStatus: "RECONCILED" | "DIFFERENCE" | "NOT_RECONCILABLE";
}

export interface BillEconomicAnalysis {
  readonly priceType: "INDEXED_PUN_SPREAD" | "FIXED_PRICE" | "OTHER_INDEX" | "MIXED_FORMULA" | "NOT_DETERMINABLE";
  readonly components: readonly BillEconomicComponent[];
  readonly currentSellerCostBreakdown: Readonly<Record<"ENERGY_PRICE" | "COMMERCIALIZATION" | "DISPATCHING_OR_PASS_THROUGH" | "CAPACITY_MARKET" | "OTHER_SELLER_CHARGES", readonly BillEconomicComponent[]>>;
  readonly regulatedAndSystemCosts: Readonly<Record<"ARERA_NETWORK" | "ARERA_SYSTEM_CHARGES" | "TERNA_DISPATCHING_REFERENCES" | "GME_MARKET_REFERENCE", readonly BillEconomicComponent[]>>;
  readonly taxesAndOtherItems: Readonly<Record<"TAXES" | "OTHER_ITEMS", readonly BillEconomicComponent[]>>;
  readonly totals: BillEconomicTotals;
}

const text = (value: string | number | null | undefined): string => value === null || value === undefined ? "" : String(value).trim();
const keyOf = (value: string | null | undefined): string => text(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const numberFrom = (value: string | number | null | undefined): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const token = text(value).replace(/\s/g, "").replace(/[^0-9,.+%-]/g, "").replace(/%$/, "");
  if (!token) return null;
  const normalized = token.includes(",") ? token.replace(/\./g, "").replace(",", ".") : token.split(".").length > 2 ? token.replace(/\./g, "") : token;
  const valueNumber = Number(normalized);
  return Number.isFinite(valueNumber) ? valueNumber : null;
};
// Italian bills group thousands with a dot: "37.493 kWh" is 37493 kWh.
const quantityFrom = (value: string | number | null | undefined): number | null => { const token = typeof value === "string" ? value.match(/\d[\d.,]*/)?.[0] ?? "" : ""; return /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(token) ? Number(token.replace(/\./g, "")) : numberFrom(value); };
const round = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const canonicalUnit = (value: string): string => text(value).toUpperCase().replace(/[€â‚¬Ã¢â€šÂ¬]/g, "EUR").replace(/\s+/g, "").replace(/PER/g, "/").replace(/YEAR/g, "ANNO").replace(/MONTH/g, "MESE");

export function classifyBillEconomicComponent(code: string | null | undefined, description = ""): BillEconomicClassification {
  const c = keyOf(code); const d = keyOf(description);
  // A prior-period adjustment ("Conguaglio dei mesi precedenti") is a recalculation whatever charge it repeats.
  if (["RICALCOLI", "RECALCULATION"].includes(c) || d.includes("RICALCOL") || d.includes("CONGUAGLIO")) return "RICALCOLI";
  if (["PUN", "PUN_SINGLE", "PUN_F1", "PUN_F2", "PUN_F3", "ENERGY_INDEX", "PUN_APPLICATO"].includes(c) || d.includes("PUN")) return "ENERGY_INDEX";
  if (["SPREAD", "SELLER_SPREAD", "ENERGY_SPREAD"].includes(c) || d.includes("SPREAD")) return "ENERGY_SPREAD";
  // Tony (30/10, bolletta Plenitude Trend Business Luce Base: "credo che la lettura non è stata fatta"): the elementi di
  // dettaglio name the seller's charges by contract or resolution, and they were all left out as other items.
  if (/^PERDITE_(SU|ART|ARTICOLO|DI)_/.test(d)) return "NETWORK_LOSS_CHARGE";
  if (d.includes("CORRISPETTIVO") && /(^|_)INDEX(_|$)/.test(d)) return "ENERGY_INDEX";
  if (d.startsWith("CONTRIBUTO_AL_CONSUMO")) return "ENERGY_SPREAD";
  // Delibera ARG/elt 98/11 is the capacity market; TIDE art. 25 and TIS are dispatching charges passed on by the seller.
  if (/ARG_ELT_98_11/.test(d)) return "CAPACITY_MARKET_SELLER_CHARGE";
  if (/(^|_)(TIDE|TIS)(_|$)/.test(d) && /^ART(ICOLO)?_/.test(d)) return "DISPATCHING_SELLER_CHARGE";
  if (/^SPESA_PER_LA_TARIFFA_PER_L_USO_DELLA_RETE_.+/.test(d)) return "ARERA_NETWORK";
  if (/^SPESA_PER_GLI_ONERI_GENERALI_DI_SISTEMA_.+/.test(d)) return "ARERA_SYSTEM_CHARGES";
  if (["ENERGY_FIXED_PRICE", "FIXED_PRICE", "PREZZO_FISSO"].includes(c) || d.includes("PREZZO_FISSO")) return "ENERGY_FIXED_PRICE";
  if (c === "PCV" || /^PCV(?:_|$)/.test(d)) return "PCV";
  if (c === "COMMERCIALIZATION" && d.includes("SPESA_PER_LA_VENDITA_DI_ENERGIA_ELETTRICA")) return "SELLER_ENERGY_FEE";
  if (["COMMERCIALIZATION_FIXED_FEE", "COMMERCIALIZATION", "COMMERCIALIZATION_FEE"].includes(c) || d.includes("COMMERCIALIZZ") || d.includes("QUOTA_COMMERCIALE")) return "COMMERCIALIZATION_FIXED_FEE";
  if (c === "COMMERCIALIZATION_VARIABLE_FEE") return "COMMERCIALIZATION_VARIABLE_FEE";
  if (["SELLER_FIXED", "SELLER_FIXED_FEE"].includes(c) || (d.includes("VENDITA") && d.includes("QUOTA_FISSA"))) return "SELLER_FIXED_FEE";
  if (c === "SELLER_ENERGY_FEE" || (d.includes("VENDITA") && d.includes("ENERGIA"))) return "SELLER_ENERGY_FEE";
  if (c === "NETWORK_LOSS_CHARGE" || d.includes("PERDITE_DI_RETE")) return "NETWORK_LOSS_CHARGE";
  if (["DISPATCHING", "DISPATCHING_SELLER_CHARGE"].includes(c) || d.includes("DISPACCIAMENTO")) return "DISPATCHING_SELLER_CHARGE";
  if (["CAPACITY_MARKET", "CAPACITY_MARKET_SELLER_CHARGE"].includes(c) || d.includes("CAPACITY_MARKET")) return "CAPACITY_MARKET_SELLER_CHARGE";
  if (["IMBALANCE", "BALANCING_CHARGE"].includes(c) || d.includes("SBILANCIAMENTO") || d.includes("BALANC")) return "BALANCING_CHARGE";
  if (["OTHER_SELLER_ENERGY_CHARGE", "OTHER_SELLER_FIXED_CHARGE"].includes(c)) return c as BillEconomicClassification;
  // Tony (30/10): "Quota variabile smart (CVS) 0,025 €/kWh" and "Quota variabile voci di trasporto 0,01 €/kWh" are the
  // seller's own per-kWh charges ("sono dei costi che il venditore camuffa"): they belong to the spesa per la vendita, not to the ARERA transport or the other items.
  if (/^QUOTA_VARIABILE_.*(SMART|CVS)/.test(d)) return "COMMERCIALIZATION_VARIABLE_FEE";
  if (/^QUOTA_VARIABILE_VOCI_DI_/.test(d)) return "OTHER_SELLER_ENERGY_CHARGE";
  if (["NETWORK_SYSTEM", "NETWORK_FIXED", "POWER_CHARGE", "METERING_FIXED", "NETWORK_ENERGY", "NETWORK_POWER", "TRANSMISSION_ENERGY"].includes(c)) return "ARERA_NETWORK";
  if (["ASOS", "ARIM", "UC3", "UC6", "ARERA_SYSTEM_CHARGES"].includes(c)) return "ARERA_SYSTEM_CHARGES";
  if (["TERNA_DISPATCHING_REFERENCES", "DISPATCHING_TERNA_OPERATION", "DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION"].includes(c)) return "TERNA_DISPATCHING_REFERENCES";
  if (c === "GME_MARKET_REFERENCE") return "GME_MARKET_REFERENCE";
  if (["BILL_TOTAL", "TOTAL_BILL"].includes(c) || d === "TOTALE_BOLLETTA") return "BILL_TOTAL";
  if (["AMOUNT_DUE", "TOTAL_AMOUNT_DUE"].includes(c) || d === "TOTALE_DA_PAGARE") return "AMOUNT_DUE";
  if (["PRIOR_BALANCE", "PREVIOUS_BALANCE", "OUTSTANDING_AMOUNT"].includes(c) || d.includes("IMPORTO_INSOLUTO") || d.includes("SALDO_PRECEDENTE")) return "PRIOR_BALANCE";
  if (["TAX_SUBTOTAL", "EXCISE_VAT_SUBTOTAL"].includes(c) || d === "ACCISE_E_IVA" || d.includes("TOTALE_IMPOSTE")) return "TAX_SUBTOTAL";
  if (["VAT", "IVA"].includes(c) || /(^|_)IVA(_|$)/.test(d)) return "IVA";
  if (["EXCISE", "ACCISE"].includes(c) || /(^|_)ACCISA?(_|$)/.test(d)) return "ACCISE";
  if (["CANONE_RAI", "TV_FEE", "RAI"].includes(c) || d.includes("CANONE_DI_ABBONAMENTO") || d.includes("TELEVISIONE")) return "CANONE_RAI";
  if (["INTERESSI_MORA", "LATE_PAYMENT", "INTEREST_ON_ARREARS"].includes(c) || d.includes("INTERESSI_DI_MORA") || d === "MORA" || d.includes("SOLLECITO") || d.includes("RITARDATO_PAGAMENTO")) return "INTERESSI_MORA";
  if (c === "CMOR" || d.includes("CMOR")) return "CMOR";
  if (["ADMINISTRATIVE_FEES", "ADMINISTRATIVE_FEE"].includes(c) || d.includes("ONERI_AMMINISTRATIVI")) return "ADMINISTRATIVE_FEES";
  if (["DELIVERY_DISCOUNT", "DISCOUNT"].includes(c) || d.includes("SCONTO")) return "DELIVERY_DISCOUNT";
  if (["BONUS"].includes(c) || d.includes("BONUS")) return "BONUS";
  if (["SERVIZI_AGGIUNTIVI", "ADDITIONAL_SERVICES"].includes(c) || d.includes("SERVIZI_AGGIUNTIVI")) return "SERVIZI_AGGIUNTIVI";
  if (["RESTITUZIONI", "REFUNDS"].includes(c)) return "RESTITUZIONI";
  if (["ADDEBITI", "DEBITS"].includes(c)) return "ADDEBITI";
  if (["ACCREDITI", "CREDITS"].includes(c)) return "ACCREDITI";
  if (["ALTRE_PARTITE", "OTHER_ITEMS", "OTHER_CHARGE"].includes(c)) return "ALTRE_PARTITE";
  // Bolletta 2.0 wording when the reader gave a descriptive code (e.g. Repower: "F0 - energia (monoraria)",
  // "Corrispettivo capacità fuori picco", "Corrispettivo distribuzione, misura e trasporto", "Imposta Erariale").
  if (d.includes("REATTIV")) return "UNCLASSIFIED_BILL_CHARGE";
  if (d.includes("CAPACIT_") || d.includes("CAPACITA")) return "CAPACITY_MARKET_SELLER_CHARGE";
  if (d.includes("SERVIZIO_DI_VENDITA") || d.includes("CORRISPETTIVO_DI_VENDITA")) return "SELLER_ENERGY_FEE";
  if (d.includes("ENERGIA") && (/(^|_)F[0-3](_|$)/.test(d) || d.includes("MONORARI") || d.includes("FASCIA"))) return "SELLER_ENERGY_FEE";
  if (/(^|_)(ASOS|ARIM)(_|$)/.test(d) || (/^ONERI_(GENERALI_)?DI_SISTEMA/.test(d) && !d.startsWith("TOTALE"))) return "ARERA_SYSTEM_CHARGES";
  if (d.includes("DISTRIBUZIONE") || d.includes("TRASMISSIONE") || /(^|_)MISURA(_|$)/.test(d) || d.includes("TRASPORTO")) return "ARERA_NETWORK";
  if (d.includes("IMPOSTA_ERARIALE") || d.includes("IMPOSTE_ERARIALI")) return "ACCISE";
  // BPower prints the seller's monthly fee as "QF" (Tony, 27/10).
  if (d === "QF" || d.startsWith("QF_")) return "SELLER_FIXED_FEE";
  return "UNCLASSIFIED_BILL_CHARGE";
}

function groupOf(c: BillEconomicClassification): BillEconomicGroup {
  if (["ENERGY_INDEX", "ENERGY_SPREAD", "ENERGY_FIXED_PRICE", "SELLER_ENERGY_FEE", "NETWORK_LOSS_CHARGE"].includes(c)) return "ENERGY_PRICE";
  if (["PCV", "COMMERCIALIZATION_FIXED_FEE", "COMMERCIALIZATION_VARIABLE_FEE", "SELLER_FIXED_FEE"].includes(c)) return "COMMERCIALIZATION";
  if (["DISPATCHING_SELLER_CHARGE", "BALANCING_CHARGE"].includes(c)) return "DISPATCHING_OR_PASS_THROUGH";
  if (c === "CAPACITY_MARKET_SELLER_CHARGE") return "CAPACITY_MARKET";
  if (c === "ARERA_NETWORK") return "REGULATED_NETWORK";
  if (c === "ARERA_SYSTEM_CHARGES") return "SYSTEM_CHARGES";
  if (["TERNA_DISPATCHING_REFERENCES", "GME_MARKET_REFERENCE"].includes(c)) return "OTHER_ITEMS";
  if (["IVA", "ACCISE", "TAX_SUBTOTAL"].includes(c)) return "TAX";
  if (["OTHER_SELLER_ENERGY_CHARGE", "OTHER_SELLER_FIXED_CHARGE"].includes(c)) return "OTHER_SELLER_CHARGES";
  return "OTHER_ITEMS";
}

function calculationCheck(input: { quantity: string; unitPrice: string; unit: string; amount: string }): BillCalculationCheck {
  const q = quantityFrom(input.quantity); const p = numberFrom(input.unitPrice); const a = numberFrom(input.amount); if (q === null || p === null || a === null) return "NOT_CHECKABLE";
  const unit = canonicalUnit(input.unit); const expected = unit.includes("CENT") && unit.includes("KWH") ? q * p / 100 : unit.includes("/MWH") && keyOf(input.quantity).includes("KWH") ? q * p / 1000 : unit.includes("/KWH") || unit === "EUR" || unit.includes("/MESE") || unit.includes("/ANNO") || unit.includes("/KW/") ? q * p : null;
  return expected === null ? "NOT_CHECKABLE" : Math.abs(round(expected) - round(a)) <= 0.02 ? "MATCH" : "MISMATCH";
}

function accountingRole(classification: BillEconomicClassification, description: string): BillAccountingRole {
  const key = keyOf(description);
  if (classification === "BILL_TOTAL") return "TOTAL";
  if (classification === "AMOUNT_DUE") return "TOTAL";
  if (classification === "PRIOR_BALANCE") return "PRIOR_BALANCE";
  if (classification === "TAX_SUBTOTAL" || key.includes("SUBTOTALE") || key.includes("TOTALE_SEZIONE")) return "SUBTOTAL";
  if (aggregateDescription(key)) return "SUBTOTAL";
  return "ATOMIC";
}

// The Box dell'offerta restates the seller's spend ("Totale spesa dovuta per l'offerta", "di cui quota spesa consumi"):
// a summary of the quadro sintetico's "di cui spesa per la vendita", never money of its own (Tony, 29/10).
function aggregateDescription(key: string): boolean {
  return key.startsWith("TOTALE_SPESA_DOVUTA") || key.startsWith("DI_CUI_QUOTA_SPESA") || key.includes("TOTALE_VENDITA") || key.includes("TOTALE_TARIFFA") || key.includes("TOTALE_ONERI") || key === "TOTALE_IMPOSTE" || key === "TOTALE_FORNITURA" || key === "TOTALE_BOLLETTA" || key === "TOTALE_DA_PAGARE";
}

function isDuplicatedSectionSummary(component: BillEconomicComponent): boolean {
  const key = keyOf(component.description);
  return key.startsWith("DI_CUI_SPESA_PER_VENDITA_ENERGIA_ELETTRICA")
    || key.startsWith("DI_CUI_SPESA_PER_LA_RETE_E_ONERI_GENERALI_DI_SISTEMA")
    || key === "QUOTA_FISSA_TOTALE"
    || key === "QUOTA_POTENZA"
    || key === "ENERGIA_REATTIVA";
}

// The Box dell'offerta lists the value of each element of the price formula ("Dispacciamento: 0,010501 €/kWh") with no
// quantity: that is a unit price, not money billed (Tony, 27/10, bolletta BPower Be Smart: read as 0,01 € of dispatching).
const SELLER_PRICE_CODE = /^(?:ENERGY_PRICE(?:_F\d)?|PUN_(?:SINGLE|F\d)|ENERGY_INDEX|ENERGY_SPREAD|ENERGY_FIXED_PRICE|SPREAD|DISPATCHING(?:_SELLER_CHARGE)?|CAPACITY_MARKET(?:_SELLER_CHARGE)?|COMMERCIALIZATION(?:_VARIABLE_FEE)?|SELLER_ENERGY_FEE|IMBALANCE|BALANCING_CHARGE|NETWORK_LOSS_CHARGE)$/;
const PER_UNIT = /(?:€|eur(?:o)?|c€|cent)\s*\/\s*(?:k?wh|kw|kvarh|mese|anno|giorno|smc|pod|pdr)/i;
function unitPriceOnly(amount: string | null, quantity: string | null, unitPrice: string | null, code: string | null = null, unit: string | null = null, sellerPrice = false): boolean {
  if (amount === null) return false;
  if (PER_UNIT.test(amount)) return true;
  const value = numberFrom(amount); const price = numberFrom(unitPrice);
  if (value === null || Math.abs(value) >= 1) return false;
  const priceCode = code !== null && SELLER_PRICE_CODE.test(code);
  if (quantity !== null) {
    // The archived reading also kept the kWh of the period next to the Box price (Tony, 28/10: still 0,01 € of dispatching
    // and 964,20 € of energy): a few cents on thousands of kWh of a price-formula line is the price itself, not money billed.
    const digits = text(quantity).replace(/[^0-9,.]/g, "");
    const kwh = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(digits) ? numberFrom(digits.replace(/\./g, "")) : numberFrom(digits);
    if (kwh === null || kwh < 10 || !(sellerPrice || priceCode)) return false;
    if (price !== null && Math.abs(value - price) < 0.005) return true;
    // Quantity x price giving the amount is money billed, however small (Plenitude, 30/10: "Articolo 25.5 TIDE" 0,000652
    // EUR/kWh x 232 kWh = 0,15 EUR).
    if (price !== null && price !== 0 && Math.abs(kwh * price - value) <= 0.01) return false;
    return Math.abs(value / kwh) < 0.001;
  }
  // The stored reading keeps the €/kWh of the Box in the unit, not in the amount (Tony, 28/10: still 0,01 € of dispatching).
  if (unit !== null && PER_UNIT.test(unit)) return true;
  // A seller price-formula line carrying a quantity unit (kWh) but no quantity is the same Box value.
  if (sellerPrice && unit !== null && !/^(?:€|eur(?:o)?)$/i.test(unit.trim())) return true;
  // Also when the reading rounded the unit price to cents (0,010501 read as 0,01 €; Tony, 28/10), or kept only that.
  if (price !== null) return Math.abs(value - price) < 0.005;
  return priceCode;
}

export function normalizeBillEconomicComponent(input: BillEconomicComponentInput): BillEconomicComponent {
  const description = text(input.description ?? input.rawDescription); const quantity = text(input.quantity ?? input.rawQuantity) || null; const unit = text(input.unit ?? input.rawUnit) || null; const unitPrice = text(input.unitPrice ?? input.rawUnitPrice) || null; const amount = text(input.amount ?? input.rawAmount) || null; const period = text(input.period ?? input.rawPeriod) || null;
  const rawDescription = text(input.rawDescription ?? description); const rawValue = text(input.rawValue ?? input.value ?? input.amount ?? input.unitPrice ?? ""); const rawUnit = text(input.rawUnit ?? unit); const rawQuantity = text(input.rawQuantity ?? quantity); const rawUnitPrice = text(input.rawUnitPrice ?? unitPrice); const rawAmount = text(input.rawAmount ?? amount); const rawPeriod = text(input.rawPeriod ?? period);
  const code = text(input.code) || "UNCLASSIFIED_BILL_CHARGE"; const key = keyOf(description); const classification = classifyBillEconomicComponent(code, description); const role = unitPriceOnly(amount, quantity, unitPrice, text(input.code) || null, unit, ["ENERGY_PRICE", "COMMERCIALIZATION", "DISPATCHING_OR_PASS_THROUGH", "CAPACITY_MARKET", "OTHER_SELLER_CHARGES"].includes(groupOf(classification))) ? "DETAIL_INCLUDED_IN_SUBTOTAL" : accountingRole(classification, description);
  const normalizedCode = code !== "UNCLASSIFIED_BILL_CHARGE" ? code : key.includes("TOTALE_VENDITA") ? "TOTAL_SELLER_ENERGY" : key.includes("TOTALE_TARIFFA") ? "TOTAL_NETWORK_TARIFF" : key.includes("TOTALE_ONERI") ? "TOTAL_SYSTEM_CHARGES" : key === "TOTALE_IMPOSTE" ? "TAX_SUBTOTAL" : key === "TOTALE_FORNITURA" ? "TOTAL_SUPPLY" : key === "TOTALE_BOLLETTA" ? "BILL_TOTAL" : key === "TOTALE_DA_PAGARE" ? "AMOUNT_DUE" : code;
  return { lineId: "", code, normalizedCode, classification, group: groupOf(classification), accountingRole: role, includedInReconciliation: role === "ATOMIC", aggregate: role !== "ATOMIC" && role !== "PRIOR_BALANCE", atomic: role === "ATOMIC", parentComponent: null, childComponents: [], description: description || rawDescription || "Voce economica non descritta", quantity, unitPrice, unit, amount, period, rawDescription, rawValue, rawUnit, rawQuantity, rawUnitPrice, rawAmount, rawPeriod, documentEvidence: text(input.documentEvidence ?? rawDescription), calculationCheck: calculationCheck({ quantity: rawQuantity, unitPrice: rawUnitPrice, unit: rawUnit, amount: rawAmount }), status: text(input.status) || "FOUND" };
}

const sum = (items: readonly BillEconomicComponent[]): number | null => { const values = items.filter((item) => item.includedInReconciliation).map((item) => numberFrom(item.amount)).filter((value): value is number => value !== null); return values.length ? round(values.reduce((a, b) => a + b, 0)) : null; };
const sumClass = (items: readonly BillEconomicComponent[], classifications: readonly BillEconomicClassification[]): number | null => sum(items.filter((item) => classifications.includes(item.classification)));

function priceType(items: readonly BillEconomicComponent[]): BillEconomicAnalysis["priceType"] {
  const hasPun = items.some((item) => item.classification === "ENERGY_INDEX"); const hasSpread = items.some((item) => item.classification === "ENERGY_SPREAD"); const hasFixed = items.some((item) => item.classification === "ENERGY_FIXED_PRICE");
  if (hasPun && hasSpread && !hasFixed) return "INDEXED_PUN_SPREAD"; if (hasFixed && !hasPun) return "FIXED_PRICE"; if (hasPun || hasSpread || hasFixed) return "MIXED_FORMULA"; return "NOT_DETERMINABLE";
}

export interface BillEconomicAnalysisOptions { readonly sourceBillTotal?: string | number | null; readonly sourceAmountDue?: string | number | null; readonly priorBalance?: string | number | null; /** ISO start of the billed period: lines that end before it are prior-period adjustments. */ readonly billingPeriodStart?: string | null; }

const isoDates = (value: string | null): readonly string[] => [...(value ?? "").matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g)].map((match) => `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
const asRecalculation = (item: BillEconomicComponent): BillEconomicComponent => ({ ...item, classification: "RICALCOLI", group: "OTHER_ITEMS" });

// A bill prints the same money more than once: the quadro sintetico ("Quota energia", "di cui spesa per la vendita"),
// section totals ("TOTALE"), summary tables (IMPOSTE, ONERI GENERALI) and the elementi di dettaglio. Only the bill's
// own total tells which copy is the atomic one, so each family of summary-looking lines is dropped only when that makes
// the lines add up to the total (or brings them closest to it).
const SUMMARY_KEYS = new Set(["QUOTA_ENERGIA", "QUOTA_FISSA", "QUOTA_POTENZA", "QUOTA_PER_CONSUMI", "QUOTA_PER_I_CONSUMI", "QUOTA_FISSA_E_QUOTA_POTENZA", "ACCISE_E_IVA", "RICALCOLI", "ULTERIORI_VOCI"]);
function summaryFamilies(items: readonly BillEconomicComponent[]): readonly (readonly string[])[] {
  // Lines rebuilt from the quadro sintetico are the bill's own transport: never dropped to make the sum match.
  const atomic = items.filter((item) => item.includedInReconciliation && item.classification !== "BILL_TOTAL" && item.classification !== "AMOUNT_DUE" && item.code !== "NETWORK_FROM_SUMMARY");
  const key = (item: BillEconomicComponent) => blockLabel(item.description);
  const priced = (item: BillEconomicComponent) => numberFrom(item.quantity) !== null && numberFrom(item.unitPrice) !== null;
  const ids = (matcher: (item: BillEconomicComponent) => boolean) => atomic.filter(matcher).map((item) => item.lineId);
  const seen = new Map<string, string>();
  const duplicates = atomic.filter((item) => {
    const signature = `${item.classification}|${numberFrom(item.amount)}|${numberFrom(item.quantity) ?? ""}`;
    if (numberFrom(item.amount) === null) return false;
    if (seen.has(signature)) return true;
    seen.set(signature, item.lineId);
    return false;
  }).map((item) => item.lineId);
  return [
    ids((item) => key(item) === "TOTALE" || key(item).startsWith("TOTALE_")),
    // The quadro sintetico's "di cui vendita / rete e oneri" and the Box dell'offerta's "di cui quota spesa" are different copies.
    ids((item) => key(item).startsWith("DI_CUI") && /VENDITA|RETE/.test(key(item))),
    ids((item) => key(item).startsWith("DI_CUI") && !/VENDITA|RETE/.test(key(item))),
    ids((item) => SUMMARY_KEYS.has(key(item)) || SUMMARY_KEYS.has(key(item).replace(/(_\d+)+$/, "")) || key(item).startsWith("SPESA_PER_") || key(item).startsWith("RICALCOLI_") || (key(item).startsWith("ENERGIA_REATTIVA") && !/(^|_)F[1-3](_|$)/.test(key(item)))),
    duplicates,
    ids((item) => !priced(item) && atomic.some((other) => other.lineId !== item.lineId && other.classification === item.classification && priced(other)) && item.classification !== "NETWORK_LOSS_CHARGE" && item.classification !== "RICALCOLI"),
  ].filter((family) => family.length > 0);
}
function withoutSummaries(items: readonly BillEconomicComponent[], total: number | null): readonly BillEconomicComponent[] {
  if (total === null) return items;
  const families = summaryFamilies(items);
  const current = (excluded: ReadonlySet<string>) => sum(items.filter((item) => !excluded.has(item.lineId) && reconcilable(item)));
  let best: { readonly excluded: ReadonlySet<string>; readonly difference: number } | null = null;
  for (let mask = 0; mask < 1 << families.length; mask += 1) {
    const excluded = new Set(families.filter((_, index) => mask & (1 << index)).flat());
    const value = current(excluded);
    if (value === null) continue;
    const difference = Math.abs(round(value - total));
    if (!best || difference < best.difference - 0.005 || (Math.abs(difference - best.difference) <= 0.005 && excluded.size < best.excluded.size)) best = { excluded, difference };
  }
  if (!best || best.excluded.size === 0) return items;
  const excluded = best.excluded;
  return items.map((item) => excluded.has(item.lineId) ? { ...item, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL" as const, includedInReconciliation: false, atomic: false } : item);
}
// A bill that prints only the quadro sintetico gives "spesa per la rete e gli oneri generali di sistema" per quota, and the
// oneri page splits ASOS/ARIM per quota: transport and metering are the difference (Bolletta 2.0, delibera 501/2014/R/com).
// Tony, 27/10, bolletta BPower: 171,77 - 117,65 = 54,12 quota energia, 3,81 - 1,36 = 2,45 quota fissa, 67,39 - 24,05 =
// 43,34 quota potenza, the transport lines of the detailed bill.
type SummaryQuota = "CONSUMPTION" | "FIXED" | "POWER";
// The reading may prefix a line with its block ("Quota fissa e Quota potenza - di cui spesa per la rete..."): the unit
// decides first, then the line's own label, then the block, whose first quota is the one its "di cui" lines belong to (Tony,
// 29/10, bolletta Minniti Casa Protetta: the quota fissa 1,92 EUR of transport was taken as a second quota potenza).
const labelOf = (description: string): { readonly section: string; readonly label: string } => { const parts = description.split(/\s+[-–]\s+/); return { section: keyOf(parts.slice(0, -1).join(" ")), label: keyOf(parts.at(-1)) }; };
// Only a quadro sintetico block ("Quota ...") is a prefix to drop: "Oneri di sistema - quota energia" stays an oneri line.
const blockLabel = (description: string): string => { const { section, label } = labelOf(description); return section === "" || section.startsWith("QUOTA") ? label : keyOf(description); };
const quotaOfKey = (key: string): SummaryQuota | null => { const at = (pattern: RegExp) => { const match = pattern.exec(key); return match ? match.index : Number.POSITIVE_INFINITY; }; const power = at(/POTENZA|(^|_)KW(_|$)/), fixed = at(/FISS|(^|_)(MESE|POD|GIORN[OI]|GG)(_|$)/), consumption = at(/CONSUM|VARIABIL|(^|_)K?WH(_|$)/); const first = Math.min(power, fixed, consumption); return first === Number.POSITIVE_INFINITY ? null : first === fixed ? "FIXED" : first === power ? "POWER" : "CONSUMPTION"; };
const unitQuota = (unit: string | null): SummaryQuota | null => { const key = keyOf(unit); return /(^|_)KW(_|$)/.test(key) ? "POWER" : /(^|_)(MESE|POD|GIORN[OI]|GG|ANNO)(_|$)/.test(key) ? "FIXED" : /(^|_)(K?WH|SMC)(_|$)/.test(key) ? "CONSUMPTION" : null; };
const summaryQuota = (item: BillEconomicComponent): SummaryQuota => { const { section, label } = labelOf(item.description); return unitQuota(item.unit) ?? quotaOfKey(label) ?? quotaOfKey(section) ?? "CONSUMPTION"; };
const isNetworkAndSystemSummary = (item: BillEconomicComponent): boolean => /RETE_E_(GLI_)?ONERI/.test(keyOf(item.description));
// A line priced per day (€/giorno) is the quota fissa (Tony, 28/10, BPower Casa Protetta: "di cui spesa per la rete" 8,86 € at
// 0,328148 €/giorno).
// A system-charge line names its quota; one that names none (a page total, an ASOS/ARIM line without quota) has none.
const systemQuota = (item: BillEconomicComponent): SummaryQuota | null => { const key = keyOf(`${item.description} ${item.unit ?? ""}`); return key.includes("POTENZA") || /(^|_)KW(_|$)/.test(key) ? "POWER" : key.includes("FISS") || key.includes("MESE") || key.includes("POD") || /(^|_)(GIORN[OI]|GG)(_|$)/.test(key) ? "FIXED" : /CONSUM|VARIABIL|ENERGIA|(^|_)K?WH(_|$)/.test(key) ? "CONSUMPTION" : null; };
/** The bill can show the oneri twice, per quota and as one total or a list without quota (Tony, 28/10, BPower Be Smart:
 *  24,05 + 117,65 + 1,36 and again 143,06): the lines without quota that add up to the per-quota ones are the same money. */
function systemChargeViews(items: readonly BillEconomicComponent[]): readonly BillEconomicComponent[] {
  const live = (item: BillEconomicComponent) => item.includedInReconciliation && numberFrom(item.amount) !== null && item.classification === "ARERA_SYSTEM_CHARGES" && !isNetworkAndSystemSummary(item);
  const total = (list: readonly BillEconomicComponent[]) => round(list.reduce((sum, item) => sum + (numberFrom(item.amount) ?? 0), 0));
  const tagged = items.filter((item) => live(item) && systemQuota(item) !== null); const untagged = items.filter((item) => live(item) && systemQuota(item) === null);
  if (!tagged.length || !untagged.length || Math.abs(total(tagged) - total(untagged)) > 0.02) return items;
  const duplicate = new Set(untagged.map((item) => item.lineId));
  return items.map((item) => duplicate.has(item.lineId) ? { ...item, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL", includedInReconciliation: false, atomic: false, aggregate: true } : item);
}
function networkFromSummary(items: readonly BillEconomicComponent[]): readonly BillEconomicComponent[] {
  const live = (item: BillEconomicComponent) => item.includedInReconciliation && numberFrom(item.amount) !== null;
  const summaries = items.filter((item) => live(item) && isNetworkAndSystemSummary(item));
  const oneri = items.filter((item) => live(item) && item.classification === "ARERA_SYSTEM_CHARGES" && !isNetworkAndSystemSummary(item));
  // Tony (30/10, bolletta Elios CER Smart1 Casa: "mancano i dati"): the oneri page lists ASOS 10,18 and ARIM 0,53 with no
  // quota. They are then taken from the quota per consumi, where the oneri are billed per kWh: the transport total stays the
  // bill's rete e oneri less its oneri, 40,55 - 10,71 = 29,84 EUR.
  const tagged = oneri.filter((item) => systemQuota(item) !== null);
  const system = tagged.length ? tagged : oneri;
  const quotaOfSystem = (item: BillEconomicComponent): SummaryQuota | null => tagged.length ? systemQuota(item) : "CONSUMPTION";
  if (!summaries.length || !system.length) return items;
  const replaced = new Map<string, BillEconomicComponent>();
  for (const quota of ["CONSUMPTION", "FIXED", "POWER"] as const) {
    const [first, ...copies] = summaries.filter((item) => summaryQuota(item) === quota);
    if (!first) continue;
    const systemAmount = round(system.filter((item) => quotaOfSystem(item) === quota).reduce((total, item) => total + (numberFrom(item.amount) ?? 0), 0));
    const detailed = items.filter((item) => live(item) && item.classification === "ARERA_NETWORK" && !isNetworkAndSystemSummary(item) && summaryQuota(item) === quota);
    if (detailed.length) {
      // The quota is already read line by line: its "rete e oneri" summary is the same money, not a second charge.
      const read = round(detailed.reduce((total, item) => total + (numberFrom(item.amount) ?? 0), 0));
      if (Math.abs(round((numberFrom(first.amount) ?? 0) - systemAmount) - read) <= 0.02) for (const copy of [first, ...copies]) replaced.set(copy.lineId, { ...copy, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL", includedInReconciliation: false, atomic: false, aggregate: true });
      continue;
    }
    const network = round((numberFrom(first.amount) ?? 0) - systemAmount);
    const label = quota === "CONSUMPTION" ? "quota energia" : quota === "FIXED" ? "quota fissa" : "quota potenza";
    replaced.set(first.lineId, { ...first, code: "NETWORK_FROM_SUMMARY", normalizedCode: "NETWORK_FROM_SUMMARY", classification: "ARERA_NETWORK", group: "REGULATED_NETWORK", accountingRole: "ATOMIC", atomic: true, aggregate: false, amount: network.toFixed(2).replace(".", ","), quantity: null, unitPrice: null, calculationCheck: "NOT_CHECKABLE", description: `Trasporto e gestione del contatore, ${label}: rete e oneri del quadro sintetico ${numberFrom(first.amount)?.toFixed(2).replace(".", ",")} € meno oneri di sistema ${systemAmount.toFixed(2).replace(".", ",")} €` });
    for (const copy of copies) replaced.set(copy.lineId, { ...copy, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL", includedInReconciliation: false, atomic: false });
  }
  return items.map((item) => replaced.get(item.lineId) ?? item);
}
// Bolletta 2.0 (delibera 501/2014/R/com) prints each quota as a total followed by its "di cui spesa per la vendita" and "di
// cui spesa per la rete e gli oneri generali di sistema": the total is the same money as its parts. Tony, 29/10, bolletta
// Minniti Casa Protetta: "stai inserendo dei calcoli che già sono presenti in altre voci e li stai conteggiando due volte"
// (the quota fissa total 14,92 = PCV 13,00 + transport 1,92 was kept as a charge of its own, and the transport lines were
// dropped to make the sum match). When the reading kept the total and the seller's part only, the rest is rete e oneri.
const QUOTA_TOTALS: Readonly<Record<string, SummaryQuota>> = { QUOTA_PER_CONSUMI: "CONSUMPTION", QUOTA_PER_I_CONSUMI: "CONSUMPTION", QUOTA_ENERGIA: "CONSUMPTION", QUOTA_VARIABILE: "CONSUMPTION", QUOTA_FISSA: "FIXED", QUOTA_FISSA_E_QUOTA_POTENZA: "FIXED", QUOTA_FISSA_TOTALE: "FIXED", QUOTA_POTENZA: "POWER" };
function quotaTotals(items: readonly BillEconomicComponent[]): readonly BillEconomicComponent[] {
  const live = (item: BillEconomicComponent) => item.includedInReconciliation && numberFrom(item.amount) !== null;
  const totals: { readonly item: BillEconomicComponent; readonly quota: SummaryQuota }[] = [];
  const parts = new Map<string, { item: BillEconomicComponent; side: "SELLER" | "NETWORK_SYSTEM" }[]>();
  let open: { readonly item: BillEconomicComponent; readonly quota: SummaryQuota } | null = null;
  for (const item of items) {
    const label = blockLabel(item.description);
    // "Quota potenza 6" (Elios, 30/10): the kW printed in the label is still the quota potenza total.
    const quota = QUOTA_TOTALS[label] ?? QUOTA_TOTALS[label.replace(/(_\d+)+$/, "")];
    if (quota && live(item)) { open = { item, quota }; totals.push(open); parts.set(item.lineId, []); continue; }
    if (!label.startsWith("DI_CUI") || !live(item)) continue;
    const side = /RETE/.test(label) ? "NETWORK_SYSTEM" : /VENDITA/.test(label) ? "SELLER" : null;
    if (side === null) continue;
    // A "di cui" belongs to the total above it unless its unit or label names another quota (the quota potenza of the
    // "Quota fissa e Quota potenza" block).
    const own = unitQuota(item.unit) ?? quotaOfKey(label);
    const owner = own === null || own === open?.quota ? open : [...totals].reverse().find((total) => total.quota === own) ?? null;
    if (owner) parts.get(owner.item.lineId)?.push({ item, side });
  }
  const replaced = new Map<string, BillEconomicComponent>();
  for (const { item, quota } of totals) {
    const children = parts.get(item.lineId) ?? [];
    if (!children.length) continue;
    const total = numberFrom(item.amount) ?? 0;
    const summed = round(children.reduce((sum, child) => sum + (numberFrom(child.item.amount) ?? 0), 0));
    if (Math.abs(summed - total) <= 0.02) { replaced.set(item.lineId, { ...item, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL", includedInReconciliation: false, atomic: false, aggregate: true }); continue; }
    if (children.some((child) => child.side === "NETWORK_SYSTEM") || summed > total) continue;
    const label = quota === "CONSUMPTION" ? "quota per consumi" : quota === "FIXED" ? "quota fissa" : "quota potenza";
    replaced.set(item.lineId, { ...item, code: "NETWORK_AND_SYSTEM_FROM_TOTAL", normalizedCode: "NETWORK_AND_SYSTEM_FROM_TOTAL", classification: "ARERA_NETWORK", group: "REGULATED_NETWORK", accountingRole: "ATOMIC", atomic: true, aggregate: false, amount: round(total - summed).toFixed(2).replace(".", ","), quantity: null, unitPrice: null, unit: null, calculationCheck: "NOT_CHECKABLE", description: `di cui spesa per la rete e gli oneri generali di sistema (${label}): totale ${total.toFixed(2).replace(".", ",")} € meno vendita ${summed.toFixed(2).replace(".", ",")} €` });
  }
  return items.map((item) => replaced.get(item.lineId) ?? item);
}
const reconcilable = (i: BillEconomicComponent): boolean => i.classification !== "CANONE_RAI" && i.classification !== "BILL_TOTAL" && i.classification !== "AMOUNT_DUE" && i.classification !== "PRIOR_BALANCE" && i.classification !== "TAX_SUBTOTAL";

function ownership(components: readonly BillEconomicComponent[]): readonly BillEconomicComponent[] {
  const result = components.map((component, index) => ({ ...component, lineId: `LINE_${String(index + 1).padStart(3, "0")}` }));
  const key = (component: BillEconomicComponent): string => keyOf(component.description);
  const find = (matcher: (value: string) => boolean): BillEconomicComponent | null => result.find((component) => matcher(key(component))) ?? null;
  const seller = find((value) => value.includes("TOTALE_VENDITA"));
  const network = find((value) => value.includes("TOTALE_TARIFFA"));
  const system = find((value) => value.includes("TOTALE_ONERI"));
  const tax = find((value) => value === "TOTALE_IMPOSTE");
  const supply = find((value) => value === "TOTALE_FORNITURA");
  const bill = find((value) => value === "TOTALE_BOLLETTA");
  const due = find((value) => value === "TOTALE_DA_PAGARE");
  const parentByLine = new Map<string, string>();
  const childrenByLine = new Map<string, string[]>();
  const assign = (parent: BillEconomicComponent | null, children: readonly BillEconomicComponent[]): void => {
    if (!parent) return;
    const childIds = children.filter((child) => child.lineId !== parent.lineId).map((child) => child.lineId);
    childrenByLine.set(parent.lineId, childIds);
    for (const child of children.filter((candidate) => candidate.lineId !== parent.lineId)) parentByLine.set(child.lineId, parent.lineId);
  };
  const indexOf = (item: BillEconomicComponent | null): number => item ? result.findIndex((candidate) => candidate.lineId === item.lineId) : -1;
  const between = (from: number, to: number): BillEconomicComponent[] => result.slice(from < 0 ? 0 : from + 1, to < 0 ? result.length : to).filter((item) => !item.aggregate);
  assign(seller, between(-1, indexOf(seller)));
  assign(network, between(indexOf(seller), indexOf(network)));
  assign(system, between(indexOf(network), indexOf(system)));
  assign(tax, between(indexOf(system), indexOf(tax)));
  assign(supply, [seller, network, system, tax].filter((item): item is BillEconomicComponent => item !== null));
  assign(bill, [supply, ...between(indexOf(supply), indexOf(bill))].filter((item): item is BillEconomicComponent => item !== null));
  assign(due, bill ? [bill] : []);
  return result.map((item) => ({ ...item, parentComponent: parentByLine.get(item.lineId) ?? null, childComponents: childrenByLine.get(item.lineId) ?? [] }));
}

export function buildCurrentBillEconomicAnalysis(inputs: readonly BillEconomicComponentInput[], billTotal: string | number | null | undefined = null, options: BillEconomicAnalysisOptions = {}): BillEconomicAnalysis {
  let components = ownership(inputs.map(normalizeBillEconomicComponent));
  const hasExpandedAtomicBreakdown = components.some((item) => /UC3|UC6|DISTRIBUZIONE_ELETTRICA|TARIFFA_DI_TRASMISSIONE/.test(keyOf(item.description)))
    && components.some((item) => keyOf(item.description) === "TOTALE_TARIFFA_PER_L_USO_DELLA_RETE_ELETTRICA");
  if (hasExpandedAtomicBreakdown) components = components.map((item) => isDuplicatedSectionSummary(item) ? { ...item, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL", includedInReconciliation: false } : item);
  const periodStart = options.billingPeriodStart ? isoDates(options.billingPeriodStart)[0] ?? options.billingPeriodStart.slice(0, 10) : null;
  if (periodStart) components = components.map((item) => { const end = isoDates(item.period ?? item.rawPeriod).at(-1); return end !== undefined && end < periodStart && item.group !== "TAX" ? asRecalculation(item) : item; });
  components = networkFromSummary(systemChargeViews(quotaTotals(components)));
  components = withoutSummaries(components, numberFrom(options.sourceBillTotal ?? billTotal) ?? numberFrom(components.find((i) => i.classification === "BILL_TOTAL")?.amount));
  const seller = { ENERGY_PRICE: components.filter((i) => i.group === "ENERGY_PRICE"), COMMERCIALIZATION: components.filter((i) => i.group === "COMMERCIALIZATION"), DISPATCHING_OR_PASS_THROUGH: components.filter((i) => i.group === "DISPATCHING_OR_PASS_THROUGH"), CAPACITY_MARKET: components.filter((i) => i.group === "CAPACITY_MARKET"), OTHER_SELLER_CHARGES: components.filter((i) => i.group === "OTHER_SELLER_CHARGES") } as const;
  const regulatedAndSystemCosts = { ARERA_NETWORK: components.filter((i) => i.group === "REGULATED_NETWORK"), ARERA_SYSTEM_CHARGES: components.filter((i) => i.group === "SYSTEM_CHARGES"), TERNA_DISPATCHING_REFERENCES: components.filter((i) => i.classification === "TERNA_DISPATCHING_REFERENCES"), GME_MARKET_REFERENCE: components.filter((i) => i.classification === "GME_MARKET_REFERENCE") } as const;
  const taxesAndOtherItems = { TAXES: components.filter((i) => i.group === "TAX"), OTHER_ITEMS: components.filter((i) => i.group === "OTHER_ITEMS") } as const;
  const sourceTotal = numberFrom(options.sourceBillTotal ?? billTotal) ?? numberFrom(components.find((i) => i.classification === "BILL_TOTAL")?.amount);
  const amountDue = numberFrom(options.sourceAmountDue) ?? numberFrom(components.find((i) => i.classification === "AMOUNT_DUE")?.amount);
  const priorBalance = numberFrom(options.priorBalance) ?? numberFrom(components.find((i) => i.classification === "PRIOR_BALANCE")?.amount);
  const reconstructedCurrentSupplyTotal = sum(components.filter((i) => i.classification !== "CANONE_RAI" && i.classification !== "BILL_TOTAL" && i.classification !== "AMOUNT_DUE" && i.classification !== "PRIOR_BALANCE" && i.classification !== "TAX_SUBTOTAL"));
  const tvFeeTotal = sumClass(components, ["CANONE_RAI"]); const currentPeriodTotal = reconstructedCurrentSupplyTotal === null ? null : round(reconstructedCurrentSupplyTotal + (tvFeeTotal ?? 0));
  const reconciliationBase = sourceTotal !== null && reconstructedCurrentSupplyTotal !== null && Math.abs(reconstructedCurrentSupplyTotal - sourceTotal) <= 0.02 ? reconstructedCurrentSupplyTotal : currentPeriodTotal;
  const reconciliationDifference = sourceTotal !== null && reconciliationBase !== null ? round(reconciliationBase - sourceTotal) : null;
  const fiscalTotal = sumClass(components, ["IVA", "ACCISE"]);
  const extraordinaryTotal = sumClass(components, ["BONUS", "CANONE_RAI", "INTERESSI_MORA", "CMOR", "ADMINISTRATIVE_FEES", "DELIVERY_DISCOUNT", "SERVIZI_AGGIUNTIVI", "RICALCOLI", "RESTITUZIONI", "ADDEBITI", "ACCREDITI", "ALTRE_PARTITE"]);
  const totalExcludingTvFee = sourceTotal === null ? null : round(sourceTotal - (tvFeeTotal ?? 0));
  const totalToPay = amountDue ?? sourceTotal;
  const previousDebtIncludedInCurrentInvoiceTotal = priorBalance === null || totalToPay === null || sourceTotal === null ? null : totalToPay > sourceTotal + 0.02;
  return { priceType: priceType(components), components, currentSellerCostBreakdown: seller, regulatedAndSystemCosts, taxesAndOtherItems, totals: {
    sellerEnergyTotal: sum(seller.ENERGY_PRICE), sellerCommercializationTotal: sum(seller.COMMERCIALIZATION), sellerOtherTotal: [seller.DISPATCHING_OR_PASS_THROUGH, seller.CAPACITY_MARKET, seller.OTHER_SELLER_CHARGES].flat().length ? sum([...seller.DISPATCHING_OR_PASS_THROUGH, ...seller.CAPACITY_MARKET, ...seller.OTHER_SELLER_CHARGES]) : null,
    regulatedNetworkTotal: sum(regulatedAndSystemCosts.ARERA_NETWORK), systemChargesTotal: sum(regulatedAndSystemCosts.ARERA_SYSTEM_CHARGES), taxTotal: fiscalTotal, otherItemsTotal: sum(taxesAndOtherItems.OTHER_ITEMS.filter((item) => item.classification !== "CANONE_RAI")), reconstructedCurrentSupplyTotal, currentPeriodTotal, priorBalanceTotal: priorBalance, tvFeeTotal, billTotal: sourceTotal, amountDue, currentBillReconstructedTotal: currentPeriodTotal, reconciliationDifference, currentInvoiceAtomicTotal: reconstructedCurrentSupplyTotal, currentInvoiceAggregateTotal: currentPeriodTotal, fiscalTotal, extraordinaryTotal, totalExcludingTvFee, totalToPay, previousDebtIncludedInCurrentInvoiceTotal, reconciliationStatus: reconciliationDifference === null ? "NOT_RECONCILABLE" : Math.abs(reconciliationDifference) <= 0.02 ? "RECONCILED" : "DIFFERENCE",
  } };
}
