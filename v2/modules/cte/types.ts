import type { CommercialTermsSnapshot } from "../simulations/types";

export const CTE_COMMODITIES = ["EE"] as const;
export type Commodity = typeof CTE_COMMODITIES[number];
export const CTE_LIFECYCLE = ["DRAFT", "APPROVED", "ARCHIVED"] as const;
export type LifecycleStatus = typeof CTE_LIFECYCLE[number];
export type Applicability = "APPLIES" | "NOT_APPLICABLE" | "NOT_PROVIDED";
export type PricingUnit = "EUR_PER_KWH";
export type FeeUnit = "EUR_PER_MONTH" | "EUR_PER_YEAR";
export type ComponentKind = "COMMERCIALIZATION" | "MONTHLY_FEE" | "ANNUAL_FEE" | "IMBALANCE" | "OTHER_VARIABLE" | "DISCOUNT" | "ONE_OFF";
export const READINESS_REASONS = [
  "MISSING_PRICE", "MISSING_SPREAD", "AMBIGUOUS_UNIT", "MISSING_APPLICABILITY", "AMBIGUOUS_IMBALANCE",
  "INVALID_PERIOD", "OVERLAPPING_VALIDITY", "MISSING_VERSION", "MISSING_SUPPLIER", "MISSING_OFFER_IDENTITY",
  "UNSUPPORTED_COMMODITY", "UNSUPPORTED_DISCOUNT", "UNSUPPORTED_ONE_OFF", "AMBIGUOUS_COMPONENT",
  "NOT_APPROVED", "INCOMPATIBLE_TAX_TREATMENT",
] as const;
export type ReadinessReason = typeof READINESS_REASONS[number];
export interface Rate { readonly applicability: Applicability; readonly amount: string | null; readonly unit: PricingUnit | FeeUnit | null }
export interface CteComponent extends Rate { readonly kind: ComponentKind; readonly label: string }
export type Pricing =
  | { readonly mode: "FIXED"; readonly fixedPrice: Rate; readonly spread: Rate }
  | { readonly mode: "INDEXED"; readonly reference: "PUN"; readonly spread: Rate };
export interface Readiness { readonly status: "READY" | "BLOCKED"; readonly reasons: readonly ReadinessReason[] }
export interface CteCreateInput {
  readonly supplier: string; readonly offerCode: string; readonly offerName: string; readonly commodity: Commodity;
  readonly validFrom: string; readonly validTo: string; readonly lifecycleStatus: LifecycleStatus;
  readonly pricing: Pricing; readonly components: readonly CteComponent[]; readonly taxTreatment: "EXCLUDED";
}
export interface CteOfferVersion extends CteCreateInput {
  readonly id: string; readonly tenantId: string; readonly version: string; readonly createdAt: string;
  readonly calculationReadiness: Readiness;
}
export interface CteErrorShape { readonly code: "INVALID_INPUT" | "DENIED" | "NOT_FOUND" | "UNAVAILABLE" | "OVERLAPPING_VALIDITY" }
export class CteError extends Error {
  constructor(readonly code: CteErrorShape["code"]) { super(code); }
}
export type CteSimulationTerms = CommercialTermsSnapshot & { readonly source: { readonly type: "CTE"; readonly cteId: string; readonly cteVersion: string } };
