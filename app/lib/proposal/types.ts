import type { CalculationComponent, CalculationExclusion, CalculationMarketReference, CalculationResult, SimulationRequest } from "../calculation/types";
import type { ComparisonResult } from "../comparison/types";

export const PROPOSAL_SCHEMA_VERSION = 1 as const;
export const PROPOSAL_MAX_INPUT_BYTES = 262144;
export const PROPOSAL_MAX_OUTPUT_BYTES = 524288;

export type ProposalExportFormat = "JSON" | "CSV" | "HTML";

export interface ProposalCustomerSummary {
  readonly customerId: string;
  readonly category: SimulationRequest["customerCategory"];
  readonly displayName?: string;
}

export interface ProposalSupplySummary {
  readonly supplyId: string;
  readonly meterId?: string;
  readonly pod?: string;
  readonly pdr?: string;
  readonly voltageLevel?: "LV" | "MV" | "HV" | "EHV";
}

export interface ProposalOfferIdentity {
  readonly archiveId: string;
  readonly cteId: string;
  readonly versionId: string;
  readonly version: string;
  readonly supplier: string;
  readonly offerCode: string;
}

export interface ProposalSourceBillReference {
  readonly billId: string;
  readonly version: string;
}

export interface ProposalRequestBase {
  readonly schemaVersion: typeof PROPOSAL_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly sourceBill?: ProposalSourceBillReference;
  readonly customer: ProposalCustomerSummary;
  readonly supply: ProposalSupplySummary;
  readonly proposalIssueDate: string;
  readonly offerValidity: { readonly periodStart: string; readonly periodEnd: string };
  readonly commercialNotes?: string;
  readonly requestedExportFormat: ProposalExportFormat;
}

export interface CalculationProposalRequest extends ProposalRequestBase {
  readonly sourceType: "CALCULATION";
  readonly calculation: CalculationResult;
  readonly selectedOffer: ProposalOfferIdentity;
}

export interface ComparisonProposalRequest extends ProposalRequestBase {
  readonly sourceType: "COMPARISON";
  readonly comparison: ComparisonResult;
  readonly selectedCalculationId: string;
  readonly selectedOffer: ProposalOfferIdentity;
}

export type ProposalRequest = CalculationProposalRequest | ComparisonProposalRequest;

export interface ProposalSelectedResultSummary {
  readonly calculationId: string;
  readonly calculationFingerprint: string;
  readonly rankingPosition: number | null;
  readonly tieGroup: string | null;
}

export interface ProposalCanonicalSnapshot {
  readonly schemaVersion: typeof PROPOSAL_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly tenantId: string;
  readonly vector: "EE" | "GAS";
  readonly customer: ProposalCustomerSummary;
  readonly supply: ProposalSupplySummary;
  readonly sourceBill?: ProposalSourceBillReference;
  readonly selectedOffer: ProposalOfferIdentity;
  readonly cte: { readonly cteId: string; readonly archiveId: string; readonly versionId: string; readonly version: string };
  readonly marketData: readonly CalculationMarketReference[];
  readonly simulationPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly normalizedConsumption: SimulationRequest["consumption"];
  readonly commercialCost: CalculationResult["totalCommercialCost"];
  readonly unitCost: CalculationResult["unitCost"];
  readonly components: readonly CalculationComponent[];
  readonly baseline: CalculationResult["savingsVsBaseline"];
  readonly savings: CalculationResult["savingsVsBaseline"];
  readonly selectedResult: ProposalSelectedResultSummary;
  readonly exclusions: readonly CalculationExclusion[];
  readonly warnings: readonly string[];
  readonly currency: "EUR";
  readonly units: { readonly consumption: "KWH" | "SMC"; readonly unitCost: "EUR_PER_KWH" | "EUR_PER_SMC" };
  readonly taxTreatment: SimulationRequest["taxTreatment"];
  readonly roundingPolicy: CalculationResult["roundingPolicy"];
  readonly calculationFingerprint: string;
  readonly proposalFingerprint: string;
  readonly generatedAt: string;
  readonly offerValidity: { readonly periodStart: string; readonly periodEnd: string };
  readonly notes: readonly string[];
  readonly notCalculated: readonly string[];
  readonly unavailableInformation: readonly string[];
  readonly disclaimer: string;
}
