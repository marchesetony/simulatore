import { createHash } from "node:crypto";
import type { CalculationComponent, CalculationCostScope, CalculationExclusion, CalculationResult, ContractualPassThroughState, ContractualPassThroughStatus, RegulatedComponentIncluded, SimulationRequest } from "../calculation/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { DOMESTIC_NET_OF_TAX_COMPLETE_COMPONENTS } from "../calculation/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { EE_FISCAL_EXCLUSION_NOTICE } from "../calculation/economic-scope.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { parseSimulationRequest } from "../calculation/input.ts";
import type { ComparisonCostBasis, ComparisonRankingEntry, ComparisonResult } from "../comparison/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { comparisonCompletenessKey } from "../comparison/service.ts";

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
function record(value: unknown, code: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) return proposalFail(code); return value as Record<string, unknown>; }
function enumValue<T extends string>(value: unknown, values: readonly T[], code: string): T { if (typeof value !== "string" || !values.includes(value as T)) return proposalFail(code); return value as T; }

function calculationPayload(result: CalculationResult): unknown {
  return { schemaVersion: result.schemaVersion, engineVersion: result.engineVersion, normalizedInput: result.normalizedInput, sourceCte: result.sourceCte, marketData: result.marketData, components: result.components, totalCommercialCost: result.totalCommercialCost, totalRegulatedSubsetCost: result.totalRegulatedSubsetCost, totalCommercialPlusRegulatedSubsetCost: result.totalCommercialPlusRegulatedSubsetCost, costScope: result.costScope, regulatedComponentsIncluded: result.regulatedComponentsIncluded, regulatoryData: result.regulatoryData, unitCost: result.unitCost, roundingPolicy: result.roundingPolicy, ...(result.contractualPassThroughCompleteness !== undefined ? { contractualPassThroughCompleteness: result.contractualPassThroughCompleteness, contractualPassThroughStates: result.contractualPassThroughStates, bta6NetOfTaxCompleteCandidate: result.bta6NetOfTaxCompleteCandidate } : {}) };
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
  if (!["ENERGY", "FIXED_FEE", "VARIABLE_FEE", "IMBALANCE", "ONE_OFF_FEE", "DISCOUNT", "REGULATED_ENERGY", "REGULATED_POWER", "REGULATED_FIXED"].includes(String(item.category)) || !["CHARGE", "DISCOUNT"].includes(String(item.sign))) proposalFail("PROPOSAL_COMPONENT_INVALID");
  if (item.category === "DISCOUNT" && item.sign !== "DISCOUNT") proposalFail("PROPOSAL_COMPONENT_INVALID");
  if (item.category !== "DISCOUNT" && item.sign !== "CHARGE") proposalFail("PROPOSAL_COMPONENT_INVALID");
  assertMoney(item.amount, "PROPOSAL_COMPONENT_INVALID");
  if (typeof item.formulaInputs !== "object" || item.formulaInputs === null || Array.isArray(item.formulaInputs)) proposalFail("PROPOSAL_COMPONENT_INVALID");
}

const REGULATED_COMPONENTS: readonly RegulatedComponentIncluded[] = ["UC3_ENERGY", "UC6_ENERGY", "UC6_POWER", "UC6_FIXED", "NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "METERING_FIXED", "TRANSMISSION_ENERGY", "ARIM_FIXED", "ARIM_POWER", "ARIM_ENERGY", "ASOS_FIXED", "ASOS_POWER", "ASOS_ENERGY", "DISPATCHING_TOTAL_ENERGY"];
function canonicalComponentSet(values: readonly RegulatedComponentIncluded[]): readonly RegulatedComponentIncluded[] { return [...new Set(values)].sort() as RegulatedComponentIncluded[]; }
const BTA6_COMPLETE_COMPONENTS: readonly RegulatedComponentIncluded[] = ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "METERING_FIXED", "TRANSMISSION_ENERGY", "UC3_ENERGY", "UC6_ENERGY", "UC6_FIXED", "ARIM_FIXED", "ARIM_POWER", "ARIM_ENERGY", "ASOS_FIXED", "ASOS_POWER", "ASOS_ENERGY"];
const CONTRACTUAL_KINDS = ["DISPATCHING", "CAPACITY_MARKET", "OTHER_CONTRACTUAL_PASS_THROUGH"] as const;
const CONTRACTUAL_STATES = ["RESOLVED_EXPLICIT", "RESOLVED_INCLUDED", "RESOLVED_NOT_APPLICABLE", "UNRESOLVED_NOT_DECLARED", "UNRESOLVED_EXTERNAL"] as const;
const RESOLVED_STATES = new Set<ContractualPassThroughState>(["RESOLVED_EXPLICIT", "RESOLVED_INCLUDED", "RESOLVED_NOT_APPLICABLE"]);
function contractualStateResolved(state: ContractualPassThroughState): boolean { return RESOLVED_STATES.has(state); }
function assertContractualStates(value: unknown, period: { readonly periodStart: string; readonly periodEnd: string }, code: string): asserts value is readonly ContractualPassThroughStatus[] {
  if (!Array.isArray(value) || value.length === 0) proposalFail(code);
  const states = value as readonly unknown[];
  const typed = states.map((item) => {
    const entry = record(item, code);
    const kind = enumValue(entry.kind, CONTRACTUAL_KINDS, code);
    const state = enumValue(entry.state, CONTRACTUAL_STATES, code);
    const effectiveFrom = dateOnly(entry.effectiveFrom, code);
    const effectiveTo = dateOnly(entry.effectiveTo, code);
    if (effectiveFrom >= effectiveTo || effectiveFrom < period.periodStart || effectiveTo > period.periodEnd) proposalFail(code);
    return { kind, state, effectiveFrom, effectiveTo } satisfies ContractualPassThroughStatus;
  });
  const previousByKind = new Map<string, ContractualPassThroughStatus>();
  for (const status of [...typed].sort((left, right) => left.kind.localeCompare(right.kind) || left.effectiveFrom.localeCompare(right.effectiveFrom) || left.effectiveTo.localeCompare(right.effectiveTo))) {
    const previous = previousByKind.get(status.kind);
    if (previous && previous.effectiveTo > status.effectiveFrom) proposalFail(code);
    previousByKind.set(status.kind, status);
  }
  if (!(typed.some((status) => status.kind === "DISPATCHING") && typed.some((status) => status.kind === "CAPACITY_MARKET"))) proposalFail(code);
}
export function assertContractualSummary(value: unknown, period: { readonly periodStart: string; readonly periodEnd: string }, costScope: CalculationCostScope, vector: "EE" | "GAS", customerCategory: SimulationRequest["customerCategory"], code: string): void {
  if (value === undefined) {
    if (costScope === "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE" && !(vector === "EE" && customerCategory === "RESIDENTIAL")) proposalFail(code);
    return;
  }
  const summary = record(value, code);
  if (vector !== "EE" || customerCategory !== "NON_RESIDENTIAL") proposalFail(code);
  const completeness = enumValue(summary.completeness, ["COMPLETE", "PARTIAL"], code);
  assertContractualStates(summary.states, period, code);
  if (typeof summary.bta6NetOfTaxComplete !== "boolean") proposalFail(code);
  const states = summary.states as readonly ContractualPassThroughStatus[];
  const requiredKinds = ["DISPATCHING", "CAPACITY_MARKET"] as const;
  const fullyResolved = requiredKinds.every((kind) => {
    const segments = states.filter((status) => status.kind === kind).sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
    let cursor = period.periodStart;
    for (const segment of segments) {
      if (segment.effectiveFrom !== cursor || !contractualStateResolved(segment.state)) return false;
      cursor = segment.effectiveTo;
    }
    return cursor === period.periodEnd;
  });
  if (completeness === "COMPLETE" && !fullyResolved) proposalFail(code);
  if (summary.bta6NetOfTaxComplete && (vector !== "EE" || customerCategory !== "NON_RESIDENTIAL" || costScope !== "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE" || completeness !== "COMPLETE" || !fullyResolved)) proposalFail(code);
  if (costScope === "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE" && vector === "EE" && customerCategory === "NON_RESIDENTIAL" && summary.bta6NetOfTaxComplete !== true) proposalFail(code);
}
export function assertRegulatedComponentSet(value: unknown, code: string): asserts value is readonly RegulatedComponentIncluded[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !REGULATED_COMPONENTS.includes(item as RegulatedComponentIncluded))) proposalFail(code);
  const items = value as readonly RegulatedComponentIncluded[];
  if (new Set(items).size !== items.length) proposalFail(code);
}
function calculationComparisonSelection(result: CalculationResult): { readonly comparisonCost: CalculationResult["totalCommercialCost"]; readonly comparisonCostBasis: ComparisonCostBasis; readonly regulatedComponentsIncluded: readonly RegulatedComponentIncluded[] } | null {
  if (result.costScope === "COMMERCIAL_ONLY" && result.totalCommercialPlusRegulatedSubsetCost === null) return { comparisonCost: result.totalCommercialCost, comparisonCostBasis: "COMMERCIAL_ONLY", regulatedComponentsIncluded: [] };
  if (result.costScope === "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE" && result.totalCommercialPlusRegulatedSubsetCost !== null) return { comparisonCost: result.totalCommercialPlusRegulatedSubsetCost, comparisonCostBasis: "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE", regulatedComponentsIncluded: canonicalComponentSet(result.regulatedComponentsIncluded) };
  if (result.costScope === "COMMERCIAL_PLUS_REGULATED_PARTIAL" && result.totalCommercialPlusRegulatedSubsetCost !== null) return { comparisonCost: result.totalCommercialPlusRegulatedSubsetCost, comparisonCostBasis: "COMMERCIAL_PLUS_REGULATED_PARTIAL", regulatedComponentsIncluded: canonicalComponentSet(result.regulatedComponentsIncluded) };
  return null;
}
function comparableMinor(result: CalculationResult): number { return (calculationComparisonSelection(result) ?? proposalFail("CALCULATION_COST_SCOPE_INVALID")).comparisonCost.minorUnits; }
function baselineScope(result: CalculationResult): ComparisonCostBasis { return result.normalizedInput.baseline?.costScope ?? "COMMERCIAL_ONLY"; }
function baselineComparableMinor(result: CalculationResult): number { const baseline = result.normalizedInput.baseline ?? proposalFail("CALCULATION_SAVINGS_INVALID"); return Math.round((baselineScope(result) === "COMMERCIAL_ONLY" ? baseline.totalCommercialCost : baseline.comparisonCost ?? proposalFail("CALCULATION_SAVINGS_INVALID")) * 100); }

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
  if (result.vector === "EE" && result.taxTreatment !== "EXCLUDED") proposalFail("CALCULATION_RESULT_TAX_POLICY_INVALID");
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
  if (!["COMMERCIAL_ONLY", "COMMERCIAL_PLUS_REGULATED_PARTIAL", "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE"].includes(result.costScope)) proposalFail("CALCULATION_COST_SCOPE_INVALID");
  assertRegulatedComponentSet(result.regulatedComponentsIncluded, "CALCULATION_REGULATED_COMPONENTS_INVALID");
  if (result.costScope === "COMMERCIAL_ONLY" && (result.totalRegulatedSubsetCost !== null || result.totalCommercialPlusRegulatedSubsetCost !== null || result.regulatedComponentsIncluded.length !== 0)) proposalFail("CALCULATION_COST_SCOPE_INVALID");
  if (result.costScope === "COMMERCIAL_PLUS_REGULATED_PARTIAL" && (result.totalRegulatedSubsetCost === null || result.totalCommercialPlusRegulatedSubsetCost === null)) proposalFail("CALCULATION_COST_SCOPE_INVALID");
  const contractualFieldsPresent = result.contractualPassThroughCompleteness !== undefined || result.contractualPassThroughStates !== undefined || result.bta6NetOfTaxCompleteCandidate !== undefined;
  if (contractualFieldsPresent && (result.vector !== "EE" || result.normalizedInput.customerCategory !== "NON_RESIDENTIAL" || result.contractualPassThroughCompleteness === undefined || result.contractualPassThroughStates === undefined || result.bta6NetOfTaxCompleteCandidate === undefined)) proposalFail("CALCULATION_CONTRACTUAL_METADATA_INVALID");
  assertContractualSummary(contractualFieldsPresent ? { completeness: result.contractualPassThroughCompleteness, states: result.contractualPassThroughStates, bta6NetOfTaxComplete: result.bta6NetOfTaxCompleteCandidate } : undefined, result.supplyPeriod, result.costScope, result.vector, result.normalizedInput.customerCategory, "CALCULATION_CONTRACTUAL_METADATA_INVALID");
  const domesticComplete = result.vector === "EE" && result.normalizedInput.customerCategory === "RESIDENTIAL" && result.normalizedInput.residency === "RESIDENT" && canonicalComponentSet(result.regulatedComponentsIncluded).join("|") === canonicalComponentSet(DOMESTIC_NET_OF_TAX_COMPLETE_COMPONENTS).join("|");
  const bta6Complete = result.vector === "EE" && result.normalizedInput.customerCategory === "NON_RESIDENTIAL" && result.taxTreatment === "EXCLUDED" && result.bta6NetOfTaxCompleteCandidate === true && result.contractualPassThroughCompleteness === "COMPLETE" && result.totalRegulatedSubsetCost !== null && result.totalCommercialPlusRegulatedSubsetCost !== null && canonicalComponentSet(result.regulatedComponentsIncluded).join("|") === canonicalComponentSet(BTA6_COMPLETE_COMPONENTS).join("|");
  if (result.costScope === "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE" && (!domesticComplete && !bta6Complete || result.totalRegulatedSubsetCost === null || result.totalCommercialPlusRegulatedSubsetCost === null)) proposalFail("CALCULATION_COST_SCOPE_INVALID");
  if (result.bta6NetOfTaxCompleteCandidate === true && !bta6Complete) proposalFail("CALCULATION_CONTRACTUAL_METADATA_INVALID");
  if (result.totalRegulatedSubsetCost !== null) assertMoney(result.totalRegulatedSubsetCost, "CALCULATION_REGULATED_TOTAL_INVALID");
  if (result.totalCommercialPlusRegulatedSubsetCost !== null) assertMoney(result.totalCommercialPlusRegulatedSubsetCost, "CALCULATION_TOTAL_INVALID");
  const commercialTotal = result.components.filter((component) => !component.category.startsWith("REGULATED_")).reduce((sum, component) => sum + BigInt(component.sign === "DISCOUNT" ? -component.amount.minorUnits : component.amount.minorUnits), BigInt(0));
  const completeTotal = result.components.reduce((sum, component) => sum + BigInt(component.sign === "DISCOUNT" ? -component.amount.minorUnits : component.amount.minorUnits), BigInt(0));
  if (commercialTotal !== BigInt(result.totalCommercialCost.minorUnits) || (result.totalCommercialPlusRegulatedSubsetCost !== null && completeTotal !== BigInt(result.totalCommercialPlusRegulatedSubsetCost.minorUnits)) || (result.totalCommercialPlusRegulatedSubsetCost === null && completeTotal !== BigInt(result.totalCommercialCost.minorUnits))) proposalFail("CALCULATION_TOTAL_MISMATCH");
  if (result.unitCost.currency !== "EUR" || !["EUR_PER_KWH", "EUR_PER_SMC"].includes(result.unitCost.unit) || !Number.isFinite(result.unitCost.amount)) proposalFail("CALCULATION_UNIT_COST_INVALID");
  if (result.unitCost.unit !== (result.vector === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC")) proposalFail("CALCULATION_UNIT_COST_INVALID");
  if (result.savingsVsBaseline !== null) assertMoney(result.savingsVsBaseline, "CALCULATION_SAVINGS_INVALID");
  if (normalized.baseline === undefined && result.savingsVsBaseline !== null) proposalFail("CALCULATION_SAVINGS_INVALID");
  if (normalized.baseline !== undefined) {
    const sameScope = baselineScope(result) === result.costScope;
    if (sameScope && (result.savingsVsBaseline === null || result.savingsVsBaseline.minorUnits !== baselineComparableMinor(result) - comparableMinor(result))) proposalFail("CALCULATION_SAVINGS_INVALID");
    if (!sameScope && result.savingsVsBaseline !== null) proposalFail("CALCULATION_SAVINGS_INVALID");
  }
  const expectedWarnings = [...(normalized.sourceBill ? ["SOURCE_BILL_REFERENCE_RECORDED"] : []), ...(result.costScope === "COMMERCIAL_PLUS_REGULATED_PARTIAL" ? result.warnings.filter((warning) => warning.startsWith("REGULATED_SUBSET_PARTIAL_") || warning === "BTA6_ASOS_EXCLUDED_CLASS_UNKNOWN") : []), ...(normalized.baseline !== undefined && baselineScope(result) !== result.costScope ? ["BASELINE_COST_SCOPE_MISMATCH"] : [])];
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
export function assertComparisonResult(value: unknown, tenantId: string): ComparisonResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return proposalFail("COMPARISON_RESULT_INVALID");
  const result = value as ComparisonResult;
  if (result.schemaVersion !== 1 || result.tenantId !== tenantId || (result.vector !== "EE" && result.vector !== "GAS") || !Array.isArray(result.results) || !Array.isArray(result.ranking) || !Array.isArray(result.excludedOffers)) proposalFail("COMPARISON_RESULT_INVALID");
  text(result.comparisonId, "COMPARISON_RESULT_INVALID", 128);
  text(result.fingerprint, "COMPARISON_RESULT_INVALID", 128);
  const normalized = parseSimulationRequest(result.normalizedInput, tenantId);
  if (result.calculatedAt !== `${normalized.calculationDate}T00:00:00.000Z`) proposalFail("COMPARISON_RESULT_INVALID");
  if (canonical(normalized) !== canonical(result.normalizedInput) || normalized.vector !== result.vector || result.taxTreatment !== normalized.taxTreatment) proposalFail("COMPARISON_RESULT_MISMATCH");
  if (result.vector === "EE" && result.taxTreatment !== "EXCLUDED") proposalFail("COMPARISON_TAX_POLICY_INVALID");
  if (result.fiscalExclusionNotice !== (result.taxTreatment === "EXCLUDED" ? EE_FISCAL_EXCLUSION_NOTICE : null)) proposalFail("COMPARISON_FISCAL_NOTICE_INVALID");
  if (result.comparisonCostBasis !== null && !["COMMERCIAL_ONLY", "COMMERCIAL_PLUS_REGULATED_PARTIAL", "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE"].includes(result.comparisonCostBasis)) proposalFail("COMPARISON_COST_BASIS_INVALID");
  assertRegulatedComponentSet(result.regulatedComponentsIncluded, "COMPARISON_REGULATED_COMPONENTS_INVALID");
  result.results.forEach((candidate) => { assertCalculationResult(candidate, tenantId); if (candidate.vector !== result.vector || canonical(candidate.normalizedInput) !== canonical(result.normalizedInput)) proposalFail("COMPARISON_RESULT_MISMATCH"); });
  const completenessKeys = result.results.map(comparisonCompletenessKey);
  if (completenessKeys.some((key) => key === null) || completenessKeys.some((key) => key !== completenessKeys[0])) proposalFail("COMPARISON_COMPLETENESS_MISMATCH");
  result.excludedOffers.forEach((exclusion) => assertExclusion(exclusion));
  const selections = result.results.map(calculationComparisonSelection);
  const validSelections = selections.filter((selection): selection is NonNullable<typeof selection> => selection !== null);
  if (validSelections.length !== selections.length) proposalFail("COMPARISON_COST_BASIS_INVALID");
  const firstSelection = validSelections[0] ?? null;
  if (result.comparisonCostBasis !== (firstSelection?.comparisonCostBasis ?? null) || canonical(result.regulatedComponentsIncluded) !== canonical(firstSelection?.regulatedComponentsIncluded ?? [])) proposalFail("COMPARISON_COST_BASIS_INVALID");
  if (validSelections.some((selection) => selection.comparisonCostBasis !== firstSelection?.comparisonCostBasis || canonical(selection.regulatedComponentsIncluded) !== canonical(firstSelection?.regulatedComponentsIncluded ?? []))) proposalFail("COMPARISON_COMPLETENESS_MISMATCH");
  result.ranking.forEach((entry) => { assertMoney(entry.totalCommercialCost, "COMPARISON_RANKING_INVALID"); assertMoney(entry.comparisonCost, "COMPARISON_RANKING_INVALID"); if (entry.comparisonCostBasis !== result.comparisonCostBasis || canonical(entry.regulatedComponentsIncluded) !== canonical(result.regulatedComponentsIncluded)) proposalFail("COMPARISON_RANKING_INVALID"); });
  const payload = { schemaVersion: result.schemaVersion, tenantId: result.tenantId, vector: result.vector, normalizedInput: result.normalizedInput, results: result.results, excludedOffers: result.excludedOffers, ranking: result.ranking, comparisonCostBasis: result.comparisonCostBasis, regulatedComponentsIncluded: result.regulatedComponentsIncluded, taxTreatment: result.taxTreatment, fiscalExclusionNotice: result.fiscalExclusionNotice };
  if (result.comparisonId !== `comparison_${result.fingerprint.slice(0, 32)}` || fingerprint(payload) !== result.fingerprint) proposalFail("COMPARISON_FINGERPRINT_MISMATCH");
  const ordered = [...result.results].sort((left, right) => { const leftSelection = calculationComparisonSelection(left); const rightSelection = calculationComparisonSelection(right); return compareInteger(leftSelection?.comparisonCost.minorUnits ?? Number.MAX_SAFE_INTEGER, rightSelection?.comparisonCost.minorUnits ?? Number.MAX_SAFE_INTEGER) || compareText(left.sourceCte.supplier, right.sourceCte.supplier) || compareText(left.sourceCte.offerCode, right.sourceCte.offerCode) || compareText(left.sourceCte.version, right.sourceCte.version) || compareText(left.sourceCte.archiveId, right.sourceCte.archiveId); });
  const expected: ComparisonRankingEntry[] = [];
  let previous: number | null = null; let group = 0;
  ordered.forEach((candidate, index) => { const selection = calculationComparisonSelection(candidate) ?? proposalFail("COMPARISON_COST_BASIS_INVALID"); if (previous === null || previous !== selection.comparisonCost.minorUnits) group += 1; previous = selection.comparisonCost.minorUnits; const priorSelection = index > 0 ? calculationComparisonSelection(ordered[index - 1]) : null; expected.push({ rank: priorSelection?.comparisonCost.minorUnits === selection.comparisonCost.minorUnits ? expected[index - 1].rank : index + 1, tieGroup: `tie-${group}`, calculationId: candidate.calculationId, supplier: candidate.sourceCte.supplier, offerCode: candidate.sourceCte.offerCode, cteVersion: candidate.sourceCte.version, totalCommercialCost: candidate.totalCommercialCost, comparisonCost: selection.comparisonCost, comparisonCostBasis: selection.comparisonCostBasis, regulatedComponentsIncluded: selection.regulatedComponentsIncluded }); });
  if (canonical(expected) !== canonical(result.ranking)) proposalFail("COMPARISON_RANKING_INVALID");
  const expectedWarnings = ordered.length === 0 ? ["NO_ELIGIBLE_OFFERS"] : result.excludedOffers.length > 0 ? ["EXCLUDED_OFFERS_PRESENT"] : [];
  if (canonical(result.warnings) !== canonical(expectedWarnings)) proposalFail("COMPARISON_WARNINGS_MISMATCH");
  return result;
}

export function calculationPayloadForFingerprint(result: CalculationResult): unknown { return calculationPayload(result); }
