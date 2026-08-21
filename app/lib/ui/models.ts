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

export interface CteApprovedArchiveSummaryModel {
  readonly archiveId: string;
  readonly vector: UiVector;
  readonly offerName: string;
  readonly supplierName: string;
  readonly validity: { readonly periodStart: string; readonly periodEnd: string };
  readonly status: "APPROVED";
  readonly commercialStatus: "ACTIVE" | "BLOCKED";
}

export interface CteApprovedPriceModel {
  readonly amount: number;
  readonly currency: "EUR";
  readonly unit: string;
  readonly taxTreatment: string;
}

export type CteApprovedDeclaredModel = { readonly status: "DECLARED"; readonly component: CteApprovedFeeModel } | { readonly status: "NOT_DECLARED"; readonly reason: string };
export interface CteApprovedFeeModel extends CteApprovedPriceModel { readonly label: string; }
export interface CteApprovedContractModel {
  readonly vector: UiVector;
  readonly supplier: { readonly name: string; readonly supplierId: string };
  readonly offer: { readonly name: string; readonly code: string };
  readonly validity: { readonly periodStart: string; readonly periodEnd: string };
  readonly expiry: Record<string, unknown>;
  readonly currency: "EUR";
  readonly taxTreatment: string;
  readonly eligibility: { readonly customerTypes: readonly string[]; readonly voltageLevels?: readonly string[] };
  readonly pricing: { readonly mode: string; readonly reference: string; readonly spread: CteApprovedPriceModel | CteApprovedDeclaredModel; readonly fixedPrice?: CteApprovedPriceModel };
  readonly commercialTerms: {
    readonly fixedFees: readonly CteApprovedFeeModel[];
    readonly variableFees: readonly CteApprovedFeeModel[];
    readonly imbalance: CteApprovedDeclaredModel;
    readonly oneOffFees: readonly CteApprovedFeeModel[];
    readonly commercialDiscounts: readonly CteApprovedFeeModel[];
  };
  readonly reviewFields?: readonly CteReviewFieldModel[];
  readonly notFoundFields?: readonly CteReviewFieldModel[];
  readonly sources?: readonly CteReviewSourceModel[];
  readonly approvedAt?: string;
  readonly approvedVersion?: string;
  readonly documentType?: "CTE" | "UNKNOWN";
  readonly documentSize?: number;
}

export interface CteApprovedArchiveDetailModel {
  readonly archiveId: string;
  readonly status: "APPROVED";
  readonly commercialStatus: "ACTIVE" | "BLOCKED";
  readonly blockedAt: string | null;
  readonly blockedBy: string | null;
  readonly blockReason: string | null;
  readonly contract: CteApprovedContractModel;
}

export type CteIngestionStatus = "UPLOADED" | "OCR_PROCESSING" | "EXTRACTION_PROCESSING" | "REVIEW_REQUIRED" | "PROVIDER_NOT_CONFIGURED" | "FAILED" | "APPROVED";
export type CteExtractionFieldStatus = "CONFIRMED" | "UNCERTAIN" | "NOT_FOUND" | "CORRECTED";
export interface CteExtractionFieldModel {
  readonly path: string;
  readonly value: string | number | null;
  readonly confidence: number;
  readonly sourcePage: number | null;
  readonly sourceText: string | null;
  readonly status: CteExtractionFieldStatus;
}
export interface CteReviewFieldModel {
  readonly fieldKey: string;
  readonly label: string;
  readonly normalizedValue: string | number | readonly string[] | null;
  readonly required: boolean;
  readonly unit?: string;
  readonly periodicity?: string;
  readonly description?: string;
  readonly status: CteExtractionFieldStatus;
  readonly confidence: number;
  readonly sourcePage: number | null;
  readonly sourceText: string | null;
  readonly sourceTextComplete: string | null;
  readonly sourceRef?: number;
  readonly conditions?: readonly string[];
  readonly notes?: readonly string[];
}
export interface CteReviewSourceModel {
  readonly sourceRef: number;
  readonly sourcePage: number | null;
  readonly sourceText: string;
  readonly sourceTextComplete: string;
}
export interface CteApprovalBlockerModel {
  readonly code: string;
  readonly fieldKey?: string;
  readonly label: string;
  readonly required: true;
}
export interface CteApprovalGateModel {
  readonly approvalReady: boolean;
  readonly blockers: readonly CteApprovalBlockerModel[];
  readonly optionalNotFound: readonly string[];
}
export interface CteIngestionModel {
  readonly ingestionId: string;
  readonly documentId: string;
  readonly fileName: string;
  readonly offerName: string | null;
  readonly supplierName: string | null;
  readonly contentType: "application/pdf" | "image/jpeg" | "image/png";
  readonly size: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: CteIngestionStatus;
  readonly documentType: "CTE" | "UNKNOWN";
  readonly vector: UiVector | "UNKNOWN";
  readonly currency: string | null;
  readonly fields: readonly CteExtractionFieldModel[];
  readonly reviewFields: readonly CteReviewFieldModel[];
  readonly notFoundFields: readonly CteReviewFieldModel[];
  readonly sources: readonly CteReviewSourceModel[];
  readonly approvalGate: CteApprovalGateModel;
  readonly extractionNotes: readonly string[];
  readonly candidatePreview: Record<string, unknown> | null;
  readonly corrections: readonly { readonly version: number; readonly fieldPath: string; readonly previousValue: string | number | null; readonly nextValue: string | number; readonly actor: string; readonly correctedAt: string }[];
  readonly errorCode: string | null;
  readonly approvedArchiveId: string | null;
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
  readonly normalized: import("../foundation/real-bill").PublicBillProfile | null;
  readonly structuredBill: import("../ingestion/structured-bill").StructuredBillExtraction | null;
  readonly resolvedVector: "EE" | "GAS" | "UNKNOWN";
  readonly invoicePunReferences: import("../market/pun-reference").OfficialPunModel;
  readonly regulatoryAudit: import("../foundation/bill-regulatory-audit").BillRegulatoryAuditDTO | null;
  readonly analystReview: import("../foundation/bill-analyst-review").BillAnalystReviewDTO;
}

export interface ApprovedBillSummaryModel {
  readonly id: string;
  readonly title: string;
  readonly supplier: string | null;
  readonly supplyReference: string | null;
  readonly period: { readonly periodStart: string | null; readonly periodEnd: string | null };
  readonly vector: UiVector;
  readonly status: "APPROVED";
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
  readonly customerCategory: "RESIDENTIAL" | "NON_RESIDENTIAL" | "";
  readonly taxTreatment: "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE" | "";
  readonly customerReference: string;
  readonly supplyReference: string;
  readonly voltageLevel: "LV" | "MV" | "HV" | "EHV" | "";
  readonly f1: string;
  readonly f2: string;
  readonly f3: string;
  readonly smc: string;
  readonly correctionRequired: boolean;
  readonly correctionCoefficient: string;
  readonly baseline: string;
}
