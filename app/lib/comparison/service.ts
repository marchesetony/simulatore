import { createHash } from "node:crypto";
import type { CteArchiveRepository } from "../cte/archive/types";
import type { MarketArchiveRepository } from "../market/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { calculatePreparedOffer, exclusionFor, prepareApprovedOffer } from "../calculation/engine.ts";
import type { CalculationExclusionCode, CalculationResult, SimulationRequest } from "../calculation/types";
import type { ComparisonRankingEntry, ComparisonResult } from "./types";

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
function compareResults(left: CalculationResult, right: CalculationResult): number {
  return compareInteger(left.totalCommercialCost.minorUnits, right.totalCommercialCost.minorUnits)
    || compareText(left.sourceCte.supplier, right.sourceCte.supplier)
    || compareText(left.sourceCte.offerCode, right.sourceCte.offerCode)
    || compareText(left.sourceCte.version, right.sourceCte.version)
    || compareText(left.sourceCte.archiveId, right.sourceCte.archiveId);
}

export async function compareApprovedOffers(cteRepository: CteArchiveRepository, marketRepository: MarketArchiveRepository, request: SimulationRequest): Promise<ComparisonResult> {
  const records = [...await cteRepository.list(request.tenantId)].sort((left, right) => compareText(left.archiveId, right.archiveId));
  const results: CalculationResult[] = [];
  const excludedOffers = [] as ReturnType<typeof exclusionFor>[];
  for (const record of records) {
    try {
      const prepared = await prepareApprovedOffer(cteRepository, marketRepository, request, record.archiveId);
      results.push(await calculatePreparedOffer(request, prepared));
    } catch (error) {
      const code = codeOf(error);
      excludedOffers.push(exclusionFor(record, code, exclusionMessages[code]));
    }
  }
  const ordered = [...results].sort(compareResults);
  const ranking: ComparisonRankingEntry[] = [];
  let previousTotal: number | null = null;
  let tieGroupNumber = 0;
  ordered.forEach((result, index) => {
    if (previousTotal === null || previousTotal !== result.totalCommercialCost.minorUnits) tieGroupNumber += 1;
    previousTotal = result.totalCommercialCost.minorUnits;
    ranking.push({ rank: index > 0 && ordered[index - 1].totalCommercialCost.minorUnits === result.totalCommercialCost.minorUnits ? ranking[index - 1].rank : index + 1, tieGroup: `tie-${tieGroupNumber}`, calculationId: result.calculationId, supplier: result.sourceCte.supplier, offerCode: result.sourceCte.offerCode, cteVersion: result.sourceCte.version, totalCommercialCost: result.totalCommercialCost });
  });
  const orderedExcluded = [...excludedOffers].sort((left, right) => compareText(left.archiveId, right.archiveId) || compareText(left.code, right.code));
  const payload = { schemaVersion: 1 as const, tenantId: request.tenantId, vector: request.vector, normalizedInput: request, results: ordered, excludedOffers: orderedExcluded, ranking };
  const resultFingerprint = fingerprint(payload);
  return { ...payload, comparisonId: `comparison_${resultFingerprint.slice(0, 32)}`, fingerprint: resultFingerprint, calculatedAt: `${request.calculationDate}T00:00:00.000Z`, warnings: ordered.length === 0 ? ["NO_ELIGIBLE_OFFERS"] : orderedExcluded.length > 0 ? ["EXCLUDED_OFFERS_PRESENT"] : [] };
}
