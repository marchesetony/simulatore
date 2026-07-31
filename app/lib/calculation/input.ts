import type { CustomerType, TaxInclusionState, VoltageLevel } from "../energy/types";
import type { ElectricityMonthlyProfile, ElectricitySimulationRequest, GasMonthlyProfile, GasSimulationRequest, SimulationRequest } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { add, equals, fromNumber, zero } from "./decimal.ts";

export class CalculationInputError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "CalculationInputError"; this.code = code; }
}
const fail = (code: string): never => { throw new CalculationInputError(code); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const recordValue = (value: unknown, code: string): Record<string, unknown> => isRecord(value) ? value : fail(code);
const requiredString = (value: unknown, code: string): string => typeof value === "string" && value.trim().length > 0 ? value : fail(code);
const enumValue = <T extends string>(value: unknown, values: readonly T[], code: string): T => typeof value === "string" && values.includes(value as T) ? value as T : fail(code);
const finiteNonNegative = (value: unknown, code: string): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail(code);

function dateOnly(value: unknown, code: string): string {
  const text = requiredString(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(code);
  const parsed = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) fail(code);
  return text;
}
function month(value: unknown): string { const text = requiredString(value, "MONTH_INVALID"); if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(text)) fail("MONTH_INVALID"); return text; }
function monthsForPeriod(start: string, end: string): readonly string[] { const result: string[] = []; const cursor = new Date(`${start}T00:00:00.000Z`); const endDate = new Date(`${end}T00:00:00.000Z`); while (cursor < endDate) { result.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); } return result; }

function assertPeriod(value: unknown): { readonly periodStart: string; readonly periodEnd: string } {
  const item = recordValue(value, "SUPPLY_PERIOD_INVALID");
  const periodStart = dateOnly(item.periodStart, "SUPPLY_PERIOD_INVALID");
  const periodEnd = dateOnly(item.periodEnd, "SUPPLY_PERIOD_INVALID");
  if (!periodStart.endsWith("-01") || !periodEnd.endsWith("-01") || periodStart >= periodEnd) fail("SUPPLY_PERIOD_INVALID");
  return { periodStart, periodEnd };
}
function assertNoTrustedOutcome(value: Record<string, unknown>): void { if (Object.prototype.hasOwnProperty.call(value, "approval") || Object.prototype.hasOwnProperty.call(value, "approved") || Object.prototype.hasOwnProperty.call(value, "trustedPrice")) fail("TRUSTED_OUTCOME_FORBIDDEN"); }

type CommonInput = {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly calculationDate: string;
  readonly supplyPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly customerCategory: CustomerType;
  readonly residency?: CustomerType;
  readonly currency: "EUR";
  readonly taxTreatment: TaxInclusionState;
  readonly sourceBill?: { readonly billId: string; readonly version: string };
  readonly baseline?: { readonly totalCommercialCost: number; readonly currency: "EUR"; readonly taxTreatment: TaxInclusionState; readonly supplyPeriod: { readonly periodStart: string; readonly periodEnd: string } };
};

function assertCommon(value: Record<string, unknown>): CommonInput {
  assertNoTrustedOutcome(value);
  if (value.schemaVersion !== 1) fail("CALCULATION_SCHEMA_UNSUPPORTED");
  const tenantId = requiredString(value.tenantId, "TENANT_INVALID");
  if (!/^tenant_[a-z0-9-]+$/.test(tenantId)) fail("TENANT_INVALID");
  const calculationDate = dateOnly(value.calculationDate, "CALCULATION_DATE_INVALID");
  const supplyPeriod = assertPeriod(value.supplyPeriod);
  const customerCategory = enumValue(value.customerCategory, ["RESIDENTIAL", "NON_RESIDENTIAL"], "CUSTOMER_CATEGORY_INVALID");
  const residency = value.residency === undefined ? undefined : enumValue(value.residency, ["RESIDENTIAL", "NON_RESIDENTIAL"], "RESIDENCY_INVALID");
  if (residency !== undefined && residency !== customerCategory) fail("RESIDENCY_MISMATCH");
  if (value.currency !== "EUR") fail("CURRENCY_INVALID");
  const taxTreatment = enumValue(value.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "TAX_TREATMENT_INVALID");
  let sourceBill: CommonInput["sourceBill"];
  const sourceBillValue = value.sourceBill;
  if (sourceBillValue !== undefined) { const item = recordValue(sourceBillValue, "SOURCE_BILL_INVALID"); sourceBill = { billId: requiredString(item.billId, "SOURCE_BILL_INVALID"), version: requiredString(item.version, "SOURCE_BILL_INVALID") }; }
  let baseline: CommonInput["baseline"];
  const baselineValue = value.baseline;
  if (baselineValue !== undefined) {
    const item = recordValue(baselineValue, "BASELINE_INVALID");
    const baselinePeriod = assertPeriod(item.supplyPeriod);
    baseline = { totalCommercialCost: finiteNonNegative(item.totalCommercialCost, "BASELINE_INVALID"), currency: item.currency === "EUR" ? "EUR" : fail("BASELINE_INVALID"), taxTreatment: enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "BASELINE_INVALID"), supplyPeriod: baselinePeriod };
    if (baseline.taxTreatment !== taxTreatment || baselinePeriod.periodStart !== supplyPeriod.periodStart || baselinePeriod.periodEnd !== supplyPeriod.periodEnd) fail("BASELINE_INCOMPATIBLE");
  }
  return { schemaVersion: 1, tenantId, calculationDate, supplyPeriod, customerCategory, ...(residency === undefined ? {} : { residency }), currency: "EUR", taxTreatment, ...(sourceBill ? { sourceBill } : {}), ...(baseline ? { baseline } : {}) };
}

function assertMonthlyMonths(profile: readonly { readonly month: string }[], expected: readonly string[]): void { if (profile.length !== expected.length || new Set(profile.map((item) => item.month)).size !== profile.length || profile.some((item, index) => item.month !== expected[index])) fail("MONTHLY_PROFILE_INVALID"); }

function parseEe(value: Record<string, unknown>, common: CommonInput): ElectricitySimulationRequest {
  if (value.vector !== "EE") fail("VECTOR_INVALID");
  const voltageLevel = enumValue(value.voltageLevel, ["LV", "MV", "HV", "EHV"], "VOLTAGE_INVALID") as VoltageLevel;
  const consumptionValue = value.consumption;
  const consumption = recordValue(consumptionValue, "CONSUMPTION_INVALID");
  const basis = enumValue(consumption.basis, ["PERIOD", "ANNUAL"], "CONSUMPTION_BASIS_INVALID");
  if (consumption.unit !== "KWH") fail("UNIT_MISMATCH");
  const f1 = finiteNonNegative(consumption.f1, "CONSUMPTION_INVALID");
  const f2 = finiteNonNegative(consumption.f2, "CONSUMPTION_INVALID");
  const f3 = finiteNonNegative(consumption.f3, "CONSUMPTION_INVALID");
  const expectedMonths = monthsForPeriod(common.supplyPeriod.periodStart, common.supplyPeriod.periodEnd);
  if (basis === "ANNUAL" && expectedMonths.length !== 12) fail("ANNUAL_PERIOD_INVALID");
  let monthlyProfile: readonly ElectricityMonthlyProfile[] | undefined;
  const monthlyValue = consumption.monthlyProfile;
  if (monthlyValue !== undefined) {
    const monthlyArray = Array.isArray(monthlyValue) ? monthlyValue : fail("MONTHLY_PROFILE_INVALID");
    const parsed: ElectricityMonthlyProfile[] = monthlyArray.map((candidate: unknown) => { const item = recordValue(candidate, "MONTHLY_PROFILE_INVALID"); return { month: month(item.month), f1: finiteNonNegative(item.f1, "MONTHLY_PROFILE_INVALID"), f2: finiteNonNegative(item.f2, "MONTHLY_PROFILE_INVALID"), f3: finiteNonNegative(item.f3, "MONTHLY_PROFILE_INVALID") }; });
    assertMonthlyMonths(parsed, expectedMonths);
    if (!equals(parsed.reduce((total, item) => add(total, fromNumber(item.f1)), zero()), fromNumber(f1)) || !equals(parsed.reduce((total, item) => add(total, fromNumber(item.f2)), zero()), fromNumber(f2)) || !equals(parsed.reduce((total, item) => add(total, fromNumber(item.f3)), zero()), fromNumber(f3))) fail("PROFILE_TOTAL_MISMATCH");
    monthlyProfile = parsed;
  }
  return { ...common, vector: "EE", voltageLevel, consumption: { basis, unit: "KWH", f1, f2, f3, ...(monthlyProfile ? { monthlyProfile } : {}) } };
}

function parseGas(value: Record<string, unknown>, common: CommonInput): GasSimulationRequest {
  if (value.vector !== "GAS") fail("VECTOR_INVALID");
  const consumptionValue = value.consumption;
  const consumption = recordValue(consumptionValue, "CONSUMPTION_INVALID");
  const basis = enumValue(consumption.basis, ["PERIOD", "ANNUAL"], "CONSUMPTION_BASIS_INVALID");
  if (consumption.unit !== "SMC") fail("UNIT_MISMATCH");
  const smc = finiteNonNegative(consumption.smc, "CONSUMPTION_INVALID");
  const expectedMonths = monthsForPeriod(common.supplyPeriod.periodStart, common.supplyPeriod.periodEnd);
  if (basis === "ANNUAL" && expectedMonths.length !== 12) fail("ANNUAL_PERIOD_INVALID");
  let monthlyProfile: readonly GasMonthlyProfile[] | undefined;
  const monthlyValue = consumption.monthlyProfile;
  if (monthlyValue !== undefined) {
    const monthlyArray = Array.isArray(monthlyValue) ? monthlyValue : fail("MONTHLY_PROFILE_INVALID");
    const parsed: GasMonthlyProfile[] = monthlyArray.map((candidate: unknown) => { const item = recordValue(candidate, "MONTHLY_PROFILE_INVALID"); return { month: month(item.month), smc: finiteNonNegative(item.smc, "MONTHLY_PROFILE_INVALID") }; });
    assertMonthlyMonths(parsed, expectedMonths);
    if (!equals(parsed.reduce((total, item) => add(total, fromNumber(item.smc)), zero()), fromNumber(smc))) fail("PROFILE_TOTAL_MISMATCH");
    monthlyProfile = parsed;
  }
  const coefficientValue = consumption.correctionCoefficient;
  const coefficientItem = recordValue(coefficientValue, "CORRECTION_COEFFICIENT_INVALID");
  const required = typeof coefficientItem.required === "boolean" ? coefficientItem.required : fail("CORRECTION_COEFFICIENT_INVALID");
  const coefficient = coefficientItem.value === undefined ? undefined : finiteNonNegative(coefficientItem.value, "CORRECTION_COEFFICIENT_INVALID");
  if (required && (coefficient === undefined || coefficient <= 0)) fail("CORRECTION_COEFFICIENT_REQUIRED");
  if (!required && coefficient !== undefined) fail("CORRECTION_COEFFICIENT_INVALID");
  return { ...common, vector: "GAS", consumption: { basis, unit: "SMC", smc, ...(monthlyProfile ? { monthlyProfile } : {}), correctionCoefficient: { required, ...(coefficient === undefined ? {} : { value: coefficient }) } } };
}

export function parseSimulationRequest(value: unknown, tenantId: string): SimulationRequest {
  const input = recordValue(value, "CALCULATION_INPUT_INVALID");
  const common = assertCommon(input);
  if (common.tenantId !== tenantId) fail("TENANT_MISMATCH");
  if (input.vector === "EE") return parseEe(input, common);
  if (input.vector === "GAS") return parseGas(input, common);
  return fail("VECTOR_INVALID");
}

export function monthsInSimulationPeriod(period: { readonly periodStart: string; readonly periodEnd: string }): readonly string[] { return monthsForPeriod(period.periodStart, period.periodEnd); }
