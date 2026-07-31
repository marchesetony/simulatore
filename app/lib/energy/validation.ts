import type {
  ApprovalMetadata,
  BillContract,
  BillReviewState,
  CustomerIdentity,
  CustomerSupplyRecord,
  DeclaredNumber,
  DeclaredText,
  ElectricitySupply,
  ExtractedFieldProvenance,
  GasSupply,
  Quantity,
  QuantityUnit,
  RegulatedCharge,
  Supply,
  TaxIdentifier,
  TaxInclusionState,
  VersionMetadata,
} from "./types";

export class EnergyContractValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "EnergyContractValidationError";
    this.code = code;
  }
}

const fail = (code: string): never => { throw new EnergyContractValidationError(code); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const required = (value: unknown, code: string): Record<string, unknown> => isRecord(value) ? value : fail(code);
const nonEmpty = (value: unknown, code: string): string => typeof value === "string" && value.trim().length > 0 ? value as string : fail(code);
const enumValue = <T extends string>(value: unknown, values: readonly T[], code: string): T => typeof value === "string" && values.includes(value as T) ? value as T : fail(code);
const finite = (value: unknown, code: string): number => typeof value === "number" && Number.isFinite(value) ? value : fail(code);
const nonNegative = (value: unknown, code: string): number => finite(value, code) >= 0 ? value as number : fail(code);

const dateOnly = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(code);
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) fail(code);
  return value as string;
};

const dateTime = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(code);
  return value as string;
};

const version = (value: unknown): string => {
  const result = nonEmpty(value, "VERSION_INVALID");
  if (!/^\d+(?:\.\d+)*$/.test(result) || result.split(".").some((part) => Number.parseInt(part, 10) < 1)) fail("VERSION_INVALID");
  return result;
};

export function assertVersionMetadata(value: unknown): asserts value is VersionMetadata {
  const item = required(value, "RECORD_INVALID");
  if (item.schemaVersion !== 1) fail("SCHEMA_VERSION_UNSUPPORTED");
  nonEmpty(item.recordId, "RECORD_ID_INVALID");
  version(item.version);
  if (item.parentVersionId !== null && typeof item.parentVersionId !== "string") fail("PARENT_VERSION_INVALID");
  const tenantId = nonEmpty(item.tenantId, "TENANT_ID_INVALID");
  if (!/^tenant_[a-z0-9-]+$/.test(tenantId)) fail("TENANT_ID_INVALID");
  assertApprovalMetadata(item.approval);
}

export function assertApprovalMetadata(value: unknown): asserts value is ApprovalMetadata {
  const item = required(value, "APPROVAL_METADATA_INVALID");
  const status = enumValue(item.status, ["DRAFT", "NEEDS_REVIEW", "REJECTED", "APPROVED"], "APPROVAL_METADATA_INVALID");
  if (status === "APPROVED") {
    nonEmpty(item.reviewer, "APPROVAL_METADATA_INVALID");
    dateTime(item.reviewedAt, "APPROVAL_METADATA_INVALID");
    nonEmpty(item.decisionId, "APPROVAL_METADATA_INVALID");
  } else {
    nonEmpty(item.reason, "APPROVAL_METADATA_INVALID");
  }
}

export function assertDatePeriod(value: unknown, code = "PERIOD_INVALID"): asserts value is { readonly periodStart: string; readonly periodEnd: string } & Record<string, unknown> {
  const item = required(value, code);
  const start = dateOnly(item.periodStart, code);
  const end = dateOnly(item.periodEnd, code);
  if (start >= end) fail(code);
}

export function assertEffectivePeriod(value: unknown, code = "EFFECTIVE_PERIOD_INVALID"): void {
  const item = required(value, code);
  const start = dateOnly(item.effectiveFrom, code);
  const end = item.effectiveTo === null ? null : dateOnly(item.effectiveTo, code);
  if (end !== null && start >= end) fail(code);
}

export function assertDeclaredText(value: unknown, code = "TEXT_VALUE_INVALID"): asserts value is DeclaredText {
  const item = required(value, code);
  const status = enumValue(item.status, ["KNOWN", "UNAVAILABLE", "NOT_APPLICABLE"], code);
  if (status === "KNOWN") nonEmpty(item.value, code);
  else nonEmpty(item.reason, code);
}

export function assertDeclaredNumber(value: unknown, code = "NUMBER_VALUE_INVALID"): asserts value is DeclaredNumber {
  const item = required(value, code);
  const status = enumValue(item.status, ["KNOWN", "UNAVAILABLE", "NOT_APPLICABLE"], code);
  if (status === "KNOWN") finite(item.value, code);
  else enumValue(item.reason, ["NOT_EXTRACTED", "NOT_PROVIDED", "NOT_APPLICABLE", "UNREADABLE"], code);
}

export function assertQuantity(value: unknown, expectedUnit: QuantityUnit, code = "QUANTITY_INVALID"): asserts value is Quantity {
  const item = required(value, code);
  if (item.unit !== expectedUnit) fail("UNIT_MISMATCH");
  const status = enumValue(item.status, ["KNOWN", "UNAVAILABLE", "NOT_APPLICABLE"], code);
  if (status === "KNOWN") nonNegative(item.value, code);
  else enumValue(item.reason, ["NOT_EXTRACTED", "NOT_PROVIDED", "NOT_APPLICABLE", "UNREADABLE"], code);
}

function assertTaxIdentifier(value: unknown): asserts value is TaxIdentifier {
  const item = required(value, "TAX_IDENTIFIER_INVALID");
  enumValue(item.kind, ["VAT_NUMBER", "TAX_CODE"], "TAX_IDENTIFIER_INVALID");
  const identifier = nonEmpty(item.value, "TAX_IDENTIFIER_INVALID");
  if (!/^[A-Z0-9 .-]{5,32}$/i.test(identifier)) fail("TAX_IDENTIFIER_INVALID");
}

function assertCustomer(value: unknown): asserts value is CustomerIdentity {
  const item = required(value, "CUSTOMER_INVALID");
  nonEmpty(item.customerId, "CUSTOMER_INVALID");
  enumValue(item.customerType, ["RESIDENTIAL", "NON_RESIDENTIAL"], "CUSTOMER_TYPE_INVALID");
  assertDeclaredText(item.name, "CUSTOMER_NAME_INVALID");
  if (!Array.isArray(item.taxIdentifiers) || item.taxIdentifiers.length === 0) fail("TAX_IDENTIFIER_MISSING");
  const candidates = item.taxIdentifiers as readonly unknown[];
  candidates.forEach(assertTaxIdentifier);
  const identifiers = candidates as readonly TaxIdentifier[];
  if (new Set(identifiers.map((identifier) => `${identifier.kind}:${identifier.value.toUpperCase()}`)).size !== identifiers.length) fail("TAX_IDENTIFIER_DUPLICATE");
}

function assertMeterAndSupply(value: unknown): void {
  const item = required(value, "SUPPLY_INVALID");
  nonEmpty(item.supplyId, "SUPPLY_ID_INVALID");
  nonEmpty(item.meterId, "METER_ID_INVALID");
}

export function assertElectricitySupply(value: unknown): asserts value is ElectricitySupply {
  const item = required(value, "SUPPLY_INVALID");
  assertMeterAndSupply(item);
  if (item.vector !== "EE") fail("VECTOR_MISMATCH");
  const pod = nonEmpty(item.pod, "POD_INVALID");
  if (!/^IT[A-Z0-9]{6,30}$/i.test(pod)) fail("POD_INVALID");
  enumValue(item.voltageLevel, ["LV", "MV", "HV", "EHV"], "VOLTAGE_LEVEL_INVALID");
  if (Object.prototype.hasOwnProperty.call(item, "pdr")) fail("EE_SCHEMA_MIXED");
}

export function assertGasSupply(value: unknown): asserts value is GasSupply {
  const item = required(value, "SUPPLY_INVALID");
  assertMeterAndSupply(item);
  if (item.vector !== "GAS") fail("VECTOR_MISMATCH");
  const pdr = nonEmpty(item.pdr, "PDR_INVALID");
  if (!/^\d{14}$/.test(pdr)) fail("PDR_INVALID");
  if (Object.prototype.hasOwnProperty.call(item, "pod") || Object.prototype.hasOwnProperty.call(item, "voltageLevel")) fail("GAS_SCHEMA_MIXED");
}

export function assertSupply(value: unknown, vector: "EE" | "GAS"): asserts value is Supply {
  if (vector === "EE") assertElectricitySupply(value);
  else assertGasSupply(value);
}

function assertConsumptionPeriods(value: unknown, vector: "EE" | "GAS"): void {
  if (!Array.isArray(value) || value.length === 0) fail("CONSUMPTION_PERIODS_MISSING");
  const sorted = (value as readonly unknown[]).map((period: unknown) => {
    const item = required(period, "CONSUMPTION_PERIOD_INVALID");
    assertDatePeriod(item, "CONSUMPTION_PERIOD_INVALID");
    const unit = vector === "EE" ? "KWH" : "SMC";
    if (item.unit !== unit) fail("UNIT_MISMATCH");
    const quantity = item.quantity as Quantity;
    assertQuantity(quantity, unit, "CONSUMPTION_QUANTITY_INVALID");
    if (quantity.status !== "KNOWN") fail("CONSUMPTION_QUANTITY_UNAVAILABLE");
    return item;
  }).sort((left, right) => String(left.periodStart).localeCompare(String(right.periodStart)));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].periodEnd > sorted[index].periodStart) fail("CONSUMPTION_PERIOD_OVERLAP");
  }
}

export function validateCustomerSupplyRecord(value: unknown): asserts value is CustomerSupplyRecord {
  assertVersionMetadata(value);
  const item = value as unknown as Record<string, unknown>;
  if (item.recordType !== "CUSTOMER_SUPPLY") fail("RECORD_TYPE_INVALID");
  const vector = enumValue(item.vector, ["EE", "GAS"], "VECTOR_INVALID");
  assertCustomer(item.customer);
  assertSupply(item.supply, vector);
  assertQuantity(item.annualConsumption, vector === "EE" ? "KWH" : "SMC", "ANNUAL_CONSUMPTION_INVALID");
  assertConsumptionPeriods(item.consumptionPeriods, vector);
  if (vector === "GAS" && isRecord(item.supply) && Object.prototype.hasOwnProperty.call(item.supply, "voltageLevel")) fail("GAS_SCHEMA_MIXED");
}

function assertSupplierOffer(value: unknown): void {
  const item = required(value, "OFFER_REFERENCE_INVALID");
  nonEmpty(item.supplier, "SUPPLIER_INVALID");
  assertDeclaredText(item.offerName, "OFFER_NAME_INVALID");
  assertDeclaredText(item.offerCode, "OFFER_CODE_INVALID");
}

function assertProvenance(value: unknown): asserts value is readonly ExtractedFieldProvenance[] {
  if (!Array.isArray(value) || value.length === 0) fail("FIELD_PROVENANCE_MISSING");
  const fields = new Set<string>();
  for (const candidate of value as readonly unknown[]) {
    const item = required(candidate, "FIELD_PROVENANCE_INVALID");
    enumValue(item.field, ["billingPeriod", "customer", "supply", "consumption", "supplier", "offer", "regulatedCharges"], "FIELD_PROVENANCE_INVALID");
    if (fields.has(String(item.field))) fail("FIELD_PROVENANCE_DUPLICATE");
    fields.add(String(item.field));
    enumValue(item.source, ["BILL_DOCUMENT", "MANUAL_REVIEW", "REGULATORY_SOURCE", "UNAVAILABLE"], "FIELD_PROVENANCE_INVALID");
    nonEmpty(item.sourceReference, "FIELD_PROVENANCE_INVALID");
    nonEmpty(item.locator, "FIELD_PROVENANCE_INVALID");
    const confidence = finite(item.confidence, "CONFIDENCE_INVALID");
    if (confidence < 0 || confidence > 1) fail("CONFIDENCE_INVALID");
    if (typeof item.reviewed !== "boolean") fail("FIELD_PROVENANCE_INVALID");
    if (item.source === "UNAVAILABLE" && confidence !== 0) fail("CONFIDENCE_INVALID");
  }
}

function assertCharge(value: unknown): asserts value is RegulatedCharge {
  const item = required(value, "REGULATED_CHARGE_INVALID");
  nonEmpty(item.code, "REGULATED_CHARGE_INVALID");
  nonEmpty(item.label, "REGULATED_CHARGE_INVALID");
  nonNegative(item.amount, "REGULATED_CHARGE_INVALID");
  if (item.currency !== "EUR") fail("CURRENCY_INVALID");
  enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "TAX_TREATMENT_INVALID");
}

function assertReviewState(value: unknown): asserts value is BillReviewState {
  enumValue(value, ["UNREVIEWED", "NEEDS_REVIEW", "REVIEWED", "APPROVED", "REJECTED"], "REVIEW_STATE_INVALID");
}

function assertBillBase(value: unknown): Record<string, unknown> {
  assertVersionMetadata(value);
  const item = value as unknown as Record<string, unknown>;
  if (item.recordType !== "BILL") fail("RECORD_TYPE_INVALID");
  const vector = enumValue(item.vector, ["EE", "GAS"], "VECTOR_INVALID");
  nonEmpty(item.billId, "BILL_ID_INVALID");
  nonEmpty(item.customerId, "BILL_CUSTOMER_ID_INVALID");
  nonEmpty(item.supplyId, "BILL_SUPPLY_ID_INVALID");
  assertDatePeriod(item.billingPeriod);
  enumValue(item.consumptionBasis, ["MEASURED", "ESTIMATED", "MIXED"], "CONSUMPTION_BASIS_INVALID");
  nonEmpty(item.currentSupplier, "SUPPLIER_INVALID");
  assertSupplierOffer(item.offer);
  if (!Array.isArray(item.regulatedCharges)) fail("REGULATED_CHARGES_INVALID");
  (item.regulatedCharges as readonly unknown[]).forEach(assertCharge);
  assertProvenance(item.fieldProvenance);
  assertReviewState(item.reviewState);
  return { ...item, vector };
}

function assertElectricityBillConsumption(value: unknown): void {
  const item = required(value, "CONSUMPTION_INVALID");
  if (item.vector !== "EE") fail("VECTOR_MISMATCH");
  if (Object.prototype.hasOwnProperty.call(item, "smc") || Object.prototype.hasOwnProperty.call(item, "correctionCoefficient")) fail("EE_SCHEMA_MIXED");
  assertQuantity(item.f1, "KWH");
  assertQuantity(item.f2, "KWH");
  assertQuantity(item.f3, "KWH");
  assertQuantity(item.total, "KWH");
  const bands = [item.f1, item.f2, item.f3];
  if (bands.every((band) => isRecord(band) && band.status === "KNOWN") && isRecord(item.total) && item.total.status === "KNOWN") {
    const sum = bands.reduce((total, band) => total + Number((band as { readonly value: number }).value), 0);
    if (Math.abs(sum - item.total.value) > 1e-9) fail("CONSUMPTION_TOTAL_MISMATCH");
  }
}

function assertGasBillConsumption(value: unknown): void {
  const item = required(value, "CONSUMPTION_INVALID");
  if (item.vector !== "GAS") fail("VECTOR_MISMATCH");
  if (Object.prototype.hasOwnProperty.call(item, "f1") || Object.prototype.hasOwnProperty.call(item, "f2") || Object.prototype.hasOwnProperty.call(item, "f3") || Object.prototype.hasOwnProperty.call(item, "total")) fail("GAS_SCHEMA_MIXED");
  assertQuantity(item.smc, "SMC");
  assertDeclaredNumber(item.correctionCoefficient, "CORRECTION_COEFFICIENT_INVALID");
  if (isRecord(item.correctionCoefficient) && item.correctionCoefficient.status === "KNOWN" && item.correctionCoefficient.value <= 0) fail("CORRECTION_COEFFICIENT_INVALID");
}

export function validateBillContract(value: unknown): asserts value is BillContract {
  const item = assertBillBase(value);
  if (item.vector === "EE") {
    assertElectricitySupply(item.supply);
    assertElectricityBillConsumption(item.consumption);
    if (isRecord(item.supply) && Object.prototype.hasOwnProperty.call(item.supply, "pdr")) fail("EE_SCHEMA_MIXED");
  } else {
    assertGasSupply(item.supply);
    assertGasBillConsumption(item.consumption);
    if (isRecord(item.supply) && Object.prototype.hasOwnProperty.call(item.supply, "voltageLevel")) fail("GAS_SCHEMA_MIXED");
  }
}

export function assertTaxTreatment(value: unknown): asserts value is TaxInclusionState {
  enumValue(value, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "TAX_TREATMENT_INVALID");
}
