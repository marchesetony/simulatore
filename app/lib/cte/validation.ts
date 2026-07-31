import type {
  CteCommercialTerms,
  CteContract,
  CteDeclaredComponent,
  CteExpiry,
  CteFeeComponent,
  CteOffer,
  CtePrice,
  CteSupplier,
  ElectricityCteContract,
  GasCteContract,
} from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertDatePeriod, assertEffectivePeriod, assertVersionMetadata, EnergyContractValidationError } from "../energy/validation.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertApprovalMetadata } from "../energy/validation.ts";
import type { ApprovalMetadata, VoltageLevel } from "../energy/types";

const fail = (code: string): never => { throw new EnergyContractValidationError(code); };
const record = (value: unknown, code: string): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail(code);
const nonEmpty = (value: unknown, code: string): string => typeof value === "string" && value.trim() ? value as string : fail(code);
const enumValue = <T extends string>(value: unknown, values: readonly T[], code: string): T => typeof value === "string" && values.includes(value as T) ? value as T : fail(code);
const finite = (value: unknown, code: string): number => typeof value === "number" && Number.isFinite(value) ? value : fail(code);
const nonNegative = (value: unknown, code: string): number => finite(value, code) >= 0 ? value as number : fail(code);

function assertSupplier(value: unknown): asserts value is CteSupplier {
  const item = record(value, "CTE_SUPPLIER_INVALID");
  nonEmpty(item.supplierId, "CTE_SUPPLIER_INVALID");
  nonEmpty(item.name, "CTE_SUPPLIER_INVALID");
}

function assertOffer(value: unknown): asserts value is CteOffer {
  const item = record(value, "CTE_OFFER_INVALID");
  nonEmpty(item.offerId, "CTE_OFFER_INVALID");
  nonEmpty(item.name, "CTE_OFFER_INVALID");
  nonEmpty(item.code, "CTE_OFFER_INVALID");
}

function assertPrice(value: unknown, unit: CtePrice["unit"]): asserts value is CtePrice {
  const item = record(value, "CTE_PRICE_INVALID");
  nonNegative(item.amount, "CTE_PRICE_INVALID");
  if (item.currency !== "EUR" || item.unit !== unit) fail("CTE_PRICE_UNIT_INVALID");
  enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "CTE_TAX_TREATMENT_INVALID");
}

function assertFee(value: unknown): asserts value is CteFeeComponent {
  const item = record(value, "CTE_FEE_INVALID");
  nonEmpty(item.feeId, "CTE_FEE_INVALID");
  nonEmpty(item.label, "CTE_FEE_INVALID");
  nonNegative(item.amount, "CTE_FEE_INVALID");
  if (item.currency !== "EUR") fail("CURRENCY_INVALID");
  enumValue(item.unit, ["EUR_PER_KWH", "EUR_PER_SMC", "EUR_PER_MONTH", "EUR_PER_YEAR", "EUR_PER_CONTRACT"], "CTE_FEE_UNIT_INVALID");
  enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "CTE_TAX_TREATMENT_INVALID");
}

function assertDeclaredComponent(value: unknown): asserts value is CteDeclaredComponent {
  const item = record(value, "CTE_COMPONENT_INVALID");
  const status = enumValue(item.status, ["DECLARED", "NOT_DECLARED"], "CTE_COMPONENT_INVALID");
  if (status === "DECLARED") assertFee(item.component);
  else enumValue(item.reason, ["NOT_PROVIDED", "NOT_APPLICABLE"], "CTE_COMPONENT_INVALID");
}

function assertCommercialTerms(value: unknown): asserts value is CteCommercialTerms {
  const item = record(value, "CTE_COMMERCIAL_TERMS_INVALID");
  const feeIds = new Set<string>();
  for (const field of ["fixedFees", "variableFees", "oneOffFees", "commercialDiscounts"] as const) {
    if (!Array.isArray(item[field])) fail("CTE_COMMERCIAL_TERMS_INVALID");
    (item[field] as readonly unknown[]).forEach((candidate: unknown) => {
      assertFee(candidate);
      const feeId = (candidate as CteFeeComponent).feeId;
      if (feeIds.has(feeId)) fail("CTE_FEE_DUPLICATE");
      feeIds.add(feeId);
    });
  }
  assertDeclaredComponent(item.imbalance);
}

function assertExpiry(value: unknown): asserts value is CteExpiry {
  const item = record(value, "CTE_EXPIRY_INVALID");
  const status = enumValue(item.status, ["EXPIRES_ON", "NO_EXPIRY_DECLARED"], "CTE_EXPIRY_INVALID");
  if (status === "EXPIRES_ON") {
    const date = nonEmpty(item.date, "CTE_EXPIRY_INVALID");
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) fail("CTE_EXPIRY_INVALID");
  } else if (item.reason !== "NOT_PROVIDED") fail("CTE_EXPIRY_INVALID");
}

function assertBase(value: unknown): Record<string, unknown> {
  assertVersionMetadata(value);
  const item = value as unknown as Record<string, unknown>;
  if (item.recordType !== "CTE") fail("RECORD_TYPE_INVALID");
  nonEmpty(item.cteId, "CTE_ID_INVALID");
  assertSupplier(item.supplier);
  assertOffer(item.offer);
  assertDatePeriod(item.validity, "CTE_VALIDITY_INVALID");
  assertEffectivePeriod({ effectiveFrom: (item.validity as Record<string, unknown>).periodStart, effectiveTo: (item.validity as Record<string, unknown>).periodEnd }, "CTE_VALIDITY_INVALID");
  assertExpiry(item.expiry);
  if (item.currency !== "EUR") fail("CURRENCY_INVALID");
  enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "CTE_TAX_TREATMENT_INVALID");
  assertCommercialTerms(item.commercialTerms);
  assertApprovalMetadata(item.approval as ApprovalMetadata);
  return item;
}

function assertCustomerTypes(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) fail("CTE_ELIGIBILITY_INVALID");
  const values = (value as readonly unknown[]).map((candidate: unknown) => enumValue(candidate, ["RESIDENTIAL", "NON_RESIDENTIAL"], "CTE_ELIGIBILITY_INVALID"));
  if (new Set(values).size !== values.length) fail("CTE_ELIGIBILITY_INVALID");
}

function assertVoltageLevels(value: unknown): asserts value is readonly VoltageLevel[] {
  if (!Array.isArray(value) || value.length === 0) fail("CTE_VOLTAGE_ELIGIBILITY_INVALID");
  const values = (value as readonly unknown[]).map((candidate: unknown) => enumValue(candidate, ["LV", "MV", "HV", "EHV"], "CTE_VOLTAGE_ELIGIBILITY_INVALID"));
  if (new Set(values).size !== values.length) fail("CTE_VOLTAGE_ELIGIBILITY_INVALID");
}

function assertElectricityPricing(value: unknown): void {
  const item = record(value, "CTE_PRICING_INVALID");
  const mode = enumValue(item.mode, ["INDEXED", "FIXED"], "CTE_PRICING_INVALID");
  if (mode === "INDEXED") {
    if (item.reference !== "PUN") fail("EE_REFERENCE_INVALID");
    assertPrice(item.spread, "EUR_PER_KWH");
  } else {
    if (item.reference !== "NONE") fail("EE_REFERENCE_INVALID");
    assertPrice(item.fixedPrice, "EUR_PER_KWH");
    assertDeclaredComponent(item.spread);
  }
}

function assertGasPricing(value: unknown): void {
  const item = record(value, "CTE_PRICING_INVALID");
  const mode = enumValue(item.mode, ["INDEXED", "FIXED"], "CTE_PRICING_INVALID");
  if (mode === "INDEXED") {
    if (item.reference !== "PSV") fail("GAS_REFERENCE_INVALID");
    assertPrice(item.spread, "EUR_PER_SMC");
  } else {
    if (item.reference !== "NONE") fail("GAS_REFERENCE_INVALID");
    assertPrice(item.fixedPrice, "EUR_PER_SMC");
    assertDeclaredComponent(item.spread);
  }
}

export function validateElectricityCte(value: unknown): asserts value is ElectricityCteContract {
  const item = assertBase(value);
  if (item.vector !== "EE") fail("VECTOR_MISMATCH");
  const eligibility = record(item.eligibility, "CTE_ELIGIBILITY_INVALID");
  assertCustomerTypes(eligibility.customerTypes);
  assertVoltageLevels(eligibility.voltageLevels);
  assertElectricityPricing(item.pricing);
  if (Object.prototype.hasOwnProperty.call(item, "pdr")) fail("EE_SCHEMA_MIXED");
}

export function validateGasCte(value: unknown): asserts value is GasCteContract {
  const item = assertBase(value);
  if (item.vector !== "GAS") fail("VECTOR_MISMATCH");
  const eligibility = record(item.eligibility, "CTE_ELIGIBILITY_INVALID");
  assertCustomerTypes(eligibility.customerTypes);
  if (Object.prototype.hasOwnProperty.call(eligibility, "voltageLevels")) fail("GAS_SCHEMA_MIXED");
  assertGasPricing(item.pricing);
  if (Object.prototype.hasOwnProperty.call(item, "pod") || Object.prototype.hasOwnProperty.call(item, "voltageLevel")) fail("GAS_SCHEMA_MIXED");
}

export function validateCteContract(value: unknown): asserts value is CteContract {
  const item = record(value, "RECORD_INVALID");
  if (item.vector === "EE") validateElectricityCte(value);
  else if (item.vector === "GAS") validateGasCte(value);
  else fail("VECTOR_INVALID");
}
