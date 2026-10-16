import type { CalculationExclusion, CalculationResult, SimulationRequest } from "../calculation/types";

export const COMPARISON_SCHEMA_VERSION = 1 as const;

export interface ComparisonRankingEntry {
  readonly rank: number;
  readonly tieGroup: string;
  readonly calculationId: string;
  readonly supplier: string;
  readonly offerCode: string;
  readonly cteVersion: string;
  readonly totalCommercialCost: CalculationResult["totalCommercialCost"];
}

export interface ComparisonSuggestion {
  readonly calculationId: string;
  readonly rank: number;
  readonly supplier: string;
  readonly offerCode: string;
  readonly totalCommercialCost: CalculationResult["totalCommercialCost"];
  readonly differenceFromBest: CalculationResult["totalCommercialCost"];
  readonly savingsVsBaseline: CalculationResult["savingsVsBaseline"];
  readonly reason: "BEST" | "WITHIN_TOLERANCE";
}

export interface ComparisonResult {
  readonly schemaVersion: typeof COMPARISON_SCHEMA_VERSION;
  readonly comparisonId: string;
  readonly fingerprint: string;
  readonly calculatedAt: string;
  readonly tenantId: string;
  readonly vector: "EE" | "GAS";
  readonly normalizedInput: SimulationRequest;
  readonly results: readonly CalculationResult[];
  readonly excludedOffers: readonly CalculationExclusion[];
  readonly ranking: readonly ComparisonRankingEntry[];
  readonly warnings: readonly string[];
  /** Derived from ranking, outside the fingerprint: the best offers proposed to the operator. */
  readonly suggestions?: readonly ComparisonSuggestion[];
}
