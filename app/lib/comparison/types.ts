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
}
