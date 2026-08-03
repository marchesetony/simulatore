import { createHash } from "node:crypto";
import type { CalculationComponent, CalculationExclusion, CalculationResult, SimulationRequest } from "../calculation/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { parseSimulationRequest } from "../calculation/input.ts";
import type { ComparisonRankingEntry, ComparisonResult } from "../comparison/types";

export class ProposalValidationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "ProposalValidationError"; this.code = code; }
}

export const proposalFail = (code: string): never => { throw new ProposalValidationError(code); };

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
export function text(value: unknown, code: string, maxLength = 256): string { if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) return proposalFail(code); return value.trim(); }
export function normalizedNote(value: unknown): string { if (typeof value !== "string" || value.length > 2000) return proposalFail("PROPOSAL_NOTES_INVALID"); return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }
export function dateOnly(value: unknown, code: string): string { const date = text(value, code, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return proposalFail(code); const parsed = Date.parse(`${date}T00:00:00.000Z`); if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) return proposalFail(code); return date; }
export function assertPeriod(value: unknown, code: string): { readonly periodStart: string; readonly periodEnd: string } { if (typeof value !== "object" || value === null || Array.isArray(value)) return proposalFail(code); const item = value as Record<string, unknown>; const periodStart = dateOnly(item.periodStart, code); const periodEnd = dateOnly(item.periodEnd, code); if (periodStart >= periodEnd) return proposalFail(code); return { periodStart, periodEnd }; }
export function assertInputSize(value: unknown): void { if (Buffer.byteLength(canonical(value), "utf8") > 262144) proposalFail("PROPOSAL_INPUT_TOO_LARGE"); }

function calculationPayload(result: CalculationResult): unknown {
  return { schemaVersion: result.schemaVersion, engineVersion: result.engineVersion, normalizedInput: result.normalizedInput, sourceCte: result.sourceCte, marketData: result.marketData, components: result.components, totalCommercialCost: result.totalCommercialCost, unitCost: result.unitCost, roundingPolicy: result.roundingPolicy };
}

export function assertMoney(value: unknown, code: string): asserts value is { readonly amount: number; readonly minorUnits: number; readonly currency: "EUR" } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) proposalFail(code);
  const item = value as Record<string, unknown>;
  if (typeof item.amount !== "number" || !Number.isFinite(item.amount) || typeof item.minorUnits !== "number" || !Number.isSafeInteger(item.minorUnits) || item.currency !== "EUR" || item.amount !== item.minorUnits / 100) proposalFail(code);
}

export function assertComponent(value: unknown): asserts value is CalculationComponent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) proposalFail("PROPOSAL_COMPONENT_INVALID");
  const item = value as Record<string, unknown>;
  text(item.componentId, "PROPOSAL_COMPONENT_INVALID");
  text(item.label, "PROPOSAL_COMPONENT_INVALID", 512);
  text(item.formulaId, "PROPOSAL_COMPONENT_INVALID");
  if (!["ENERGY", "FIXED_FEE", "VARIABLE_FEE", "IMBALANCE", "ONE_OFF_FEE", "DISCOUNT"].includes(String(item.category)) || !["CHARGE", "DISCOUNT"].includes(String(item.sign))) proposalFail("PROPOSAL_COMPONENT_INVALID");
  if (item.category === "DISCOUNT" && item.sign !== "DISCOUNT") proposalFail("PROPOSAL_COMPONENT_INVALID");
  if (item.category !== "DISCOUNT" && item.sign !== "CHARGE") proposalFail("PROPOSAL_COMPONENT_INVALID");
  assertMoney(item.amount, "PROPOSAL_COMPONENT_INVALID");
  if (typeof item.formulaInputs !== "object" || item.formulaInputs === null || Array.isArray(item.formulaInputs)) proposalFail("PROPOSAL_COMPONENT_INVALID");
}

const EXCLUSION_CODES = ["TENANT_MISMATCH", "VECTOR_MISMATCH", "CTE_NOT_APPROVED", "CTE_EXPIRED", "CTE_VALIDITY_MISMATCH", "CUSTOMER_NOT_ELIGIBLE", "VOLTAGE_NOT_ELIGIBLE", "TAX_TREATMENT_INCOMPATIBLE", "CURRENCY_INCOMPATIBLE", "CALCULATION_READY_INVALID", "CALCULATION_INPUT_INVALID", "MONTHLY_PROFILE_REQUIRED", "MARKET_DATA_MISSING", "MARKET_DATA_INVALID", "CORRECTION_COEFFICIENT_REQUIRED", "FEE_UNIT_MISMATCH", "IMBALANCE_UNAVAILABLE", "ONE_OFF_FEE_UNIT_INVALID", "COMPARISON_INCOMPATIBLE"] as const;

export function assertExclusion(value: unknown, vector?: "EE" | "GAS"): asserts value is CalculationExclusion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) proposalFail("COMPARISON_EXCLUSION_INVALID");
  const item = value as Record<string, unknown>;
  text(item.archiveId, "COMPARISON_EXCLUSION_INVALID", 128);
  text(item.cteId, "COMPARISON_EXCLUSION_INVALID", 128);
  text(item.supplier, "COMPARISON_EXCLUSION_INVALID", 256);
  text(item.offerCode, "COMPARISON_EXCLUSION_INVALID", 128);
  if ((item.vector !== "EE" && item.vector !== "GAS") || (vector !== undefined && item.vector !== vector) || (item.cteVersion !== null && typeof item.cteVersion !== "string") || !EXCLUSION_CODES.includes(item.code as typeof EXCLUSION_CODES[number])) proposalFail("COMPARISON_EXCLUSION_INVALID");
  text(item.code, "COMPARISON_EXCLUSION_INVALID", 64);
  text(item.message, "COMPARISON_EXCLUSION_INVALID", 512);
}

function assertCalculationShape(result: CalculationResult, tenantId: string): SimulationRequest {
  if (result.schemaVersion !== 1 || result.engineVersion !== "1" || result.tenantId !== tenantId || (result.vector !== "EE" && result.vector !== "GAS") || result.currency !== "EUR") proposalFail("CALCULATION_RESULT_INVALID");
  const normalized = parseSimulationRequest(result.normalizedInput, tenantId);
  if (canonical(normalized) !== canonical(result.normalizedInput)) proposalFail("CALCULATION_RESULT_NOT_NORMALIZED");
  if (normalized.vector !== result.vector || normalized.calculationDate !== result.calculationDate || canonical(normalized.supplyPeriod) !== canonical(result.supplyPeriod) || normalized.customerCategory !== result.customerCategory || normalized.taxTreatment !== result.taxTreatment) proposalFail("CALCULATION_RESULT_MISMATCH");
  if (result.vector === "EE" && (normalized.vector !== "EE" || result.voltageLevel !== normalized.voltageLevel)) proposalFail("CALCULATION_RESULT_MISMATCH");
  if (result.vector === "GAS" && result.voltageLevel !== undefined) proposalFail("CALCULATION_RESULT_MISMATCH");
  dateOnly(result.calculationDate, "CALCULATION_RESULT_INVALID");
  if (result.calculatedAt !== `${result.calculationDate}T00:00:00.000Z`) proposalFail("CALCULATION_RESULT_INVALID");
  text(result.calculationId, "CALCULATION_RESULT_INVALID", 128);
  text(result.fingerprint, "CALCULATION_RESULT_INVALID", 128);
  if (result.calculationId !== `calc_${result.fingerprint.slice(0, 32)}` || fingerprint(calculationPayload(result)) !== result.fingerprint) proposalFail("CALCULATION_FINGERPRINT_MISMATCH");
  if (typeof result.sourceCte !== "object" || result.sourceCte === null || Array.isArray(result.sourceCte)) proposalFail("CALCULATION_CTE_REFERENCE_INVALID");
  text(result.sourceCte.archiveId, "CALCULATION_CTE_REFERENCE_INVALID"); text(result.sourceCte.cteId, "CALCULATION_CTE_REFERENCE_INVALID"); text(result.sourceCte.versionId, "CALCULATION_CTE_REFERENCE_INVALID"); text(result.sourceCte.version, "CALCULATION_CTE_REFERENCE_INVALID"); text(result.sourceCte.supplier, "CALCULATION_CTE_REFERENCE_INVALID"); text(result.sourceCte.offerCode, "CALCULATION_CTE_REFERENCE_INVALID");
  if (!Array.isArray(result.marketData)) proposalFail("CALCULATION_MARKET_REFERENCE_INVALID");
  result.marketData.forEach((market) => { if (market.vector !== result.vector || (market.vector === "EE" ? market.index !== "PUN" : market.index !== "PSV")) proposalFail("CALCULATION_MARKET_REFERENCE_INVALID"); text(market.recordId, "CALCULATION_MARKET_REFERENCE_INVALID"); text(market.version, "CALCULATION_MARKET_REFERENCE_INVALID"); dateOnly(market.effectiveFrom, "CALCULATION_MARKET_REFERENCE_INVALID"); if (market.effectiveTo !== null) dateOnly(market.effectiveTo, "CALCULATION_MARKET_REFERENCE_INVALID"); });
  if (!Array.isArray(result.components) || result.components.length === 0) proposalFail("CALCULATION_COMPONENTS_INVALID");
  result.components.forEach(assertComponent);
  assertMoney(result.totalCommercialCost, "CALCULATION_TOTAL_INVALID");
  if (result.components.reduce((sum, component) => sum + BigInt(component.sign === "DISCOUNT" ? -component.amount.minorUnits : component.amount.minorUnits), BigInt(0)) !== BigInt(result.totalCommercialCost.minorUnits)) proposalFail("CALCULATION_TOTAL_MISMATCH");
  if (result.unitCost.currency !== "EUR" || !["EUR_PER_KWH", "EUR_PER_SMC"].includes(result.unitCost.unit) || !Number.isFinite(result.unitCost.amount)) proposalFail("CALCULATION_UNIT_COST_INVALID");
  if (result.unitCost.unit !== (result.vector === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC")) proposalFail("CALCULATION_UNIT_COST_INVALID");
  if (result.savingsVsBaseline !== null) assertMoney(result.savingsVsBaseline, "CALCULATION_SAVINGS_INVALID");
  if ((result.savingsVsBaseline !== null) !== (normalized.baseline !== undefined)) proposalFail("CALCULATION_SAVINGS_INVALID");
  if (result.savingsVsBaseline !== null && normalized.baseline !== undefined && result.savingsVsBaseline.minorUnits !== Math.round(normalized.baseline.totalCommercialCost * 100) - result.totalCommercialCost.minorUnits) proposalFail("CALCULATION_SAVINGS_INVALID");
  const expectedWarnings = normalized.sourceBill ? ["SOURCE_BILL_REFERENCE_RECORDED"] : [];
  if (!Array.isArray(result.warnings) || canonical(result.warnings) !== canonical(expectedWarnings)) proposalFail("CALCULATION_WARNINGS_MISMATCH");
  return normalized;
}

export function assertCalculationResult(value: unknown, tenantId: string): CalculationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return proposalFail("CALCULATION_RESULT_INVALID");
  const result = value as CalculationResult;
  assertCalculationShape(result, tenantId);
  return result;
}

function compareText(left: string, right: string): number { return left === right ? 0 : left < right ? -1 : 1; }
function compareInteger(left: number, right: number): number { return left === right ? 0 : left < right ? -1 : 1; }
function resultOrder(left: CalculationResult, right: CalculationResult): number { return compareInteger(left.totalCommercialCost.minorUnits, right.totalCommercialCost.minorUnits) || compareText(left.sourceCte.supplier, right.sourceCte.supplier) || compareText(left.sourceCte.offerCode, right.sourceCte.offerCode) || compareText(left.sourceCte.version, right.sourceCte.version) || compareText(left.sourceCte.archiveId, right.sourceCte.archiveId); }

export function assertComparisonResult(value: unknown, tenantId: string): ComparisonResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return proposalFail("COMPARISON_RESULT_INVALID");
  const result = value as ComparisonResult;
  if (result.schemaVersion !== 1 || result.tenantId !== tenantId || (result.vector !== "EE" && result.vector !== "GAS") || !Array.isArray(result.results) || !Array.isArray(result.ranking) || !Array.isArray(result.excludedOffers)) proposalFail("COMPARISON_RESULT_INVALID");
  text(result.comparisonId, "COMPARISON_RESULT_INVALID", 128);
  text(result.fingerprint, "COMPARISON_RESULT_INVALID", 128);
  const normalized = parseSimulationRequest(result.normalizedInput, tenantId);
  if (result.calculatedAt !== `${normalized.calculationDate}T00:00:00.000Z`) proposalFail("COMPARISON_RESULT_INVALID");
  if (canonical(normalized) !== canonical(result.normalizedInput) || normalized.vector !== result.vector) proposalFail("COMPARISON_RESULT_MISMATCH");
  result.results.forEach((candidate) => { assertCalculationResult(candidate, tenantId); if (candidate.vector !== result.vector || canonical(candidate.normalizedInput) !== canonical(result.normalizedInput)) proposalFail("COMPARISON_RESULT_MISMATCH"); });
  result.excludedOffers.forEach((exclusion) => assertExclusion(exclusion));
  const payload = { schemaVersion: result.schemaVersion, tenantId: result.tenantId, vector: result.vector, normalizedInput: result.normalizedInput, results: result.results, excludedOffers: result.excludedOffers, ranking: result.ranking };
  if (result.comparisonId !== `comparison_${result.fingerprint.slice(0, 32)}` || fingerprint(payload) !== result.fingerprint) proposalFail("COMPARISON_FINGERPRINT_MISMATCH");
  const ordered = [...result.results].sort(resultOrder);
  const expected: ComparisonRankingEntry[] = [];
  let previous: number | null = null; let group = 0;
  ordered.forEach((candidate, index) => { if (previous === null || previous !== candidate.totalCommercialCost.minorUnits) group += 1; previous = candidate.totalCommercialCost.minorUnits; expected.push({ rank: index > 0 && ordered[index - 1].totalCommercialCost.minorUnits === candidate.totalCommercialCost.minorUnits ? expected[index - 1].rank : index + 1, tieGroup: `tie-${group}`, calculationId: candidate.calculationId, supplier: candidate.sourceCte.supplier, offerCode: candidate.sourceCte.offerCode, cteVersion: candidate.sourceCte.version, totalCommercialCost: candidate.totalCommercialCost }); });
  if (canonical(expected) !== canonical(result.ranking)) proposalFail("COMPARISON_RANKING_INVALID");
  const expectedWarnings = ordered.length === 0 ? ["NO_ELIGIBLE_OFFERS"] : result.excludedOffers.length > 0 ? ["EXCLUDED_OFFERS_PRESENT"] : [];
  if (canonical(result.warnings) !== canonical(expectedWarnings)) proposalFail("COMPARISON_WARNINGS_MISMATCH");
  return result;
}

export function calculationPayloadForFingerprint(result: CalculationResult): unknown { return calculationPayload(result); }
