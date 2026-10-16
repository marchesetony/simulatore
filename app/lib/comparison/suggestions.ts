import type { CalculationMoney, CalculationResult } from "../calculation/types";
import type { ComparisonRankingEntry, ComparisonSuggestion } from "./types";

/** Offers whose commercial cost is within this share of the best one are proposed together, so the operator chooses. */
export const SUGGESTION_TOLERANCE_PERCENT = 3;
export const SUGGESTION_MAX_OFFERS = 3;

function money(minorUnits: number): CalculationMoney { return { amount: minorUnits / 100, minorUnits, currency: "EUR" }; }

export function suggestOffers(results: readonly CalculationResult[], ranking: readonly ComparisonRankingEntry[]): readonly ComparisonSuggestion[] {
  const best = ranking[0];
  if (!best) return [];
  const bestMinor = best.totalCommercialCost.minorUnits;
  const threshold = bestMinor + Math.ceil(Math.max(bestMinor, 0) * SUGGESTION_TOLERANCE_PERCENT / 100);
  return ranking
    .filter((entry) => entry.totalCommercialCost.minorUnits <= threshold)
    .slice(0, SUGGESTION_MAX_OFFERS)
    .map((entry) => {
      const result = results.find((candidate) => candidate.calculationId === entry.calculationId);
      return {
        calculationId: entry.calculationId,
        rank: entry.rank,
        supplier: entry.supplier,
        offerCode: entry.offerCode,
        totalCommercialCost: entry.totalCommercialCost,
        differenceFromBest: money(entry.totalCommercialCost.minorUnits - bestMinor),
        savingsVsBaseline: result?.savingsVsBaseline ?? null,
        reason: entry.totalCommercialCost.minorUnits === bestMinor ? "BEST" as const : "WITHIN_TOLERANCE" as const,
      };
    });
}
