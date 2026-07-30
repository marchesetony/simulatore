export type ApprovalStatus = "IMPORTED" | "VALIDATED" | "APPROVED" | "REJECTED";
export type OfficialInstitution = "ARERA" | "GME" | "TERNA" | "ACQUIRENTE_UNICO" | "SII" | "OTHER_COMPETENT";
export type Market = "ELECTRICITY" | "GAS";
export type IndexType = "PUN" | "PUN_INDEX_GME" | "ZONAL" | "FIXED" | "OTHER_OFFICIAL";
export type Granularity = "MONTHLY" | "F1" | "F2" | "F3" | "F23" | "HOURLY" | "FINER";
export type TariffBand = "MONORARY" | "F1" | "F2" | "F3" | "F23" | "HOURLY" | "FINER";
export type ReviewStatus = "APPROVED" | "REJECTED" | "NEEDS_REVIEW";
export type DocumentFamily = "SCONTRINO_ENERGIA" | "DETAILED_BILL" | "DETAILED_COST_STATEMENT" | "SYNTHETIC_BILL" | "ANNEX" | "TECHNICAL_DETAIL";
export type CustomerCategory = "DOMESTIC" | "NON_DOMESTIC" | "CONDOMINIUM" | "BUSINESS" | "PUBLIC_ADMINISTRATION";
export type ComponentType = "TRANSPORT" | "DISTRIBUTION" | "METERING" | "SYSTEM_CHARGES" | "DISPATCHING" | "LOSSES" | "TAX" | "EXCISE" | "OTHER_REGULATED";
export type RegulatoryEntityType = "OfficialSource" | "RegulatoryDocument" | "RegulatoryRuleVersion" | "MarketDataSeries" | "MarketDataPoint";
export type VersionState = "CURRENT" | "SUPERSEDED";

export interface TenantScoped {
  readonly tenantId: string;
}

export interface EntityIdentity extends TenantScoped {
  readonly id: string;
  readonly version: string;
  readonly parentVersionId: string | null;
}

export interface EffectiveVersion extends EntityIdentity {
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface SourceMetadata extends TenantScoped {
  readonly sourceInstitution: OfficialInstitution;
  readonly officialIdentifier: string;
  readonly sourceUrl: string;
  readonly publicationDate: string;
  readonly retrievedAt: string;
  readonly checksum: string;
  readonly approvalStatus: ApprovalStatus;
  readonly reviewer: string | null;
  readonly provenance: readonly EvidenceReference[];
  readonly reviewDecisionId?: string | null;
}

export interface OfficialSource extends SourceMetadata, EntityIdentity {}

export interface RegulatoryDocument extends SourceMetadata, EffectiveVersion {
  readonly sourceId: string;
  readonly documentType: string;
  readonly contentReference: string;
  readonly ruleId?: string | null;
}

export interface RegulatoryRuleVersion extends SourceMetadata, EffectiveVersion {
  readonly documentId: string;
  readonly ruleCode: string;
  readonly subject: string;
  readonly customerCategory: CustomerCategory | null;
  readonly market: Market;
  readonly formulaReference: string | null;
  readonly confidence: number;
}

export type TariffStructure = "MONO" | "F1_F23" | "F1_F2_F3";

export interface MarketDataSeries extends SourceMetadata, EffectiveVersion {
  readonly sourceId: string;
  readonly market: "ELECTRICITY";
  readonly indexType: IndexType;
  readonly granularity: Granularity;
  readonly structure: TariffStructure;
  readonly currency: string;
  readonly unit: string;
  readonly documentId?: string | null;
  readonly ruleId?: string | null;
}

export interface MarketDataPoint extends SourceMetadata, EffectiveVersion {
  readonly sourceId: string;
  readonly seriesId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly band: TariffBand;
  readonly value: number;
  readonly unit: string;
  readonly confidence: number;
}

export interface TariffBandCalendar extends SourceMetadata, EffectiveVersion {
  readonly id: string;
  readonly market: "ELECTRICITY";
  readonly calendarYear: number;
  readonly timezone: string;
  readonly holidayRules: readonly string[];
  readonly supportedBands: readonly TariffBand[];
  readonly bandIntervals: readonly { readonly band: TariffBand; readonly start: string; readonly end: string }[];
}

export interface ContractFormula extends EffectiveVersion {
  readonly id: string;
  readonly indexType: IndexType;
  readonly bandStructure: TariffBand;
  readonly formulaText: string;
  readonly spread: number | null;
  readonly lossFactor: number | null;
  readonly fixedFee: number | null;
  readonly commercialComponents: readonly string[];
  readonly roundingRule: string;
  readonly taxTreatment: string;
  readonly sourceEvidence: readonly EvidenceReference[];
  readonly confidence: number;
  readonly reviewStatus: ReviewStatus;
}

export interface PassThroughComponentVersion extends SourceMetadata, EffectiveVersion {
  readonly id: string;
  readonly componentType: ComponentType;
  readonly customerCategory: CustomerCategory;
  readonly market: Market;
  readonly valueOrFormula: string;
  readonly unit: string;
}

export interface EvidenceReference extends TenantScoped {
  readonly id: string;
  readonly subjectType: RegulatoryEntityType;
  readonly subjectId: string;
  readonly subjectVersionId: string | null;
  readonly sourceInstitution: OfficialInstitution;
  readonly sourceDocumentOrDataset: string;
  readonly officialIdentifier: string;
  readonly sourceUrl: string;
  readonly publicationDate: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly retrievedAt: string;
  readonly checksum: string;
  readonly immutableVersion: string;
  readonly ingestionStatus: ApprovalStatus;
  readonly reviewerApprovalStatus: ApprovalStatus;
  readonly provenance: readonly string[];
}

export interface ReviewDecision extends TenantScoped {
  readonly id: string;
  readonly subjectType: RegulatoryEntityType;
  readonly subjectId: string;
  readonly subjectVersionId: string | null;
  readonly decision: ReviewStatus;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly reason: string;
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly supersedesDecisionId: string | null;
}

export interface VersionStateRecord extends TenantScoped {
  readonly subjectType: RegulatoryEntityType;
  readonly subjectId: string;
  readonly recordId: string;
  readonly state: VersionState;
  readonly supersededBy: string | null;
  readonly changedAt: string;
}

export type RegulatoryEntity = OfficialSource | RegulatoryDocument | RegulatoryRuleVersion | MarketDataSeries | MarketDataPoint;
