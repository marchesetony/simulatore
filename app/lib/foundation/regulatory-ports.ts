import type {
  EvidenceReference,
  MarketDataPoint,
  MarketDataSeries,
  OfficialSource,
  RegulatoryDocument,
  RegulatoryEntityType,
  RegulatoryRuleVersion,
  ReviewDecision,
  RegulatoryValueRecord,
  TariffBandCalendar,
  VersionStateRecord,
} from "./regulatory-types";

export type UnsupportedReason = "HOURLY_UNSUPPORTED" | "GAS_UNSUPPORTED" | "SOURCE_UNAPPROVED" | "DATA_MISSING" | "DATA_CONFLICT";

export interface ApprovalRequest {
  readonly tenantId: string;
  readonly subjectType: RegulatoryEntityType;
  readonly subjectId: string;
  readonly reviewer: string;
  readonly decision: ReviewDecision;
}

export interface OfficialSourceRegistry {
  get(tenantId: string, id: string): Promise<OfficialSource | null>;
  save(source: OfficialSource): Promise<void>;
  isAllowed(source: OfficialSource): boolean;
}

export interface RegulatoryDocumentIngestor {
  importDocument(document: RegulatoryDocument): Promise<RegulatoryDocument>;
  importRule(rule: RegulatoryRuleVersion): Promise<RegulatoryRuleVersion>;
}

export interface MarketDataIngestor {
  importSeries(series: MarketDataSeries, points: readonly MarketDataPoint[]): Promise<MarketDataSeries>;
}

export interface EffectiveDateResolver {
  resolve<T extends { readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly approvalStatus: string }>(versions: readonly T[], instant: string): T | null;
}

export interface TariffBandCalendarResolver {
  resolve(calendarId: string, date: string): Promise<{ readonly calendar: TariffBandCalendar; readonly band: string } | { readonly unsupported: UnsupportedReason }>;
}

export interface ManualApprovalPort {
  approve(input: ApprovalRequest): Promise<void>;
}

export interface EvidenceReferenceStore {
  put(reference: EvidenceReference): Promise<void>;
  getEvidence(tenantId: string, id: string): Promise<EvidenceReference | null>;
  getReview(tenantId: string, id: string): Promise<ReviewDecision | null>;
}

export interface VersionStatePort {
  getVersionState(tenantId: string, subjectType: RegulatoryEntityType, recordId: string): Promise<VersionStateRecord | null>;
}

export interface RegulatoryValueStore {
  saveRegulatoryValue(value: RegulatoryValueRecord): Promise<"CREATED" | "REUSED" | "CONFLICT">;
  getRegulatoryValues(tenantId: string, componentCode?: RegulatoryValueRecord["componentCode"]): Promise<readonly RegulatoryValueRecord[]>;
}

export interface RegulatoryRepository extends OfficialSourceRegistry, RegulatoryDocumentIngestor, MarketDataIngestor, ManualApprovalPort, EvidenceReferenceStore, VersionStatePort, RegulatoryValueStore {
  getDocument(tenantId: string, id: string): Promise<RegulatoryDocument | null>;
  getCurrentSource(tenantId: string, id: string): Promise<OfficialSource | null>;
  getDocumentVersion(tenantId: string, id: string): Promise<RegulatoryDocument | null>;
  getRule(tenantId: string, id: string): Promise<RegulatoryRuleVersion | null>;
  getSeries(tenantId: string, id: string): Promise<MarketDataSeries | null>;
  getSeriesVersion(tenantId: string, id: string): Promise<MarketDataSeries | null>;
  getSeriesHistory(tenantId: string, id: string): Promise<readonly MarketDataSeries[]>;
  getPoints(tenantId: string, seriesId: string): Promise<readonly MarketDataPoint[]>;
  getPointVersions(tenantId: string, seriesId: string): Promise<readonly MarketDataPoint[]>;
  getPointHistory(tenantId: string, seriesId: string): Promise<readonly MarketDataPoint[]>;
}
