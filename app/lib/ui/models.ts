export type UiVector = "EE" | "GAS";
export type UiRole = "ADMIN" | "ANALYST" | "VIEWER";
export type UiAuthenticationState = "AUTHENTICATED" | "UNAUTHENTICATED" | "UNAVAILABLE";

export interface ReadinessModel {
  readonly application: "running";
  readonly runtimeMode: "local" | "production" | "invalid";
  readonly authAdapterConfigured: boolean;
  readonly persistenceAdapterConfigured: boolean;
  readonly readiness: boolean;
  readonly schemaCompatibility: boolean;
  readonly timestamp: string;
}

export interface VerifiedContextModel {
  readonly authenticated: boolean;
  readonly authenticationState: UiAuthenticationState;
  readonly principalId?: string;
  readonly role?: UiRole;
  readonly tenantId?: string;
  readonly authSource?: "LOCAL_SYNTHETIC" | "VERIFIED_SESSION";
  readonly runtimeMode: "local" | "production" | "invalid";
  readonly readiness: ReadinessModel;
  readonly error?: { readonly code: string; readonly message: string; readonly correlationId: string };
}

export interface CteVersionModel {
  readonly versionId: string;
  readonly versionNumber: string;
  readonly status: string;
  readonly contract: Record<string, unknown>;
}

export interface CteArchiveModel {
  readonly archiveId: string;
  readonly tenantId: string;
  readonly cteId: string;
  readonly vector: UiVector;
  readonly currentWorkingVersionId: string;
  readonly currentApprovedVersionId: string | null;
  readonly versions: readonly CteVersionModel[];
  readonly approvals: readonly Record<string, unknown>[];
  readonly history: readonly Record<string, unknown>[];
}

export interface MarketArchiveModel {
  readonly archiveId: string;
  readonly tenantId: string;
  readonly vector: UiVector;
  readonly index: "PUN" | "PSV";
  readonly month: string;
  readonly record: Record<string, unknown>;
  readonly status: string;
  readonly approvals: readonly Record<string, unknown>[];
  readonly history: readonly Record<string, unknown>[];
}

export interface BillDocumentModel {
  readonly id: string;
  readonly status: string;
  readonly fileName: string;
  readonly currentVersionId: string;
  readonly currentVersionNumber: number;
  readonly reviewState: string;
  readonly currentApprovedVersionId: string | null;
  readonly versionCount: number;
  readonly approvalReady: boolean;
  readonly fields: Readonly<Record<string, { readonly value: string | null; readonly confidence: number; readonly source: string; readonly confirmed: boolean }>>;
}

export interface CalculationMoneyModel {
  readonly amount: number;
  readonly minorUnits: number;
  readonly currency: "EUR";
}

export interface CalculationModel {
  readonly calculationId: string;
  readonly fingerprint: string;
  readonly tenantId: string;
  readonly vector: UiVector;
  readonly supplyPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly calculationDate: string;
  readonly taxTreatment: string;
  readonly voltageLevel?: "LV" | "MV" | "HV" | "EHV";
  readonly sourceCte: { readonly archiveId: string; readonly cteId: string; readonly versionId: string; readonly version: string; readonly supplier: string; readonly offerCode: string };
  readonly marketData: readonly { readonly recordId: string; readonly version: string; readonly vector: UiVector; readonly index: "PUN" | "PSV"; readonly month: string }[];
  readonly components: readonly { readonly category: string; readonly label: string; readonly sign: string; readonly amount: CalculationMoneyModel; readonly formulaId: string }[];
  readonly totalCommercialCost: CalculationMoneyModel;
  readonly unitCost: { readonly amount: number; readonly unit: string; readonly currency: "EUR" };
  readonly savingsVsBaseline: CalculationMoneyModel | null;
  readonly warnings: readonly string[];
  readonly normalizedInput: Record<string, unknown>;
}

export interface ComparisonModel {
  readonly comparisonId: string;
  readonly fingerprint: string;
  readonly tenantId: string;
  readonly vector: UiVector;
  readonly results: readonly CalculationModel[];
  readonly excludedOffers: readonly { readonly archiveId: string; readonly cteId: string; readonly vector: UiVector; readonly supplier: string; readonly offerCode: string; readonly code: string; readonly message: string }[];
  readonly ranking: readonly { readonly rank: number; readonly tieGroup: string; readonly calculationId: string; readonly supplier: string; readonly offerCode: string; readonly cteVersion: string; readonly totalCommercialCost: CalculationMoneyModel }[];
  readonly warnings: readonly string[];
}

export interface ProposalModel {
  readonly proposalId: string;
  readonly proposalFingerprint: string;
  readonly calculationFingerprint: string;
  readonly vector: UiVector;
  readonly tenantId: string;
  readonly selectedOffer: { readonly archiveId: string; readonly supplier: string; readonly offerCode: string; readonly cteId: string; readonly versionId: string; readonly version: string };
  readonly selectedResult: { readonly calculationId: string; readonly calculationFingerprint: string; readonly rankingPosition: number | null; readonly tieGroup: string | null };
  readonly commercialCost: CalculationMoneyModel;
  readonly unitCost: { readonly amount: number; readonly unit: string; readonly currency: "EUR" };
  readonly components: readonly { readonly category: string; readonly label: string; readonly sign: string; readonly amount: CalculationMoneyModel }[];
  readonly marketData: readonly { readonly recordId: string; readonly version: string; readonly vector: UiVector; readonly index: "PUN" | "PSV"; readonly month: string }[];
  readonly exclusions: readonly { readonly code: string; readonly message: string }[];
  readonly warnings: readonly string[];
  readonly unavailableInformation: readonly string[];
  readonly notCalculated: readonly string[];
  readonly notes: readonly string[];
  readonly offerValidity: { readonly periodStart: string; readonly periodEnd: string };
}

export interface SimulationDraft {
  readonly vector: UiVector;
  readonly calculationDate: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly customerCategory: "RESIDENTIAL" | "NON_RESIDENTIAL";
  readonly taxTreatment: "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE";
  readonly customerReference: string;
  readonly supplyReference: string;
  readonly voltageLevel: "LV" | "MV" | "HV" | "EHV";
  readonly f1: string;
  readonly f2: string;
  readonly f3: string;
  readonly smc: string;
  readonly correctionRequired: boolean;
  readonly correctionCoefficient: string;
  readonly baseline: string;
}
