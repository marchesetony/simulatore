import type { ConsumptionInput, Period } from "../bills/types";

export const CALCULATION_VERSION = "commercial-ee-1" as const;
export const FEE_KINDS = ["COMMERCIALIZATION", "MONTHLY_FEE", "ANNUAL_FEE", "IMBALANCE", "OTHER_VARIABLE", "ONE_OFF", "DISCOUNT"] as const;
export const LEGACY_FEE_KINDS = ["COMMERCIALIZATION", "IMBALANCE", "OTHER_VARIABLE", "ONE_OFF", "DISCOUNT"] as const;
export type FeeKind = typeof FEE_KINDS[number];
export type Applicability = "APPLIES" | "NOT_APPLICABLE" | "UNKNOWN";
export interface Rate {
  readonly applicability: Applicability;
  readonly amount: string | null;
  readonly unit: "EUR_PER_KWH" | "EUR_PER_MONTH" | "EUR_PER_YEAR" | "EUR_PER_CONTRACT" | null;
}
export interface CommercialTermsSnapshot extends Period {
  readonly reference: string;
  readonly mode: "FIXED" | "INDEXED";
  readonly taxTreatment: "EXCLUDED";
  readonly fixedPrice: Rate;
  readonly spread: Rate;
  readonly fees: readonly (Rate & { readonly kind: FeeKind })[];
  readonly source?: { readonly type: "CTE"; readonly cteId: string; readonly cteVersion: string };
}
export interface MarketSnapshot {
  readonly reference: string;
  readonly values: readonly { readonly month: string; readonly band: "F1" | "F2" | "F3";
    readonly value: string | null; readonly unit: "EUR_PER_MWH"; readonly versionReference: string }[];
}
export interface SimulationCreateInput {
  readonly billId: string;
  readonly calculationPeriod: Period;
  readonly currentCommercialTerms: CommercialTermsSnapshot | null;
  readonly candidateCommercialTerms: CommercialTermsSnapshot | null;
  readonly marketSnapshot: MarketSnapshot | null;
}
export interface SimulationInputSnapshot extends Omit<SimulationCreateInput, "billId"> {
  readonly billReference: { readonly id: string; readonly documentNumber: string; readonly customerId: string };
  readonly supplyReference: { readonly id: string; readonly pod: string };
  readonly consumptionProfile: readonly ConsumptionInput[];
  readonly calculationVersion: typeof CALCULATION_VERSION;
}
export type BlockReason = "MISSING_CONSUMPTION" | "AMBIGUOUS_CONSUMPTION" | "INCOMPATIBLE_PERIOD" |
  "MISSING_CURRENT_TERMS" | "MISSING_CANDIDATE_TERMS" | "MISSING_MARKET_DATA" | "AMBIGUOUS_MARKET_DATA" |
  "UNKNOWN_UNIT" | "MISSING_COMMERCIAL_COMPONENT" | "AMBIGUOUS_COMPONENT" | "AMOUNT_OUT_OF_RANGE";
export interface CommercialResult {
  readonly components: readonly { readonly kind: "ENERGY" | "SPREAD" | FeeKind;
    readonly periodStart: string; readonly periodEnd: string; readonly band: "TOTAL" | "F1" | "F2" | "F3";
    readonly amountCents: number }[];
  readonly commercialTotalCents: number;
}
export interface SimulationResult {
  readonly scope: "COMMERCIAL_ONLY";
  readonly status: "CALCULATED" | "BLOCKED";
  readonly blockReason: BlockReason | null;
  readonly candidate: CommercialResult | null;
  readonly current: CommercialResult | null;
  readonly comparison: { readonly status: "COMPARABLE" | "NOT_AVAILABLE"; readonly reason: BlockReason | null;
    readonly savingAmountCents: number | null; readonly savingPercentage: string | null };
}
export interface Simulation {
  readonly id: string;
  readonly tenantId: string;
  readonly billId: string;
  readonly supplyId: string;
  readonly scope: "COMMERCIAL_ONLY";
  readonly status: "DRAFT" | "CALCULATED" | "BLOCKED";
  readonly inputSnapshot: SimulationInputSnapshot;
  readonly result: SimulationResult;
  readonly calculationVersion: typeof CALCULATION_VERSION;
}
export class SimulationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "DENIED" | "NOT_FOUND" | "UNAVAILABLE") { super(code); }
}
export class CalculationBlock extends Error {
  constructor(readonly reason: BlockReason) { super(reason); }
}
export function block(reason: BlockReason): never { throw new CalculationBlock(reason); }
