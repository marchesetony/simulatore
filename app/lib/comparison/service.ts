import { createHash } from "node:crypto";
import type { CteArchiveRepository } from "../cte/archive/types";
import type { MarketArchiveRepository } from "../market/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { calculatePreparedOffer, exclusionFor, prepareApprovedOffer } from "../calculation/engine.ts";
import type { CalculationDependencies } from "../calculation/engine";
import type { CalculationExclusionCode, CalculationResult, RegulatedComponentIncluded, SimulationRequest } from "../calculation/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { EE_FISCAL_EXCLUSION_NOTICE } from "../calculation/economic-scope.ts";
import type { ComparisonCostBasis, ComparisonRankingEntry, ComparisonResult } from "./types";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function compareText(left: string, right: string): number { return left === right ? 0 : left < right ? -1 : 1; }
function compareInteger(left: number, right: number): number { return left === right ? 0 : left < right ? -1 : 1; }
const exclusionMessages: Readonly<Record<CalculationExclusionCode, string>> = {
  TENANT_MISMATCH: "The offer belongs to another tenant",
  VECTOR_MISMATCH: "The offer vector does not match the simulation vector",
  CTE_NOT_APPROVED: "No approved current CTE version is available",
  CTE_COMMERCIAL_BLOCKED: "The CTE is commercially blocked",
  CTE_COMMERCIAL_DELETED: "The CTE is commercially deleted",
  CTE_EXPIRED: "The approved CTE version is expired",
  CTE_VALIDITY_MISMATCH: "The approved CTE validity does not cover the simulation",
  CUSTOMER_NOT_ELIGIBLE: "The customer category is not eligible for the offer",
  VOLTAGE_NOT_ELIGIBLE: "The EE voltage level is not eligible for the offer",
  TAX_TREATMENT_INCOMPATIBLE: "The offer tax treatment is incompatible with the simulation",
  CURRENCY_INCOMPATIBLE: "The offer currency is incompatible with the simulation",
  CALCULATION_READY_INVALID: "The approved CTE is not calculation-ready",
  CALCULATION_INPUT_INVALID: "The simulation input is invalid for this offer",
  MONTHLY_PROFILE_REQUIRED: "A monthly profile is required for this indexed multi-month offer",
  MARKET_DATA_MISSING: "Approved market data is missing for one or more effective months",
  MARKET_DATA_INVALID: "Approved market data is invalid",
  CORRECTION_COEFFICIENT_REQUIRED: "The required GAS correction coefficient is unavailable",
  FEE_UNIT_MISMATCH: "A CTE fee unit is incompatible with the simulation vector",
  IMBALANCE_UNAVAILABLE: "The CTE imbalance value is not declared",
  ONE_OFF_FEE_UNIT_INVALID: "One-off fees must use EUR_PER_CONTRACT",
  COMPARISON_INCOMPATIBLE: "The offer cannot be compared with this simulation",
};

function codeOf(error: unknown): CalculationExclusionCode {
  const code = error instanceof Error && error.message in exclusionMessages ? error.message as CalculationExclusionCode : "CALCULATION_READY_INVALID";
  return code;
}
function canonicalComponentSet(values: readonly RegulatedComponentIncluded[]): readonly RegulatedComponentIncluded[] { return [...new Set(values)].sort() as RegulatedComponentIncluded[]; }
export interface ComparisonCostSelection {
  readonly comparisonCost: CalculationResult["totalCommercialCost"];
  readonly comparisonCostBasis: ComparisonCostBasis;
  readonly regulatedComponentsIncluded: readonly RegulatedComponentIncluded[];
}
export function comparisonCostOf(result: CalculationResult): ComparisonCostSelection | null {
  if (result.costScope === "COMMERCIAL_ONLY") return result.totalCommercialPlusRegulatedSubsetCost === null ? { comparisonCost: result.totalCommercialCost, comparisonCostBasis: "COMMERCIAL_ONLY", regulatedComponentsIncluded: [] } : null;
  if (result.costScope === "COMMERCIAL_PLUS_REGULATED_PARTIAL" && result.totalCommercialPlusRegulatedSubsetCost !== null) return { comparisonCost: result.totalCommercialPlusRegulatedSubsetCost, comparisonCostBasis: "COMMERCIAL_PLUS_REGULATED_PARTIAL", regulatedComponentsIncluded: canonicalComponentSet(result.regulatedComponentsIncluded) };
  return null;
}
export function comparisonCompletenessKey(result: CalculationResult): string | null { const selection = comparisonCostOf(result); return selection === null ? null : `${selection.comparisonCostBasis}|${selection.regulatedComponentsIncluded.join(",")}`; }
function compareResults(left: CalculationResult, right: CalculationResult): number {
  const leftCost = comparisonCostOf(left)?.comparisonCost.minorUnits ?? Number.MAX_SAFE_INTEGER;
  const rightCost = comparisonCostOf(right)?.comparisonCost.minorUnits ?? Number.MAX_SAFE_INTEGER;
  return compareInteger(leftCost, rightCost)
    || compareText(left.sourceCte.supplier, right.sourceCte.supplier)
    || compareText(left.sourceCte.offerCode, right.sourceCte.offerCode)
    || compareText(left.sourceCte.version, right.sourceCte.version)
    || compareText(left.sourceCte.archiveId, right.sourceCte.archiveId);
}

export function buildComparisonResult(request: SimulationRequest, results: readonly CalculationResult[], excludedOffers: readonly ReturnType<typeof exclusionFor>[] = []): ComparisonResult {
  if (request.vector === "EE" && request.taxTreatment !== "EXCLUDED") throw new Error("TAX_TREATMENT_INCOMPATIBLE");
  const keys = results.map(comparisonCompletenessKey);
  if (keys.some((key) => key === null) || keys.some((key) => key !== keys[0])) throw new Error("COMPARISON_INCOMPATIBLE");
  const ordered = [...results].sort(compareResults);
  const ranking: ComparisonRankingEntry[] = [];
  let previousTotal: number | null = null;
  let tieGroupNumber = 0;
  ordered.forEach((result, index) => {
    const selection = comparisonCostOf(result);
    if (selection === null) throw new Error("COMPARISON_INCOMPATIBLE");
    if (previousTotal === null || previousTotal !== selection.comparisonCost.minorUnits) tieGroupNumber += 1;
    previousTotal = selection.comparisonCost.minorUnits;
    const previousSelection = index > 0 ? comparisonCostOf(ordered[index - 1]) : null;
    ranking.push({ rank: previousSelection?.comparisonCost.minorUnits === selection.comparisonCost.minorUnits ? ranking[index - 1].rank : index + 1, tieGroup: `tie-${tieGroupNumber}`, calculationId: result.calculationId, supplier: result.sourceCte.supplier, offerCode: result.sourceCte.offerCode, cteVersion: result.sourceCte.version, totalCommercialCost: result.totalCommercialCost, comparisonCost: selection.comparisonCost, comparisonCostBasis: selection.comparisonCostBasis, regulatedComponentsIncluded: selection.regulatedComponentsIncluded });
  });
  const orderedExcluded = [...excludedOffers].sort((left, right) => compareText(left.archiveId, right.archiveId) || compareText(left.code, right.code));
  const reference = ordered.length > 0 ? comparisonCostOf(ordered[0]) : null;
  const payload = { schemaVersion: 1 as const, tenantId: request.tenantId, vector: request.vector, normalizedInput: request, results: ordered, excludedOffers: orderedExcluded, ranking, comparisonCostBasis: reference?.comparisonCostBasis ?? null, regulatedComponentsIncluded: reference?.regulatedComponentsIncluded ?? [], taxTreatment: request.taxTreatment, fiscalExclusionNotice: request.vector === "EE" || request.taxTreatment === "EXCLUDED" ? EE_FISCAL_EXCLUSION_NOTICE : null };
  const resultFingerprint = fingerprint(payload);
  return { ...payload, comparisonId: `comparison_${resultFingerprint.slice(0, 32)}`, fingerprint: resultFingerprint, calculatedAt: `${request.calculationDate}T00:00:00.000Z`, warnings: ordered.length === 0 ? ["NO_ELIGIBLE_OFFERS"] : orderedExcluded.length > 0 ? ["EXCLUDED_OFFERS_PRESENT"] : [] };
}

export async function compareApprovedOffers(cteRepository: CteArchiveRepository, marketRepository: MarketArchiveRepository, request: SimulationRequest, dependencies: CalculationDependencies = {}): Promise<ComparisonResult> {
  if (request.vector === "EE" && request.taxTreatment !== "EXCLUDED") throw new Error("TAX_TREATMENT_INCOMPATIBLE");
  const records = [...await cteRepository.list(request.tenantId)].sort((left, right) => compareText(left.archiveId, right.archiveId));
  const results: CalculationResult[] = [];
  const excludedOffers = [] as ReturnType<typeof exclusionFor>[];
  for (const record of records) {
    try {
      const prepared = await prepareApprovedOffer(cteRepository, marketRepository, request, record.archiveId);
      const result = await calculatePreparedOffer(request, prepared, dependencies);
      const selection = comparisonCostOf(result);
      if (selection === null || (results.length > 0 && comparisonCompletenessKey(result) !== comparisonCompletenessKey(results[0]))) {
        excludedOffers.push(exclusionFor(record, "COMPARISON_INCOMPATIBLE", exclusionMessages.COMPARISON_INCOMPATIBLE));
      } else results.push(result);
    } catch (error) {
      const code = codeOf(error);
      excludedOffers.push(exclusionFor(record, code, exclusionMessages[code]));
    }
  }
  return buildComparisonResult(request, results, excludedOffers);
}
