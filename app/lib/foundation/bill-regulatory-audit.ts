import type { RegulatoryCustomerScope, RegulatoryValueRecord } from "./regulatory-types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { normalizeRegulatoryUnit, resolveAreraEffectiveValue } from "./arera-electricity-regulatory.ts";
import type { BillAuditability, DomesticResidentMatrix, MatrixAuditability } from "./bill-domestic-resident-matrix.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { referenceDomainOf, type ReferenceDomain } from "./regulatory-domains.ts";
import type { RegulatedPassThroughVerification } from "./bill-regulated-pass-through.ts";

export type BillAuditCategory = "SELLER_CONTRACTUAL" | "REGULATED_ARERA" | "DISPATCHING" | "CAPACITY_MARKET" | "MARKET_GME" | "TAX" | "OTHER" | "UNCLASSIFIED";
export type BillAuditStatus = "MATCH" | "ROUNDING_DIFFERENCE" | "MISMATCH" | "OVERCHARGE" | "UNDERCHARGE" | "NOT_COMPARABLE" | "CONTRACT_REFERENCE_REQUIRED" | "REGULATORY_SOURCE_MISSING" | "SOURCE_AUTHORITY_NOT_IMPLEMENTED" | "SCOPE_UNDETERMINED" | "UNIT_SEMANTICS_INCONSISTENT" | "INSUFFICIENT_DOCUMENT_DATA";
export type BillNotComparableReason = "NONE" | "REGULATORY_SOURCE_MISSING" | "CUSTOMER_SCOPE_UNDETERMINED" | "QUANTITY_MISSING" | "UNIT_PRICE_MISSING" | "FORMULA_MISSING" | "AGGREGATED_BILL_LINE" | "UNIT_SEMANTICS_INCONSISTENT" | "INSUFFICIENT_DOCUMENT_DATA";
export type BillPunUnitStatus = "RESOLVED" | "UNRESOLVED";
export type AmountUnitIssueRootCause = "DISPLAY_ONLY" | "UNIT_PRICE_USED_AS_AMOUNT" | "AMOUNT_USED_AS_UNIT_PRICE" | "MISSING_UNIT" | "AMBIGUOUS_EXTRACTION" | `OTHER:${string}`;

export type AmountUnitIssue = {
  readonly code: string;
  readonly type: string;
  readonly field: "quantity" | "unitPrice" | "amount" | "unit";
  readonly rootCause: AmountUnitIssueRootCause;
};

export type BillAuditChargeLineInput = {
  readonly code: string;
  readonly description: string;
  readonly quantity: string | number | null | undefined;
  readonly unit: string | null | undefined;
  readonly unitPrice: string | number | null | undefined;
  readonly amount: string | number | null | undefined;
};

export type ElectricityBillAuditInput = {
  readonly billId?: string;
  readonly versionId?: string;
  readonly vector: "EE";
  readonly customerType: "RESIDENTIAL" | "NON_RESIDENTIAL" | "UNKNOWN";
  readonly domesticResidenceStatus: "PROVEN" | "NOT_PROVEN" | "UNKNOWN";
  readonly billingPeriod: { readonly from: string; readonly to: string };
  readonly billedConsumptionKwh?: string | number | null;
  readonly powerKw?: string | number | null;
  readonly chargeLines: readonly BillAuditChargeLineInput[];
};

export type OfficialGmeReference = {
  readonly month: string;
  readonly value: number | null;
  readonly unit: string;
  readonly sourceReference: string;
  readonly officialIdentifier: string;
};

export type ContractReference = {
  readonly contractId: string;
  readonly version: string;
  readonly approved: boolean;
  readonly sourceReference?: string;
};

export type BillCoverageDTO = {
  readonly sourceCoverage: { readonly ARERA_NETWORK: "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE"; readonly ARERA_SYSTEM_CHARGES: "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE"; readonly DISPATCHING: "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE"; readonly CAPACITY_MARKET: "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE"; readonly GME: "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE"; readonly CONTRACT: "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE"; readonly TAX: "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE" };
  readonly billAuditability: { readonly ARERA_NETWORK: BillAuditability; readonly ARERA_SYSTEM_CHARGES: BillAuditability; readonly DISPATCHING: BillAuditability; readonly CAPACITY_MARKET: BillAuditability; readonly GME: BillAuditability };
};

export type BillReferenceDetailDTO = {
  readonly officialName: string;
  readonly authority: string;
  readonly officialIdentifier: string;
  readonly value: number;
  readonly unit: string;
  readonly effectivePeriod: { readonly from: string; readonly to: string | null };
  readonly billEvidence: "PRESENT_EXACT" | "PRESENT_AGGREGATED" | "NOT_IDENTIFIED";
  readonly auditability: BillAuditability | MatrixAuditability;
  readonly referenceDomain: ReferenceDomain | null;
};

export type BillRegulatoryAuditLine = {
  readonly code: string;
  readonly category: BillAuditCategory;
  readonly authority: string;
  readonly billAmount: number | null;
  readonly billUnitPrice: number | null;
  readonly billUnit: string | null;
  readonly billQuantity: number | null;
  readonly expectedAmount: number | null;
  readonly expectedUnitPrice: number | null;
  readonly expectedUnit: string | null;
  readonly differenceAmount: number | null;
  readonly differencePercent: number | null;
  readonly auditStatus: BillAuditStatus;
  readonly notComparableReason: BillNotComparableReason;
  readonly sourceReference: string | null;
  readonly officialIdentifier: string | null;
  readonly effectivePeriod: { readonly from: string; readonly to: string | null } | null;
  readonly messageCode: string;
  readonly description: string;
};

export type BillRegulatoryAuditDTO = {
  readonly billId: string | null;
  readonly versionId: string | null;
  readonly billingPeriod: ElectricityBillAuditInput["billingPeriod"];
  readonly domesticResidenceStatus: ElectricityBillAuditInput["domesticResidenceStatus"];
  readonly lines: readonly BillRegulatoryAuditLine[];
  readonly summary: {
    readonly overallStatus: "REGULAR" | "ATTENTION" | "ANOMALIES_FOUND" | "INCOMPLETE";
    readonly confirmedAnomalyCount: number;
    readonly verifiedRegulatedCount: number;
    readonly notComparableCount: number;
    readonly contractReferenceRequiredCount: number;
    readonly confirmedOverchargeAmount: number;
    readonly confirmedUnderchargeAmount: number;
    readonly confirmedDifferenceCount: number;
    readonly confirmedOverchargeCount: number;
    readonly confirmedUnderchargeCount: number;
    readonly netConfirmedDifferenceAmount: number;
    readonly unitSemanticIssueCount: number;
    readonly sourceCoverage: { readonly GME: "VERIFIED" | "MISSING"; readonly ARERA: "VERIFIED" | "PARTIAL" | "MISSING"; readonly CONTRACT: "VERIFIED" | "MISSING"; readonly TAX: "MISSING" };
  };
  readonly gme: {
    readonly applied: number | null;
    readonly appliedOriginalValue: number | null;
    readonly appliedOriginalUnit: string | null;
    readonly appliedNormalizedValue: number | null;
    readonly appliedNormalizedUnit: "EUR/MWH" | null;
    readonly appliedUnitStatus: BillPunUnitStatus;
    readonly reference: OfficialGmeReference | null;
    readonly delta: number | null;
    readonly contractAuditStatus: "CONTRACT_REFERENCE_REQUIRED" | "NOT_COMPARABLE" | "NOT_PROVIDED";
  };
  readonly supplyProfile: { readonly usage: "DOMESTIC" | "OTHER" | "UNKNOWN"; readonly residence: "RESIDENT" | "NON_RESIDENT" | "UNKNOWN"; readonly market: string | null; readonly voltage: string | null };
  readonly coverage: BillCoverageDTO;
  readonly referenceDetails: readonly BillReferenceDetailDTO[];
  readonly regulatedPassThrough?: RegulatedPassThroughVerification | null;
  readonly domesticResidentMatrix?: DomesticResidentMatrix | null;
};

const nonEmpty = (value: string | number | null | undefined): boolean => value !== null && value !== undefined && String(value).trim() !== "";
export function parseBillNumeric(value: string | number | null | undefined): number | null {
  if (!nonEmpty(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s/g, "").replace(/[^0-9,.+-]/g, "");
  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact.split(".").length > 2 ? compact.replace(/\./g, "") : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBillQuantity(value: string | number | null | undefined): number | null {
  if (typeof value !== "string") return parseBillNumeric(value);
  const token = value.match(/(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/)?.[0] ?? null;
  return parseBillNumeric(token);
}

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const canonicalBillUnit = (value: string | null | undefined): string | null => value ? value.toUpperCase().replace(/€/g, "EUR").replace(/\s/g, "").replace(/KW\/MESE/g, "KW/MONTH").replace(/POD\/MESE/g, "POD/MONTH").replace(/KW\/ANNO/g, "KW/YEAR").replace(/POD\/ANNO/g, "POD/YEAR") : null;

function normalizePunUnit(value: string | null | undefined): "EUR/KWH" | "EUR/MWH" | null {
  const unit = canonicalBillUnit(value)?.replace(/PER/g, "/");
  if (unit === "EUR/KWH") return unit;
  if (unit === "EUR/MWH") return unit;
  return null;
}

export function normalizeAppliedPun(value: string | number | null | undefined, unit: string | null | undefined): { readonly originalValue: number | null; readonly originalUnit: string | null; readonly normalizedValue: number | null; readonly normalizedUnit: "EUR/MWH" | null; readonly status: BillPunUnitStatus } {
  const originalValue = parseBillNumeric(value);
  const originalUnit = canonicalBillUnit(unit);
  const normalizedUnit = normalizePunUnit(unit);
  if (originalValue === null || normalizedUnit === null) return { originalValue, originalUnit, normalizedValue: null, normalizedUnit: null, status: "UNRESOLVED" };
  return { originalValue, originalUnit, normalizedValue: normalizedUnit === "EUR/KWH" ? originalValue * 1000 : originalValue, normalizedUnit: "EUR/MWH", status: "RESOLVED" };
}

export function amountUnitConsistency(line: BillAuditChargeLineInput): { readonly status: "CONSISTENT" | "UNIT_SEMANTICS_INCONSISTENT" | "INSUFFICIENT_DOCUMENT_DATA"; readonly calculatedAmount: number | null; readonly displayUnitMismatch: boolean } {
  const amount = parseBillNumeric(line.amount);
  const quantity = parseBillQuantity(line.quantity);
  const unitPrice = typeof line.unitPrice === "string" && line.unitPrice.includes("%") ? null : parseBillNumeric(line.unitPrice);
  const unit = canonicalBillUnit(line.unit);
  if (amount === null) return { status: "INSUFFICIENT_DOCUMENT_DATA", calculatedAmount: null, displayUnitMismatch: false };
  if (unitPrice !== null && quantity !== null) {
    const calculatedAmount = unit === "%" ? quantity * unitPrice / 100 : quantity * unitPrice;
    const status = roundMoney(calculatedAmount) === roundMoney(amount) ? "CONSISTENT" : "UNIT_SEMANTICS_INCONSISTENT";
    return { status, calculatedAmount, displayUnitMismatch: false };
  }
  const moneyUnit = unit === null || unit === "EUR";
  if (!moneyUnit) return { status: "UNIT_SEMANTICS_INCONSISTENT", calculatedAmount: null, displayUnitMismatch: true };
  if (unitPrice !== null || quantity !== null) return { status: "INSUFFICIENT_DOCUMENT_DATA", calculatedAmount: null, displayUnitMismatch: false };
  return { status: "CONSISTENT", calculatedAmount: null, displayUnitMismatch: false };
}

export function identifyAmountUnitIssues(lines: readonly BillAuditChargeLineInput[]): readonly AmountUnitIssue[] {
  const issues: AmountUnitIssue[] = [];
  for (const line of lines) {
    const rawQuantity = parseBillNumeric(line.quantity);
    const quantity = parseBillQuantity(line.quantity);
    const unitPrice = parseBillNumeric(line.unitPrice);
    const amount = parseBillNumeric(line.amount);
    const unit = canonicalBillUnit(line.unit);
    if (line.code === "POWER_CHARGE" && typeof line.quantity === "string" && /\b(?:per|mese|month)\b/i.test(line.quantity) && rawQuantity !== quantity && unitPrice !== null && amount !== null) {
      issues.push({ code: "AMOUNT_UNIT_QUANTITY_DURATION_COLLISION", type: "QUANTITY_PARSE_AMBIGUITY", field: "quantity", rootCause: "AMBIGUOUS_EXTRACTION" });
    }
    if (unit === "%" && quantity !== null && unitPrice !== null && amount !== null && roundMoney(quantity * unitPrice / 100) === roundMoney(amount)) {
      issues.push({ code: "AMOUNT_UNIT_PERCENT_RATE_SCALE", type: "PERCENT_UNIT_PRICE_SCALE", field: "unitPrice", rootCause: "OTHER:PERCENT_RATE_NOT_NORMALIZED" });
    }
  }
  return issues;
}

export function customerScopeForBill(input: Pick<ElectricityBillAuditInput, "customerType" | "domesticResidenceStatus">): RegulatoryCustomerScope | "UNKNOWN" {
  if (input.customerType !== "RESIDENTIAL") return "NON_DOMESTIC_BT";
  if (input.domesticResidenceStatus === "PROVEN") return "DOMESTIC_RESIDENT_BT";
  return "UNKNOWN";
}

function regulatedScopeForBill(code: string, bill: ElectricityBillAuditInput): RegulatoryCustomerScope | "UNKNOWN" {
  // UC3 and UC6 are not selected by registry residence status. For a residential
  // bill their minimum applicable scope is domestic low voltage.
  if (["UC3", "UC6"].includes(code)) return bill.customerType === "RESIDENTIAL" ? "DOMESTIC_BT" : "NON_DOMESTIC_BT";
  return customerScopeForBill(bill);
}

function sourceUnitForBill(code: string, unit: string | null | undefined): string | undefined {
  if (code !== "UC6") return undefined;
  if (canonicalBillUnit(unit)?.includes("KW")) return "EUR/KW/YEAR";
  if (canonicalBillUnit(unit)?.includes("KWH")) return "EUR/KWH";
  return undefined;
}

function classification(code: string): { readonly category: BillAuditCategory; readonly authority: string } {
  const normalized = code.trim().toUpperCase();
  if (["SPREAD", "SELLER_FIXED", "COMMERCIALIZATION"].includes(normalized)) return { category: "SELLER_CONTRACTUAL", authority: "CONTRACT_CTE" };
  if (/^PUN(?:_|$)/.test(normalized)) return { category: "MARKET_GME", authority: "GME" };
  if (["NETWORK_SYSTEM", "NETWORK_FIXED", "POWER_CHARGE", "ASOS", "ARIM", "UC3", "UC6"].includes(normalized)) return { category: "REGULATED_ARERA", authority: "ARERA" };
  if (["EXCISE", "VAT", "TAX"].includes(normalized)) return { category: "TAX", authority: "TAX_AUTHORITY" };
  if (normalized === "DISPATCHING" || normalized.startsWith("DISPATCHING_")) return { category: "DISPATCHING", authority: "ARERA_OR_TERNA" };
  if (normalized === "CAPACITY_MARKET" || normalized.startsWith("CAPACITY_MARKET_")) return { category: "CAPACITY_MARKET", authority: "TERNA" };
  if (normalized === "IMBALANCE") return { category: "OTHER", authority: "CONTRACT_OR_TERNA" };
  if (["BONUS", "DISCOUNT", "RECALCULATION", "OTHER_CHARGE", "TOTAL", "TOTAL_AMOUNT"].includes(normalized)) return { category: "OTHER", authority: "DOCUMENT_OR_CONTRACT" };
  return { category: "UNCLASSIFIED", authority: "UNRESOLVED" };
}

const sourceFor = (record: RegulatoryValueRecord | null): Pick<BillRegulatoryAuditLine, "sourceReference" | "officialIdentifier" | "effectivePeriod"> => record ? { sourceReference: record.sourceReference, officialIdentifier: record.officialIdentifier, effectivePeriod: { from: record.effectiveFrom, to: record.effectiveTo } } : { sourceReference: null, officialIdentifier: null, effectivePeriod: null };

function auditLine(input: BillAuditChargeLineInput, bill: ElectricityBillAuditInput, values: readonly RegulatoryValueRecord[], contract: ContractReference | null): BillRegulatoryAuditLine {
  const { category, authority } = classification(input.code);
  const amount = parseBillNumeric(input.amount);
  const unitPrice = parseBillNumeric(input.unitPrice);
  const quantity = parseBillNumeric(input.quantity);
  const consistency = amountUnitConsistency(input);
  const base = { code: input.code, category, authority, billAmount: amount, billUnitPrice: unitPrice, billUnit: canonicalBillUnit(input.unit), billQuantity: quantity, expectedAmount: null, expectedUnitPrice: null, expectedUnit: null, differenceAmount: null, differencePercent: null, sourceReference: null, officialIdentifier: null, effectivePeriod: null, description: input.description, notComparableReason: "NONE" as const };
  if (consistency.status !== "CONSISTENT") return { ...base, auditStatus: consistency.status, notComparableReason: consistency.status === "UNIT_SEMANTICS_INCONSISTENT" ? "UNIT_SEMANTICS_INCONSISTENT" : "INSUFFICIENT_DOCUMENT_DATA", messageCode: consistency.status === "UNIT_SEMANTICS_INCONSISTENT" ? "AMOUNT_UNIT_CONSISTENCY_CHECK_FAILED" : "AMOUNT_UNIT_DATA_INCOMPLETE" };
  if (category === "SELLER_CONTRACTUAL") return { ...base, auditStatus: contract?.approved ? "NOT_COMPARABLE" : "CONTRACT_REFERENCE_REQUIRED", notComparableReason: "FORMULA_MISSING", messageCode: contract?.approved ? "SELLER_CONTRACT_FORMULA_REQUIRED" : "CONTRACT_REFERENCE_REQUIRED" };
  if (category === "TAX") return { ...base, auditStatus: "SOURCE_AUTHORITY_NOT_IMPLEMENTED", notComparableReason: "REGULATORY_SOURCE_MISSING", messageCode: "TAX_NOT_VERIFIED_BY_ARERA" };
  if (category === "MARKET_GME") return { ...base, auditStatus: "NOT_COMPARABLE", notComparableReason: "FORMULA_MISSING", messageCode: "GME_REFERENCE_REQUIRES_CONTRACT_FORMULA" };
  if (category === "DISPATCHING" || category === "CAPACITY_MARKET") {
    const domain = category === "DISPATCHING" ? "DISPATCHING" : "CAPACITY_MARKET";
    const sourceRecord = values.find((candidate) => candidate.componentCode === input.code && referenceDomainOf(candidate) === domain && Date.parse(candidate.effectiveFrom) <= Date.parse(bill.billingPeriod.from) && (candidate.effectiveTo === null || Date.parse(bill.billingPeriod.from) < Date.parse(candidate.effectiveTo))) ?? null;
    return { ...base, ...sourceFor(sourceRecord), auditStatus: sourceRecord ? "CONTRACT_REFERENCE_REQUIRED" : "REGULATORY_SOURCE_MISSING", notComparableReason: sourceRecord ? "FORMULA_MISSING" : "REGULATORY_SOURCE_MISSING", messageCode: sourceRecord ? "PASS_THROUGH_CONTRACT_REFERENCE_REQUIRED" : "UPSTREAM_REFERENCE_MISSING" };
  }
  if (category !== "REGULATED_ARERA") return { ...base, auditStatus: category === "UNCLASSIFIED" ? "INSUFFICIENT_DOCUMENT_DATA" : "NOT_COMPARABLE", notComparableReason: "INSUFFICIENT_DOCUMENT_DATA", messageCode: category === "UNCLASSIFIED" ? "COMPONENT_UNCLASSIFIED" : "OTHER_PARTY_REQUIRES_SPECIFIC_SOURCE" };
  if (["NETWORK_SYSTEM", "NETWORK_FIXED", "POWER_CHARGE"].includes(input.code)) return { ...base, auditStatus: "NOT_COMPARABLE", notComparableReason: "AGGREGATED_BILL_LINE", messageCode: "AGGREGATED_REGULATED_COMPONENT_FORMULA_REQUIRED" };
  const scope = regulatedScopeForBill(input.code, bill);
  if (scope === "UNKNOWN") {
    const sourceRecord = values.find((candidate) => candidate.componentCode === input.code && Date.parse(candidate.effectiveFrom) <= Date.parse(bill.billingPeriod.from) && (candidate.effectiveTo === null || Date.parse(bill.billingPeriod.from) < Date.parse(candidate.effectiveTo))) ?? null;
    return { ...base, ...sourceFor(sourceRecord), auditStatus: "SCOPE_UNDETERMINED", notComparableReason: "CUSTOMER_SCOPE_UNDETERMINED", messageCode: "DOMESTIC_RESIDENCE_STATUS_UNKNOWN" };
  }
  const sourceUnit = sourceUnitForBill(input.code, input.unit);
  const record = resolveAreraEffectiveValue(values, bill.billingPeriod.from, input.code as RegulatoryValueRecord["componentCode"], scope, sourceUnit);
  if (!record) return { ...base, auditStatus: "REGULATORY_SOURCE_MISSING", notComparableReason: "REGULATORY_SOURCE_MISSING", messageCode: "ARERA_COMPONENT_SOURCE_MISSING" };
  if (quantity === null) return { ...base, ...sourceFor(record), auditStatus: "INSUFFICIENT_DOCUMENT_DATA", notComparableReason: "QUANTITY_MISSING", messageCode: "REGULATED_FORMULA_INPUT_MISSING" };
  if (amount === null) return { ...base, ...sourceFor(record), auditStatus: "INSUFFICIENT_DOCUMENT_DATA", notComparableReason: "INSUFFICIENT_DOCUMENT_DATA", messageCode: "REGULATED_FORMULA_INPUT_MISSING" };
  let expectedUnitPrice: number;
  try { expectedUnitPrice = normalizeRegulatoryUnit(record.normalizedValue, record.normalizedUnit, input.unit ?? record.normalizedUnit).value; } catch { return { ...base, ...sourceFor(record), auditStatus: "NOT_COMPARABLE", notComparableReason: "UNIT_SEMANTICS_INCONSISTENT", messageCode: "REGULATED_UNIT_NOT_COMPARABLE" }; }
  const rawExpectedAmount = quantity * expectedUnitPrice;
  const expectedAmount = roundMoney(rawExpectedAmount);
  const rawDifference = amount - rawExpectedAmount;
  const differenceAmount = roundMoney(rawDifference);
  const differencePercent = expectedAmount === 0 ? null : (differenceAmount / expectedAmount) * 100;
  const roundedBilled = roundMoney(amount);
  const machineExact = Math.abs(rawDifference) <= Number.EPSILON * Math.max(1, Math.abs(amount), Math.abs(rawExpectedAmount)) * 8;
  const status: BillAuditStatus = roundedBilled === expectedAmount ? (machineExact ? "MATCH" : "ROUNDING_DIFFERENCE") : roundedBilled > expectedAmount ? "OVERCHARGE" : "UNDERCHARGE";
  return { ...base, ...sourceFor(record), expectedAmount, expectedUnitPrice, expectedUnit: record.normalizedUnit, differenceAmount, differencePercent, auditStatus: status, messageCode: status === "MATCH" ? "REGULATED_COMPONENT_MATCH" : status === "ROUNDING_DIFFERENCE" ? "REGULATED_ROUNDING_DIFFERENCE" : "REGULATED_COMPONENT_DIFFERENCE" };
}

export function auditElectricityBill(input: ElectricityBillAuditInput, options: { readonly regulatoryReferences?: readonly RegulatoryValueRecord[]; readonly officialGmeReferences?: readonly OfficialGmeReference[]; readonly appliedPun?: number | null; readonly appliedPunOriginalValue?: number | null; readonly appliedPunOriginalUnit?: string | null; readonly contractReference?: ContractReference | null } = {}): BillRegulatoryAuditDTO {
  const values = options.regulatoryReferences ?? [];
  const contract = options.contractReference ?? null;
  const lines = input.chargeLines.map((line) => auditLine(line, input, values, contract));
  const regulated = lines.filter((line) => line.category === "REGULATED_ARERA");
  const seller = lines.filter((line) => line.category === "SELLER_CONTRACTUAL");
  const anomalies = lines.filter((line) => line.auditStatus === "OVERCHARGE" || line.auditStatus === "UNDERCHARGE" || line.auditStatus === "MISMATCH");
  const overcharge = lines.filter((line) => line.auditStatus === "OVERCHARGE").reduce((sum, line) => sum + Math.max(0, line.differenceAmount ?? 0), 0);
  const undercharge = lines.filter((line) => line.auditStatus === "UNDERCHARGE").reduce((sum, line) => sum + Math.max(0, -(line.differenceAmount ?? 0)), 0);
  const unitSemanticIssueCount = lines.filter((line) => line.auditStatus === "UNIT_SEMANTICS_INCONSISTENT").length;
  const gmeReference = options.officialGmeReferences?.find((reference) => reference.month === input.billingPeriod.from.slice(0, 7)) ?? null;
  const normalizedPun = normalizeAppliedPun(options.appliedPunOriginalValue ?? options.appliedPun, options.appliedPunOriginalUnit);
  const gme = { applied: normalizedPun.normalizedValue, appliedOriginalValue: normalizedPun.originalValue, appliedOriginalUnit: normalizedPun.originalUnit, appliedNormalizedValue: normalizedPun.normalizedValue, appliedNormalizedUnit: normalizedPun.normalizedUnit, appliedUnitStatus: normalizedPun.status, reference: gmeReference, delta: normalizedPun.normalizedValue !== null && gmeReference?.value !== null && gmeReference?.value !== undefined ? normalizedPun.normalizedValue - gmeReference.value : null, contractAuditStatus: normalizedPun.normalizedValue !== null && gmeReference ? "CONTRACT_REFERENCE_REQUIRED" as const : "NOT_PROVIDED" as const };
  const notComparableCount = lines.filter((line) => ["NOT_COMPARABLE", "REGULATORY_SOURCE_MISSING", "SCOPE_UNDETERMINED", "INSUFFICIENT_DOCUMENT_DATA", "SOURCE_AUTHORITY_NOT_IMPLEMENTED", "UNIT_SEMANTICS_INCONSISTENT"].includes(line.auditStatus)).length;
  const contractReferenceRequiredCount = seller.filter((line) => line.auditStatus === "CONTRACT_REFERENCE_REQUIRED").length;
  const requiredRegulatoryCodes = ["ASOS", "ARIM", "UC3", "UC6", "S1_TOTAL", "S1_MEASURE", "S2_POWER", "S3_ENERGY_TRANSMISSION"] as const;
  const availableRegulatoryCodes = new Set(values.map((value) => value.componentCode));
  const areraAvailable = requiredRegulatoryCodes.filter((code) => availableRegulatoryCodes.has(code) || (code === "S1_TOTAL" && availableRegulatoryCodes.has("NETWORK_FIXED")) || (code === "S1_MEASURE" && availableRegulatoryCodes.has("METERING_FIXED")) || (code === "S2_POWER" && availableRegulatoryCodes.has("NETWORK_POWER")) || (code === "S3_ENERGY_TRANSMISSION" && (availableRegulatoryCodes.has("NETWORK_ENERGY") || availableRegulatoryCodes.has("TRANSMISSION_ENERGY")))).length;
  const sourceCoverage = { GME: gme.reference ? "VERIFIED" as const : "MISSING" as const, ARERA: areraAvailable === requiredRegulatoryCodes.length ? "VERIFIED" as const : areraAvailable ? "PARTIAL" as const : "MISSING" as const, CONTRACT: contract?.approved ? "VERIFIED" as const : "MISSING" as const, TAX: "MISSING" as const };
  const overallStatus = anomalies.length ? "ANOMALIES_FOUND" as const : (!values.length || contractReferenceRequiredCount > 0 || notComparableCount > 0 || unitSemanticIssueCount > 0) ? "INCOMPLETE" as const : "REGULAR" as const;
  const referenceDetails = values.map((record) => ({ officialName: record.officialName ?? record.componentCode, authority: record.authority, officialIdentifier: record.officialIdentifier, value: record.normalizedValue, unit: record.normalizedUnit, effectivePeriod: { from: record.effectiveFrom, to: record.effectiveTo }, billEvidence: "NOT_IDENTIFIED" as const, auditability: "NOT_AUDITABLE" as const, referenceDomain: referenceDomainOf(record) }));
  const emptyBillCoverage = { ARERA_NETWORK: "MISSING" as const, ARERA_SYSTEM_CHARGES: "MISSING" as const, DISPATCHING: "MISSING" as const, CAPACITY_MARKET: "MISSING" as const, GME: sourceCoverage.GME, CONTRACT: sourceCoverage.CONTRACT === "VERIFIED" ? "VERIFIED" as const : "MISSING" as const, TAX: "MISSING" as const };
  const emptyAuditability = { ARERA_NETWORK: "NOT_AUDITABLE" as const, ARERA_SYSTEM_CHARGES: "NOT_AUDITABLE" as const, DISPATCHING: "NOT_AUDITABLE" as const, CAPACITY_MARKET: "NOT_AUDITABLE" as const, GME: "NOT_AUDITABLE" as const };
  return { billId: input.billId ?? null, versionId: input.versionId ?? null, billingPeriod: input.billingPeriod, domesticResidenceStatus: input.domesticResidenceStatus, lines, gme, summary: { overallStatus, confirmedAnomalyCount: anomalies.length, verifiedRegulatedCount: regulated.filter((line) => line.auditStatus === "MATCH" || line.auditStatus === "ROUNDING_DIFFERENCE").length, notComparableCount, contractReferenceRequiredCount, confirmedOverchargeAmount: roundMoney(overcharge), confirmedUnderchargeAmount: roundMoney(undercharge), confirmedDifferenceCount: 0, confirmedOverchargeCount: 0, confirmedUnderchargeCount: 0, netConfirmedDifferenceAmount: 0, unitSemanticIssueCount, sourceCoverage }, supplyProfile: { usage: "UNKNOWN", residence: input.domesticResidenceStatus === "PROVEN" ? "RESIDENT" : "UNKNOWN", market: null, voltage: null }, coverage: { sourceCoverage: emptyBillCoverage, billAuditability: emptyAuditability }, referenceDetails };
}
