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
  readonly code: string; readonly classification: BillEconomicClassification; readonly group: BillEconomicGroup; readonly accountingRole: BillAccountingRole; readonly includedInReconciliation: boolean;
  readonly description: string; readonly quantity: string | null; readonly unitPrice: string | null; readonly unit: string | null; readonly amount: string | null; readonly period: string | null;
  readonly rawDescription: string; readonly rawValue: string; readonly rawUnit: string; readonly rawQuantity: string; readonly rawUnitPrice: string; readonly rawAmount: string; readonly rawPeriod: string;
  readonly documentEvidence: string; readonly calculationCheck: BillCalculationCheck; readonly status: string;
}

export interface BillEconomicTotals {
  readonly sellerEnergyTotal: number | null; readonly sellerCommercializationTotal: number | null; readonly sellerOtherTotal: number | null;
  readonly regulatedNetworkTotal: number | null; readonly systemChargesTotal: number | null; readonly taxTotal: number | null; readonly otherItemsTotal: number | null;
  readonly reconstructedCurrentSupplyTotal: number | null; readonly currentPeriodTotal: number | null; readonly priorBalanceTotal: number | null; readonly tvFeeTotal: number | null;
  readonly billTotal: number | null; readonly amountDue: number | null; readonly currentBillReconstructedTotal: number | null; readonly reconciliationDifference: number | null;
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
const round = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const canonicalUnit = (value: string): string => text(value).toUpperCase().replace(/[€â‚¬Ã¢â€šÂ¬]/g, "EUR").replace(/\s+/g, "").replace(/PER/g, "/").replace(/YEAR/g, "ANNO").replace(/MONTH/g, "MESE");

export function classifyBillEconomicComponent(code: string | null | undefined, description = ""): BillEconomicClassification {
  const c = keyOf(code); const d = keyOf(description);
  if (["PUN", "PUN_SINGLE", "PUN_F1", "PUN_F2", "PUN_F3", "ENERGY_INDEX", "PUN_APPLICATO"].includes(c) || d.includes("PUN")) return "ENERGY_INDEX";
  if (["SPREAD", "SELLER_SPREAD", "ENERGY_SPREAD"].includes(c) || d.includes("SPREAD")) return "ENERGY_SPREAD";
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
  if (["RICALCOLI", "RECALCULATION"].includes(c) || d.includes("RICALCOL") || d.includes("CONGUAGLIO")) return "RICALCOLI";
  if (["RESTITUZIONI", "REFUNDS"].includes(c)) return "RESTITUZIONI";
  if (["ADDEBITI", "DEBITS"].includes(c)) return "ADDEBITI";
  if (["ACCREDITI", "CREDITS"].includes(c)) return "ACCREDITI";
  if (["ALTRE_PARTITE", "OTHER_ITEMS", "OTHER_CHARGE"].includes(c)) return "ALTRE_PARTITE";
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
  const q = numberFrom(input.quantity); const p = numberFrom(input.unitPrice); const a = numberFrom(input.amount); if (q === null || p === null || a === null) return "NOT_CHECKABLE";
  const unit = canonicalUnit(input.unit); const expected = unit.includes("CENT") && unit.includes("KWH") ? q * p / 100 : unit.includes("/MWH") && keyOf(input.quantity).includes("KWH") ? q * p / 1000 : unit.includes("/KWH") || unit === "EUR" || unit.includes("/MESE") || unit.includes("/ANNO") || unit.includes("/KW/") ? q * p : null;
  return expected === null ? "NOT_CHECKABLE" : Math.abs(round(expected) - round(a)) <= 0.02 ? "MATCH" : "MISMATCH";
}

function accountingRole(classification: BillEconomicClassification, description: string): BillAccountingRole {
  const key = keyOf(description);
  if (classification === "BILL_TOTAL") return "TOTAL";
  if (classification === "AMOUNT_DUE") return "TOTAL";
  if (classification === "PRIOR_BALANCE") return "PRIOR_BALANCE";
  if (classification === "TAX_SUBTOTAL" || key.includes("SUBTOTALE") || key.includes("TOTALE_SEZIONE")) return "SUBTOTAL";
  return "ATOMIC";
}

export function normalizeBillEconomicComponent(input: BillEconomicComponentInput): BillEconomicComponent {
  const description = text(input.description ?? input.rawDescription); const quantity = text(input.quantity ?? input.rawQuantity) || null; const unit = text(input.unit ?? input.rawUnit) || null; const unitPrice = text(input.unitPrice ?? input.rawUnitPrice) || null; const amount = text(input.amount ?? input.rawAmount) || null; const period = text(input.period ?? input.rawPeriod) || null;
  const rawDescription = text(input.rawDescription ?? description); const rawValue = text(input.rawValue ?? input.value ?? input.amount ?? input.unitPrice ?? ""); const rawUnit = text(input.rawUnit ?? unit); const rawQuantity = text(input.rawQuantity ?? quantity); const rawUnitPrice = text(input.rawUnitPrice ?? unitPrice); const rawAmount = text(input.rawAmount ?? amount); const rawPeriod = text(input.rawPeriod ?? period);
  const classification = classifyBillEconomicComponent(input.code, description); const role = accountingRole(classification, description);
  return { code: text(input.code) || "UNCLASSIFIED_BILL_CHARGE", classification, group: groupOf(classification), accountingRole: role, includedInReconciliation: role === "ATOMIC", description: description || rawDescription || "Voce economica non descritta", quantity, unitPrice, unit, amount, period, rawDescription, rawValue, rawUnit, rawQuantity, rawUnitPrice, rawAmount, rawPeriod, documentEvidence: text(input.documentEvidence ?? rawDescription), calculationCheck: calculationCheck({ quantity: rawQuantity, unitPrice: rawUnitPrice, unit: rawUnit, amount: rawAmount }), status: text(input.status) || "FOUND" };
}

const sum = (items: readonly BillEconomicComponent[]): number | null => { const values = items.filter((item) => item.includedInReconciliation).map((item) => numberFrom(item.amount)).filter((value): value is number => value !== null); return values.length ? round(values.reduce((a, b) => a + b, 0)) : null; };
const sumClass = (items: readonly BillEconomicComponent[], classifications: readonly BillEconomicClassification[]): number | null => sum(items.filter((item) => classifications.includes(item.classification)));

function priceType(items: readonly BillEconomicComponent[]): BillEconomicAnalysis["priceType"] {
  const hasPun = items.some((item) => item.classification === "ENERGY_INDEX"); const hasSpread = items.some((item) => item.classification === "ENERGY_SPREAD"); const hasFixed = items.some((item) => item.classification === "ENERGY_FIXED_PRICE");
  if (hasPun && hasSpread && !hasFixed) return "INDEXED_PUN_SPREAD"; if (hasFixed && !hasPun) return "FIXED_PRICE"; if (hasPun || hasSpread || hasFixed) return "MIXED_FORMULA"; return "NOT_DETERMINABLE";
}

export interface BillEconomicAnalysisOptions { readonly sourceBillTotal?: string | number | null; readonly sourceAmountDue?: string | number | null; readonly priorBalance?: string | number | null; }

export function buildCurrentBillEconomicAnalysis(inputs: readonly BillEconomicComponentInput[], billTotal: string | number | null | undefined = null, options: BillEconomicAnalysisOptions = {}): BillEconomicAnalysis {
  let components = inputs.map(normalizeBillEconomicComponent);
  const hasNetworkParent = components.some((item) => item.classification === "ARERA_NETWORK" && keyOf(item.description).includes("ONERI_GENERALI_DI_SISTEMA"));
  if (hasNetworkParent) components = components.map((item) => item.classification === "ARERA_SYSTEM_CHARGES" && ["ASOS", "ARIM", "UC3", "UC6"].includes(keyOf(item.code)) ? { ...item, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL", includedInReconciliation: false } : item);
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
  return { priceType: priceType(components), components, currentSellerCostBreakdown: seller, regulatedAndSystemCosts, taxesAndOtherItems, totals: {
    sellerEnergyTotal: sum(seller.ENERGY_PRICE), sellerCommercializationTotal: sum(seller.COMMERCIALIZATION), sellerOtherTotal: [seller.DISPATCHING_OR_PASS_THROUGH, seller.CAPACITY_MARKET, seller.OTHER_SELLER_CHARGES].flat().length ? sum([...seller.DISPATCHING_OR_PASS_THROUGH, ...seller.CAPACITY_MARKET, ...seller.OTHER_SELLER_CHARGES]) : null,
    regulatedNetworkTotal: sum(regulatedAndSystemCosts.ARERA_NETWORK), systemChargesTotal: sum(regulatedAndSystemCosts.ARERA_SYSTEM_CHARGES), taxTotal: sum(taxesAndOtherItems.TAXES), otherItemsTotal: sum(taxesAndOtherItems.OTHER_ITEMS.filter((item) => item.classification !== "CANONE_RAI")), reconstructedCurrentSupplyTotal, currentPeriodTotal, priorBalanceTotal: priorBalance, tvFeeTotal, billTotal: sourceTotal, amountDue, currentBillReconstructedTotal: currentPeriodTotal, reconciliationDifference, reconciliationStatus: reconciliationDifference === null ? "NOT_RECONCILABLE" : Math.abs(reconciliationDifference) <= 0.02 ? "RECONCILED" : "DIFFERENCE",
  } };
}
