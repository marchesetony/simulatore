import "server-only";
import { BillError } from "../bills/types";
import { CalculationBlock, SimulationError, block, type CommercialResult, type CommercialTermsSnapshot,
  type SimulationInputSnapshot, type SimulationResult, CALCULATION_VERSION } from "./types";
import { simulationInput } from "./schema";
import { consumptionGroups, totalQuantity } from "./consumption";
import { energyComponents, feeComponents } from "./components";
import { safe, percentage } from "./decimal";

function calculateTerms(input: SimulationInputSnapshot, terms: CommercialTermsSnapshot): CommercialResult {
  const period = input.calculationPeriod;
  if (terms.periodStart > period.periodStart || terms.periodEnd < period.periodEnd) return block("INCOMPATIBLE_PERIOD");
  const groups = consumptionGroups(input.consumptionProfile, period), quantity = totalQuantity(groups);
  const components = [...energyComponents(terms, period, groups, quantity, input.marketSnapshot), ...feeComponents(terms, period)];
  const commercialTotalCents = safe(components.reduce((sum, component) => sum + BigInt(component.amountCents), BigInt(0)));
  return { components, commercialTotalCents };
}
function unavailable(reason: SimulationResult["blockReason"]): SimulationResult["comparison"] {
  return { status: "NOT_AVAILABLE", reason, savingAmountCents: null, savingPercentage: null };
}
function compare(input: SimulationInputSnapshot, candidate: CommercialResult): Pick<SimulationResult, "current" | "comparison"> {
  if (!input.currentCommercialTerms) return { current: null, comparison: unavailable("MISSING_CURRENT_TERMS") };
  try {
    const current = calculateTerms(input, input.currentCommercialTerms);
    const savingAmountCents = safe(BigInt(current.commercialTotalCents) - BigInt(candidate.commercialTotalCents));
    return { current, comparison: { status: "COMPARABLE", reason: null, savingAmountCents,
      savingPercentage: percentage(savingAmountCents, current.commercialTotalCents) } };
  } catch (error) {
    if (error instanceof CalculationBlock) return { current: null, comparison: unavailable(error.reason) };
    throw error;
  }
}
/** Pure server-side calculation of explicit snapshots: no clock, network or repository reads. */
export function calculate(input: SimulationInputSnapshot): SimulationResult {
  try {
    if (input.calculationVersion !== CALCULATION_VERSION) throw new SimulationError("INVALID_INPUT");
    const normalized = simulationInput({ billId: input.billReference.id, calculationPeriod: input.calculationPeriod,
      currentCommercialTerms: input.currentCommercialTerms, candidateCommercialTerms: input.candidateCommercialTerms, marketSnapshot: input.marketSnapshot });
    const snapshot = { ...input, ...normalized };
    if (!snapshot.candidateCommercialTerms) return block("MISSING_CANDIDATE_TERMS");
    const candidate = calculateTerms(snapshot, snapshot.candidateCommercialTerms);
    return { scope: "COMMERCIAL_ONLY", status: "CALCULATED", blockReason: null, candidate, ...compare(snapshot, candidate) };
  } catch (error) {
    if (error instanceof BillError) throw new SimulationError("INVALID_INPUT");
    if (!(error instanceof CalculationBlock)) throw error;
    return { scope: "COMMERCIAL_ONLY", status: "BLOCKED", blockReason: error.reason, candidate: null, current: null, comparison: unavailable(error.reason) };
  }
}
