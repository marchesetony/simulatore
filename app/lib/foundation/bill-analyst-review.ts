import type { BillFields, PublicBillDocument } from "./real-bill";
import type { StructuredBillExtraction, StructuredBillField, StructuredBillFieldStatus, StructuredBillEconomicChargeLine, StructuredBillExtendedFact } from "../ingestion/structured-bill";
import type { BillSupplyProfile } from "../ingestion/bill-supply-profile";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildBillSupplyProfile } from "../ingestion/bill-supply-profile.ts";
import type { OfficialPunModel } from "../market/pun-reference";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { normalizeAnalystItemCode } from "../ingestion/bill-extended-contract.ts";
import type { BillEconomicAnalysis, BillEconomicComponent, BillEconomicComponentInput } from "./bill-economic-analysis.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildCurrentBillEconomicAnalysis, classifyBillEconomicComponent } from "./bill-economic-analysis.ts";

export type BillAnalystReviewStatus = StructuredBillFieldStatus;

export interface BillReceiptDTO {
  readonly invoiceNumber: BillAnalystReviewField<string>;
  readonly customerCompanyName: BillAnalystReviewField<string>;
  readonly customerVatNumber: BillAnalystReviewField<string>;
  readonly billingAddress: BillAnalystReviewField<string>;
  readonly offerName: BillAnalystReviewField<string>;
  readonly offerCode: BillAnalystReviewField<string>;
  readonly contractStartDate: BillAnalystReviewField<string>;
  readonly contractExpiryDate: BillAnalystReviewField<string>;
  readonly economicConditionsStartDate: BillAnalystReviewField<string>;
  readonly economicConditionsExpiryDate: BillAnalystReviewField<string>;
  readonly contractDurationType: "FIXED_TERM" | "INDEFINITE" | "UNKNOWN";
  readonly priceMechanism: "FIXED" | "INDEXED_PUN_PLUS_SPREAD" | "INDEXED_OTHER" | "HYBRID" | "UNKNOWN";
  readonly priceTimeStructure: "MONORARIO" | "MULTIORARIO" | "F1_F2_F3" | "F1_F23" | "OTHER_TIME_BANDS" | "UNKNOWN";
  readonly indexName: BillAnalystReviewField<string>;
  readonly spread: BillAnalystReviewField<string>;
  readonly fixedPrice: BillAnalystReviewField<string>;
  readonly priceFormulaRaw: BillAnalystReviewField<string>;
  readonly priceBands: readonly BillAnalystReviewField<string>[];
  readonly priceTimeStructureProvenance: string | null;
  readonly dispatching: BillAnalystReviewField<string>;
  readonly capacityMarket: BillAnalystReviewField<string>;
  readonly pcvStatus: "PRESENT" | "NOT_PRESENT" | "NOT_DETERMINABLE";
  readonly tvFeeStatus: "PRESENT" | "NOT_PRESENT" | "NOT_DETERMINABLE";
  readonly tvFeeAmount: BillAnalystReviewField<string>;
  readonly latePaymentStatus: "PRESENT" | "NOT_PRESENT" | "NOT_DETERMINABLE";
  readonly latePaymentAmount: BillAnalystReviewField<string>;
  readonly cmorStatus: "PRESENT" | "NOT_PRESENT" | "NOT_DETERMINABLE";
  readonly cmorAmount: BillAnalystReviewField<string>;
  readonly priorBalance: BillAnalystReviewField<string>;
  readonly priorBalanceRawDescription: string | null;
  readonly comprehensiveAmount: BillAnalystReviewField<string>;
  readonly comprehensiveAmountRawDescription: string | null;
  readonly currentV6MissingFields: readonly string[];
}

export interface BillAnalystReviewField<T = string> {
  readonly value: T | null;
  readonly raw: string | null;
  readonly status: BillAnalystReviewStatus;
}

export interface BillAnalystReviewDTO {
  readonly document: {
    readonly fileName: string;
    readonly status: string;
    readonly reviewState: string;
    readonly versionNumber: number;
    readonly approvalReady: boolean;
    readonly analystExtractionStatus: "NOT_RUN" | "EXTRACTED" | "FAILED";
  };
  readonly punReferences: OfficialPunModel;
  readonly supply: {
    readonly supplier: BillAnalystReviewField<string>;
    readonly vector: BillAnalystReviewField<"EE" | "GAS" | "UNKNOWN">;
    readonly pod: BillAnalystReviewField<string>;
    readonly pdr: BillAnalystReviewField<string>;
    readonly address: BillAnalystReviewField<string>;
    readonly cap: BillAnalystReviewField<string>;
    readonly city: BillAnalystReviewField<string>;
    readonly province: BillAnalystReviewField<string>;
    readonly nominalSupplyVoltage: BillAnalystReviewField<string>;
    readonly power: BillAnalystReviewField<number | string>;
    readonly powerCommitted: BillAnalystReviewField<string>;
    readonly powerAvailable: BillAnalystReviewField<string>;
  };
  readonly supplyProfile: BillSupplyProfile | null;
  readonly customer: {
    readonly name: BillAnalystReviewField<string>;
    readonly taxIdentifier: BillAnalystReviewField<string>;
    readonly type: BillAnalystReviewField<string>;
  };
  readonly dates: {
    readonly billingPeriodStart: BillAnalystReviewField<string>;
    readonly billingPeriodEnd: BillAnalystReviewField<string>;
    readonly billingPeriodRaw: BillAnalystReviewField<string>;
    readonly billIssueDate: BillAnalystReviewField<string>;
    readonly billDueDate: BillAnalystReviewField<string>;
    readonly economicConditionsExpiryDate: BillAnalystReviewField<string>;
    readonly contractExpiryDate: BillAnalystReviewField<string>;
    readonly contractExpiryStatus: BillAnalystReviewField<string>;
  };
  readonly consumption: {
    readonly annual: BillAnalystReviewField<number>;
    readonly billed: BillAnalystReviewField<number>;
    readonly f1: BillAnalystReviewField<number>;
    readonly f2: BillAnalystReviewField<number>;
    readonly f3: BillAnalystReviewField<number>;
    readonly smc: BillAnalystReviewField<number>;
  };
  readonly economics: {
    readonly punApplied: BillAnalystReviewField<string>;
    readonly spread: BillAnalystReviewField<string>;
    readonly total: BillAnalystReviewField<number | string>;
    readonly chargeLines: readonly BillEconomicChargeLineDTO[];
    readonly economicAnalysis: BillEconomicAnalysis;
  };
  readonly payment: {
    readonly method: BillAnalystReviewField<string>;
    readonly regularity: BillAnalystReviewField<string>;
    readonly outstandingAmount: BillAnalystReviewField<string>;
    readonly previousUnpaidEvidence: BillAnalystReviewField<string>;
  };
  readonly receipt: BillReceiptDTO;
  readonly reviewIssues: readonly BillAnalystReviewIssue[];
  readonly provenance: readonly { readonly label: string; readonly source: string; readonly confidence: number; readonly reviewed: boolean }[];
  readonly simulationDraft: {
    readonly vector: "EE" | "GAS";
    readonly calculationDate: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly customerCategory: "RESIDENTIAL" | "NON_RESIDENTIAL" | "";
    readonly taxTreatment: "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE" | "";
    readonly customerReference: string;
    readonly supplyReference: string;
    readonly voltageLevel: "LV" | "MV" | "HV" | "EHV" | "";
    readonly f1: string;
    readonly f2: string;
    readonly f3: string;
    readonly smc: string;
    readonly correctionRequired: boolean;
    readonly correctionCoefficient: string;
    readonly baseline: string;
  } | null;
}

export interface BillEconomicChargeLineDTO {
  readonly code: string;
  readonly description: string;
  readonly quantity: string | null;
  readonly unit: string | null;
  readonly unitPrice: string | null;
  readonly amount: string | null;
  readonly periodRaw: string | null;
  readonly classification?: BillEconomicComponent["classification"];
  readonly rawDescription?: string;
  readonly rawValue?: string;
  readonly rawUnit?: string;
  readonly rawQuantity?: string;
  readonly rawUnitPrice?: string;
  readonly rawAmount?: string;
  readonly rawPeriod?: string;
  readonly documentEvidence?: string;
  readonly calculationCheck?: BillEconomicComponent["calculationCheck"];
  readonly status: BillAnalystReviewStatus;
}

export interface BillAnalystReviewIssue {
  readonly path: string;
  readonly status: BillAnalystReviewStatus;
}

export interface BillAnalystReviewSource {
  readonly id: string;
  readonly fileName: string;
  readonly status: string;
  readonly reviewState: string;
  readonly updatedAt: string;
  readonly currentVersionNumber: number;
  readonly approvalReady: boolean;
  readonly fields: BillFields;
  readonly normalized: PublicBillDocument["normalized"];
  readonly structuredBill: StructuredBillExtraction | null;
  readonly resolvedVector: "EE" | "GAS" | "UNKNOWN";
  readonly invoicePunReferences: OfficialPunModel;
}

const notFound = <T>(): BillAnalystReviewField<T> => ({ value: null, raw: null, status: "NOT_FOUND" });
const field = <T>(item: StructuredBillField<T> | undefined, raw: string | null = null): BillAnalystReviewField<T> => item ? { value: item.value, raw, status: item.status } : notFound<T>();
const factField = (fact: StructuredBillExtendedFact | undefined): BillAnalystReviewField<string> => fact ? { value: fact.value || null, raw: fact.value || null, status: fact.status } : notFound<string>();
const firstFact = (facts: readonly StructuredBillExtendedFact[], code: StructuredBillExtendedFact["code"]): StructuredBillExtendedFact | undefined => facts.find((fact) => normalizeAnalystItemCode(fact.code) === normalizeAnalystItemCode(code));
const rawLegacy = (fields: BillFields, name: keyof BillFields): string | null => fields[name]?.value ?? null;
const stringValue = (item: BillAnalystReviewField<unknown>): string | null => item.value === null || item.value === undefined ? null : String(item.value);

function economicLine(line: StructuredBillEconomicChargeLine): BillEconomicChargeLineDTO {
  return { code: line.code, description: line.description, quantity: line.quantity || null, unit: line.unit || null, unitPrice: line.unitPrice || null, amount: line.amount || null, periodRaw: line.periodRaw || null, ...(line.classification ? { classification: line.classification } : {}), ...(line.rawDescription !== undefined ? { rawDescription: line.rawDescription } : {}), ...(line.rawValue !== undefined ? { rawValue: line.rawValue } : {}), ...(line.rawUnit !== undefined ? { rawUnit: line.rawUnit } : {}), ...(line.rawQuantity !== undefined ? { rawQuantity: line.rawQuantity } : {}), ...(line.rawUnitPrice !== undefined ? { rawUnitPrice: line.rawUnitPrice } : {}), ...(line.rawAmount !== undefined ? { rawAmount: line.rawAmount } : {}), ...(line.rawPeriod !== undefined ? { rawPeriod: line.rawPeriod } : {}), ...(line.documentEvidence !== undefined ? { documentEvidence: line.documentEvidence } : {}), ...(line.calculationCheck ? { calculationCheck: line.calculationCheck } : {}), status: line.status };
}

function lineFact(lines: readonly StructuredBillEconomicChargeLine[], code: StructuredBillEconomicChargeLine["code"]): BillAnalystReviewField<string> {
  const line = lines.find((candidate) => candidate.code === code && candidate.status !== "NOT_FOUND");
  return line ? { value: line.amount || null, raw: line.amount || null, status: line.status } : notFound<string>();
}

function issue(path: string, item: BillAnalystReviewField<unknown>): BillAnalystReviewIssue | null { return item.status === "FOUND" ? null : { path, status: item.status }; }

function receiptStatus(lines: readonly StructuredBillEconomicChargeLine[], codes: readonly string[], descriptions: readonly string[] = []): "PRESENT" | "NOT_PRESENT" | "NOT_DETERMINABLE" {
  const found = lines.some((line) => {
    const code = normalizeAnalystItemCode(line.code);
    const description = line.description.toUpperCase();
    return codes.includes(code) || descriptions.some((needle) => description.includes(needle));
  });
  return found ? "PRESENT" : "NOT_PRESENT";
}

function receiptFieldFromLine(lines: readonly StructuredBillEconomicChargeLine[], codes: readonly string[], descriptions: readonly string[] = []): BillAnalystReviewField<string> {
  const line = lines.find((candidate) => {
    const code = normalizeAnalystItemCode(candidate.code); const description = candidate.description.toUpperCase();
    return codes.includes(code) || descriptions.some((needle) => description.includes(needle));
  });
  return line ? { value: line.amount || null, raw: line.amount || null, status: line.status } : notFound<string>();
}

function buildReceipt(extraction: StructuredBillExtraction | null, facts: readonly StructuredBillExtendedFact[], lines: readonly StructuredBillEconomicChargeLine[]): BillReceiptDTO {
  const fact = (code: string) => factField(firstFact(facts, code as StructuredBillExtendedFact["code"]));
  const puns = ["PUN_F1", "PUN_F2", "PUN_F3"].map((code) => fact(code)).filter((item) => item.status === "FOUND");
  const hasPun = facts.some((item) => ["PUN_SINGLE", "PUN_F1", "PUN_F2", "PUN_F3"].includes(normalizeAnalystItemCode(item.code)) && item.status === "FOUND");
  const hasSpread = fact("SPREAD").status === "FOUND";
  const hasFixed = fact("FIXED_PRICE").status === "FOUND" || fact("ENERGY_FIXED_PRICE").status === "FOUND";
  const priceMechanism: BillReceiptDTO["priceMechanism"] = hasPun && hasSpread && !hasFixed ? "INDEXED_PUN_PLUS_SPREAD" : hasFixed && !hasPun ? "FIXED" : hasPun ? "HYBRID" : "UNKNOWN";
  const hasBandPrices = puns.length >= 2 || ["PRICE_F1", "PRICE_F2", "PRICE_F3", "PRICE_F23"].some((code) => fact(code).status === "FOUND");
  const singlePrice = fact("PUN_SINGLE").status === "FOUND" || fact("MONORARIO_PRICE").status === "FOUND";
  const priceTimeStructure: BillReceiptDTO["priceTimeStructure"] = hasBandPrices ? "F1_F2_F3" : singlePrice ? "MONORARIO" : "UNKNOWN";
  const contractDurationType: BillReceiptDTO["contractDurationType"] = fact("CONTRACT_INDEFINITE").status === "FOUND" || /indeterminato/i.test(fact("CONTRACT_EXPIRY").value ?? "") ? "INDEFINITE" : fact("CONTRACT_EXPIRY").status === "FOUND" ? "FIXED_TERM" : "UNKNOWN";
  const pcvStatus = receiptStatus(lines, ["PCV"], ["PCV"]);
  const tvFeeStatus = receiptStatus(lines, ["CANONE_RAI", "TV_FEE"], ["CANONE DI ABBONAMENTO", "TELEVISIONE"]);
  const latePaymentStatus = receiptStatus(lines, ["INTERESSI_MORA", "LATE_PAYMENT"], ["INTERESSI DI MORA", "MORA", "SOLLECITO", "RITARDATO PAGAMENTO"]);
  const cmorStatus = receiptStatus(lines, ["CMOR"], ["CMOR"]);
  const priorBalance = fact("OUTSTANDING_AMOUNT");
  const comprehensiveFact = fact("COMPREHENSIVE_AMOUNT");
  const comprehensiveLine = lines.find((line) => normalizeAnalystItemCode(line.code) === "COMPREHENSIVE_AMOUNT");
  const comprehensiveAmount = comprehensiveFact.status === "FOUND" ? comprehensiveFact : comprehensiveLine ? { value: comprehensiveLine.amount || null, raw: comprehensiveLine.amount || null, status: comprehensiveLine.status } : notFound<string>();
  const missing: string[] = [];
  const required: readonly [string, BillAnalystReviewField<unknown>][] = [
    ["INVOICE_NUMBER", fact("INVOICE_NUMBER")], ["CUSTOMER_COMPANY_NAME", fact("CUSTOMER_COMPANY_NAME")], ["CUSTOMER_VAT_NUMBER", fact("CUSTOMER_VAT_NUMBER")], ["CONTRACT_START_DATE", fact("CONTRACT_START_DATE")],
    ["PRICE_FORMULA_RAW", fact("PRICE_FORMULA_RAW")], ["FIXED_PRICE", fact("FIXED_PRICE")], ["LOSS_FACTOR", fact("LOSS_FACTOR")], ["PCV", pcvStatus === "PRESENT" ? { value: "present", raw: "present", status: "FOUND" } : notFound<string>()],
    ["LATE_PAYMENT_CHARGE", latePaymentStatus === "PRESENT" ? { value: "present", raw: "present", status: "FOUND" } : notFound<string>()], ["CMOR", cmorStatus === "PRESENT" ? { value: "present", raw: "present", status: "FOUND" } : notFound<string>()],
  ];
  for (const [code, item] of required) if (item.status !== "FOUND") missing.push(code);
  return {
    invoiceNumber: fact("INVOICE_NUMBER"), customerCompanyName: fact("CUSTOMER_COMPANY_NAME"), customerVatNumber: fact("CUSTOMER_VAT_NUMBER"), billingAddress: fact("BILLING_ADDRESS"),
    offerName: extraction ? field(extraction.offerName) : notFound<string>(), offerCode: extraction ? field(extraction.offerCode) : notFound<string>(), contractStartDate: fact("CONTRACT_START_DATE"), contractExpiryDate: fact("CONTRACT_EXPIRY"), economicConditionsStartDate: fact("ECONOMIC_CONDITIONS_START_DATE"), economicConditionsExpiryDate: fact("ECONOMIC_EXPIRY"), contractDurationType,
    priceMechanism, priceTimeStructure, priceTimeStructureProvenance: hasBandPrices ? "PUN_F1, PUN_F2, PUN_F3 presenti come prezzi/indici documentali" : singlePrice ? "PUN_SINGLE o MONORARIO_PRICE presente nel documento" : null, indexName: fact("INDEX_NAME").status === "FOUND" ? fact("INDEX_NAME") : hasPun ? { value: "PUN", raw: "PUN", status: "FOUND" } : notFound<string>(), spread: fact("SPREAD"), fixedPrice: fact("FIXED_PRICE").status === "FOUND" ? fact("FIXED_PRICE") : fact("ENERGY_FIXED_PRICE"), priceFormulaRaw: fact("PRICE_FORMULA_RAW"), priceBands: puns.length ? puns : [fact("PRICE_F1"), fact("PRICE_F2"), fact("PRICE_F3"), fact("PRICE_F23")].filter((item) => item.status === "FOUND"),
    dispatching: fact("DISPATCHING"), capacityMarket: fact("CAPACITY_MARKET"), pcvStatus, tvFeeStatus, tvFeeAmount: receiptFieldFromLine(lines, ["CANONE_RAI", "TV_FEE"], ["CANONE DI ABBONAMENTO", "TELEVISIONE"]), latePaymentStatus, latePaymentAmount: receiptFieldFromLine(lines, ["INTERESSI_MORA", "LATE_PAYMENT"], ["INTERESSI DI MORA", "MORA", "SOLLECITO"]), cmorStatus, cmorAmount: receiptFieldFromLine(lines, ["CMOR"], ["CMOR"]), priorBalance, priorBalanceRawDescription: fact("PREVIOUS_UNPAID_EVIDENCE").value, comprehensiveAmount, comprehensiveAmountRawDescription: comprehensiveLine?.description ?? (comprehensiveFact.status === "FOUND" ? comprehensiveFact.raw : null), currentV6MissingFields: missing,
  };
}

export function buildBillAnalystReview(source: BillAnalystReviewSource): BillAnalystReviewDTO {
  const extraction = source.structuredBill;
  const facts = extraction?.extendedFacts ?? [];
  const period = extraction?.billingPeriod;
  const periodValue = period?.status === "FOUND" ? period.value : null;
  const vector: BillAnalystReviewField<"EE" | "GAS" | "UNKNOWN"> = source.resolvedVector === "UNKNOWN" ? { value: "UNKNOWN", raw: null, status: "NEEDS_REVIEW" } : { value: source.resolvedVector, raw: source.resolvedVector, status: "FOUND" };
  const supply = {
    supplier: field(extraction?.supplier), vector, pod: field(extraction?.pod), pdr: field(extraction?.pdr),
    address: factField(firstFact(facts, "SUPPLY_ADDRESS")), cap: factField(firstFact(facts, "SUPPLY_POSTAL_CODE")), city: factField(firstFact(facts, "SUPPLY_CITY")), province: factField(firstFact(facts, "SUPPLY_PROVINCE")),
    nominalSupplyVoltage: factField(firstFact(facts, "NOMINAL_VOLTAGE")), power: field(extraction?.powerKw), powerCommitted: factField(firstFact(facts, "POWER_COMMITTED")), powerAvailable: factField(firstFact(facts, "POWER_AVAILABLE")),
  };
  const customer = { name: field(extraction?.customerName), taxIdentifier: field(extraction?.customerTaxIdentifier), type: field(extraction?.customerType) };
  const billingRaw = periodValue?.raw ?? rawLegacy(source.fields, "billingPeriod");
  const dates = {
    billingPeriodStart: periodValue ? { value: periodValue.from, raw: billingRaw, status: period?.status ?? "FOUND" } : { value: null, raw: billingRaw, status: period?.status ?? "NOT_FOUND" },
    billingPeriodEnd: periodValue ? { value: periodValue.to, raw: billingRaw, status: period?.status ?? "FOUND" } : { value: null, raw: billingRaw, status: period?.status ?? "NOT_FOUND" },
    billingPeriodRaw: billingRaw ? { value: billingRaw, raw: billingRaw, status: period?.status ?? "FOUND" } : notFound<string>(),
    billIssueDate: factField(firstFact(facts, "BILL_ISSUE_DATE")), billDueDate: factField(firstFact(facts, "BILL_DUE_DATE")), economicConditionsExpiryDate: factField(firstFact(facts, "ECONOMIC_EXPIRY")), contractExpiryDate: factField(firstFact(facts, "CONTRACT_EXPIRY")), contractExpiryStatus: factField(firstFact(facts, "CONTRACT_INDEFINITE")),
  };
  const consumption = { annual: field(extraction?.annualConsumption), billed: field(extraction?.billedConsumption), f1: field(extraction?.f1Consumption), f2: field(extraction?.f2Consumption), f3: field(extraction?.f3Consumption), smc: field(extraction?.smcConsumption) };
  const sourceChargeLines = extraction?.economicChargeLines ?? [];
  const economics = { punApplied: factField(firstFact(facts, "PUN_SINGLE") ?? firstFact(facts, "PUN_F1") ?? firstFact(facts, "PUN_F2") ?? firstFact(facts, "PUN_F3")), spread: factField(firstFact(facts, "SPREAD")), total: field(extraction?.totalAmount), chargeLines: sourceChargeLines.map(economicLine) };
  const economicsWithLines = { ...economics, punApplied: economics.punApplied.status === "FOUND" ? economics.punApplied : lineFact(sourceChargeLines, "PUN_SINGLE"), spread: economics.spread.status === "FOUND" ? economics.spread : lineFact(sourceChargeLines, "SPREAD"), total: economics.total.status === "FOUND" ? economics.total : lineFact(sourceChargeLines, "OTHER_CHARGE") };
  const economicInputs: BillEconomicComponentInput[] = sourceChargeLines.map((line) => ({ code: line.code, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount, period: line.periodRaw, rawDescription: line.rawDescription, rawValue: line.rawValue, rawUnit: line.rawUnit, rawQuantity: line.rawQuantity, rawUnitPrice: line.rawUnitPrice, rawAmount: line.rawAmount, rawPeriod: line.rawPeriod, documentEvidence: line.documentEvidence, status: line.status }));
  const chargeCodes = new Set(sourceChargeLines.map((line) => normalizeAnalystItemCode(line.code)));
  for (const fact of facts) {
    const classification = classifyBillEconomicComponent(fact.code, fact.code);
    if (classification === "UNCLASSIFIED_BILL_CHARGE" || chargeCodes.has(normalizeAnalystItemCode(fact.code))) continue;
    economicInputs.push({ code: fact.code, description: fact.code, quantity: null, unit: fact.unit ?? null, unitPrice: fact.value, amount: null, period: null, rawDescription: fact.code, rawValue: fact.value, rawUnit: fact.unit ?? null, rawQuantity: null, rawUnitPrice: fact.value, rawAmount: null, rawPeriod: null, documentEvidence: fact.code, status: fact.status });
  }
  const sourceBillTotal = economicInputs.find((item) => classifyBillEconomicComponent(item.code, item.description ?? "") === "BILL_TOTAL")?.amount ?? null;
  const sourceAmountDue = economicInputs.find((item) => classifyBillEconomicComponent(item.code, item.description ?? "") === "AMOUNT_DUE")?.amount ?? null;
  const payment = { method: factField(firstFact(facts, "PAYMENT_METHOD")), regularity: factField(firstFact(facts, "PAYMENT_REGULARITY")), outstandingAmount: factField(firstFact(facts, "OUTSTANDING_AMOUNT")), previousUnpaidEvidence: factField(firstFact(facts, "PREVIOUS_UNPAID_EVIDENCE")) };
  const economicAnalysis = buildCurrentBillEconomicAnalysis(economicInputs, extraction?.totalAmount?.value ?? null, { sourceBillTotal, sourceAmountDue, priorBalance: payment.outstandingAmount.value });
  const receipt = buildReceipt(extraction, facts, sourceChargeLines);
  const allFields: readonly [string, BillAnalystReviewField<unknown>][] = [
    ["supply.address", supply.address], ["supply.nominalSupplyVoltage", supply.nominalSupplyVoltage], ["supply.powerCommitted", supply.powerCommitted], ["dates.billingPeriod", dates.billingPeriodStart], ["dates.billDueDate", dates.billDueDate], ["dates.contractExpiryDate", dates.contractExpiryDate], ["payment.method", payment.method], ["payment.regularity", payment.regularity], ["economics.punApplied", economics.punApplied], ["economics.spread", economics.spread], ["economics.total", economics.total],
  ];
  const reviewIssues = allFields.map(([path, item]) => issue(path, item)).filter((item): item is BillAnalystReviewIssue => item !== null);
  const vectorValue = source.resolvedVector === "EE" || source.resolvedVector === "GAS" ? source.resolvedVector : null;
  const customerCategory: "RESIDENTIAL" | "NON_RESIDENTIAL" | "" = customer.type.value === "RESIDENTIAL" || customer.type.value === "NON_RESIDENTIAL" ? customer.type.value : "";
  const simulationDraft = vectorValue ? { vector: vectorValue, periodStart: periodValue?.from ?? "", periodEnd: periodValue?.to ?? "", customerCategory, customerReference: "", supplyReference: stringValue(vectorValue === "EE" ? supply.pod : supply.pdr) ?? "", voltageLevel: "" as const, f1: stringValue(consumption.f1) ?? "", f2: stringValue(consumption.f2) ?? "", f3: stringValue(consumption.f3) ?? "", smc: stringValue(consumption.smc) ?? "", correctionRequired: false, correctionCoefficient: "" } : null;
  const provenance = source.normalized?.provenance ?? [];
  const date = source.updatedAt ?? "";
  const supplyProfile = extraction?.extendedFacts ? buildBillSupplyProfile(extraction.extendedFacts) : extraction?.supplyProfile ?? null;
  return { document: { fileName: source.fileName, status: source.status, reviewState: source.reviewState, versionNumber: source.currentVersionNumber, approvalReady: source.approvalReady, analystExtractionStatus: extraction?.analystExtractionStatus ?? "NOT_RUN" }, punReferences: source.invoicePunReferences, supply, supplyProfile, customer, dates, consumption, economics: { ...economicsWithLines, economicAnalysis }, payment, receipt, reviewIssues, provenance, simulationDraft: simulationDraft ? { ...simulationDraft, calculationDate: date.slice(0, 10), taxTreatment: "", baseline: "" } : null };
}
