import { createHash } from "node:crypto";
import type { EffectiveDateResolver, RegulatoryRepository, TariffBandCalendarResolver, UnsupportedReason } from "./regulatory-ports";
import type {
  IndexType,
  MarketDataPoint,
  MarketDataSeries,
  OfficialSource,
  RegulatoryDocument,
  RegulatoryEntityType,
  RegulatoryRuleVersion,
  TariffBandCalendar,
  TariffStructure,
} from "./regulatory-types";

const requiredBands = (structure: MarketDataSeries["structure"]): readonly string[] => structure === "MONO" ? ["MONORARY"] : structure === "F1_F23" ? ["F1", "F23"] : ["F1", "F2", "F3"];
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};
const validateChecksum = (value: { readonly checksum: string } & object): boolean => {
  const payload: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete payload.checksum;
  return createHash("sha256").update(canonical(payload)).digest("hex") === value.checksum.toLowerCase();
};
const timestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const inInterval = (value: { readonly effectiveFrom: string; readonly effectiveTo: string | null }, instant: string): boolean => {
  const at = timestamp(instant);
  const from = timestamp(value.effectiveFrom);
  const to = value.effectiveTo === null ? Number.POSITIVE_INFINITY : timestamp(value.effectiveTo);
  return Number.isFinite(at) && Number.isFinite(from) && (value.effectiveTo === null || Number.isFinite(to)) && from <= at && at < to;
};
const compatible = (child: { readonly effectiveFrom?: string; readonly effectiveTo?: string | null }, parent: { readonly effectiveFrom?: string; readonly effectiveTo?: string | null }): boolean => {
  if (child.effectiveFrom === undefined || parent.effectiveFrom === undefined) return true;
  const childFrom = timestamp(child.effectiveFrom);
  const parentFrom = timestamp(parent.effectiveFrom);
  if (!Number.isFinite(childFrom) || !Number.isFinite(parentFrom) || childFrom < parentFrom) return false;
  if (parent.effectiveTo !== null && parent.effectiveTo !== undefined) {
    if (child.effectiveTo === null || child.effectiveTo === undefined) return false;
    return timestamp(child.effectiveTo) <= timestamp(parent.effectiveTo);
  }
  return true;
};

export class HistoricalEffectiveDateResolver implements EffectiveDateResolver {
  resolve<T extends { readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly approvalStatus: string }>(versions: readonly T[], instant: string): T | null {
    const matches = versions.filter((item) => item.approvalStatus === "APPROVED" && inInterval(item, instant));
    return matches.length === 1 ? matches[0] : null;
  }
}

export class LocalTariffBandCalendarResolver implements TariffBandCalendarResolver {
  private readonly calendars: ReadonlyMap<string, TariffBandCalendar>;

  constructor(calendars: ReadonlyMap<string, TariffBandCalendar>) {
    this.calendars = calendars;
  }

  async resolve(calendarId: string, date: string): Promise<{ readonly calendar: TariffBandCalendar; readonly band: string } | { readonly unsupported: UnsupportedReason }> {
    const calendar = this.calendars.get(calendarId);
    if (!calendar || calendar.approvalStatus !== "APPROVED") return { unsupported: "SOURCE_UNAPPROVED" };
    const day = timestamp(date);
    if (!Number.isFinite(day)) return { unsupported: "DATA_MISSING" };
    const interval = calendar.bandIntervals.find((item) => timestamp(item.start) <= day && day < timestamp(item.end));
    return interval ? { calendar, band: interval.band } : { unsupported: "DATA_MISSING" };
  }
}

export function unsupportedMarketRequest(market: string, granularity: string): { readonly unsupported: UnsupportedReason } | null {
  if (market === "GAS") return { unsupported: "GAS_UNSUPPORTED" };
  if (granularity === "HOURLY" || granularity === "FINER") return { unsupported: "HOURLY_UNSUPPORTED" };
  return null;
}

export type ResolverReason = "SOURCE_NOT_APPROVED" | "DOCUMENT_NOT_APPROVED" | "RULE_NOT_APPROVED" | "SERIES_NOT_APPROVED" | "POINT_NOT_APPROVED" | "CHECKSUM_INVALID" | "EVIDENCE_MISSING" | "REVIEWER_MISSING" | "EFFECTIVE_DATE_MISMATCH" | "CONFLICTING_APPROVED_VERSIONS" | "SUPERSEDED_VERSION" | "TARIFF_STRUCTURE_INCOMPLETE" | "INDEX_MISMATCH" | "COMMODITY_UNSUPPORTED" | "GRANULARITY_UNSUPPORTED" | "TARIFF_STRUCTURE_UNSUPPORTED" | "DATA_NOT_FOUND";
export type UsableMarketData = { readonly kind: "USABLE"; readonly series: MarketDataSeries; readonly points: readonly MarketDataPoint[] };
export type ResolverFailure = { readonly kind: "UNUSABLE"; readonly reason: ResolverReason };

type VersionLike = {
  readonly id: string;
  readonly tenantId: string;
  readonly officialIdentifier: string;
  readonly approvalStatus: string;
  readonly reviewer: string | null;
  readonly provenance: readonly unknown[];
  readonly checksum: string;
  readonly reviewDecisionId?: string | null;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string | null;
};

export class UsableDataResolver {
  private readonly repository: RegulatoryRepository;

  constructor(repository: RegulatoryRepository) {
    this.repository = repository;
  }

  private failure(reason: ResolverReason): ResolverFailure {
    return { kind: "UNUSABLE", reason };
  }

  private isFailure(value: unknown): value is ResolverFailure {
    return typeof value === "object" && value !== null && "kind" in value && (value as { readonly kind?: unknown }).kind === "UNUSABLE";
  }

  private async verify(subjectType: RegulatoryEntityType, subject: VersionLike, reason: ResolverReason, instant: string, parent?: VersionLike): Promise<ResolverFailure | null> {
    if (subject.approvalStatus !== "APPROVED") return this.failure(reason);
    const state = await this.repository.getVersionState(subject.tenantId, subjectType, subject.id);
    if (!state) return this.failure("DATA_NOT_FOUND");
    if (state.state !== "CURRENT") return this.failure("SUPERSEDED_VERSION");
    if (!subject.reviewer) return this.failure("REVIEWER_MISSING");
    if (!subject.reviewDecisionId || subject.provenance.length === 0) return this.failure("EVIDENCE_MISSING");
    const review = await this.repository.getReview(subject.tenantId, subject.reviewDecisionId);
    if (!review || review.subjectType !== subjectType || review.subjectId !== subject.officialIdentifier || review.subjectVersionId !== subject.id) return this.failure("EVIDENCE_MISSING");
    if (!review.reviewer.trim()) return this.failure("REVIEWER_MISSING");
    if (!review.reason.trim() || !review.reviewedAt || review.decision !== "APPROVED") return this.failure("EVIDENCE_MISSING");
    for (const reference of subject.provenance) {
      const evidenceId = typeof reference === "object" && reference !== null && "id" in reference ? String((reference as { readonly id: unknown }).id) : "";
      const evidence = evidenceId ? await this.repository.getEvidence(subject.tenantId, evidenceId) : null;
      if (!evidence || evidence.ingestionStatus !== "APPROVED" || evidence.reviewerApprovalStatus !== "APPROVED") return this.failure("EVIDENCE_MISSING");
      if (evidence.subjectType !== subjectType || evidence.subjectId !== subject.officialIdentifier || evidence.subjectVersionId !== subject.id) return this.failure("EFFECTIVE_DATE_MISMATCH");
      if (!validateChecksum(evidence)) return this.failure("CHECKSUM_INVALID");
    }
    if (!validateChecksum(subject as { readonly checksum: string } & object)) return this.failure("CHECKSUM_INVALID");
    if (subject.effectiveFrom !== undefined && subject.effectiveTo !== undefined && !inInterval(subject as { effectiveFrom: string; effectiveTo: string | null }, instant)) return this.failure("EFFECTIVE_DATE_MISMATCH");
    if (parent && !compatible(subject, parent)) return this.failure("EFFECTIVE_DATE_MISMATCH");
    return null;
  }

  private async resolveSource(tenantId: string, sourceId: string, instant: string): Promise<OfficialSource | ResolverFailure> {
    const source = await this.repository.getCurrentSource(tenantId, sourceId);
    if (!source) return this.failure("DATA_NOT_FOUND");
    const issue = await this.verify("OfficialSource", source, "SOURCE_NOT_APPROVED", instant);
    return issue ?? source;
  }

  private async resolveDocument(tenantId: string, id: string, source: OfficialSource, instant: string): Promise<RegulatoryDocument | ResolverFailure> {
    const document = await this.repository.getDocumentVersion(tenantId, id);
    if (!document) return this.failure("DATA_NOT_FOUND");
    if (document.sourceId !== source.id) return this.failure("EFFECTIVE_DATE_MISMATCH");
    const issue = await this.verify("RegulatoryDocument", document, "DOCUMENT_NOT_APPROVED", instant, source);
    return issue ?? document;
  }

  private async resolveRule(tenantId: string, id: string, document: RegulatoryDocument, instant: string): Promise<RegulatoryRuleVersion | ResolverFailure> {
    const rule = await this.repository.getRule(tenantId, id);
    if (!rule) return this.failure("DATA_NOT_FOUND");
    if (rule.documentId !== document.id) return this.failure("EFFECTIVE_DATE_MISMATCH");
    const issue = await this.verify("RegulatoryRuleVersion", rule, "RULE_NOT_APPROVED", instant, document);
    return issue ?? rule;
  }

  async resolve(tenantId: string, seriesId: string, instant: string, requestedIndex: IndexType, requestedGranularity: string, requestedStructure?: TariffStructure): Promise<UsableMarketData | ResolverFailure> {
    if (requestedGranularity === "HOURLY" || requestedGranularity === "FINER") return this.failure("GRANULARITY_UNSUPPORTED");
    if (requestedGranularity !== "MONTHLY" && requestedGranularity !== "F1" && requestedGranularity !== "F2" && requestedGranularity !== "F3" && requestedGranularity !== "F23") return this.failure("GRANULARITY_UNSUPPORTED");
    const series = await this.repository.getSeriesVersion(tenantId, seriesId);
    if (!series) return this.failure("DATA_NOT_FOUND");
    const sourceResult = await this.resolveSource(tenantId, series.sourceId, instant);
    if (this.isFailure(sourceResult)) return sourceResult;
    if (series.documentId) {
      const documentResult = await this.resolveDocument(tenantId, series.documentId, sourceResult, instant);
      if (this.isFailure(documentResult)) return documentResult;
      if (series.ruleId || documentResult.ruleId) {
        const ruleResult = await this.resolveRule(tenantId, series.ruleId ?? documentResult.ruleId!, documentResult, instant);
        if (this.isFailure(ruleResult)) return ruleResult;
      }
    } else if (series.ruleId) {
      return this.failure("DATA_NOT_FOUND");
    }
    const seriesIssue = await this.verify("MarketDataSeries", series, "SERIES_NOT_APPROVED", instant, sourceResult);
    if (seriesIssue) return seriesIssue;
    if (series.market !== "ELECTRICITY") return this.failure("COMMODITY_UNSUPPORTED");
    if (series.indexType !== requestedIndex) return this.failure("INDEX_MISMATCH");
    if (series.structure !== "MONO" && series.structure !== "F1_F23" && series.structure !== "F1_F2_F3") return this.failure("TARIFF_STRUCTURE_UNSUPPORTED");
    if (requestedStructure !== undefined && requestedStructure !== series.structure) return this.failure("TARIFF_STRUCTURE_UNSUPPORTED");
    if (series.granularity !== requestedGranularity && !(requestedGranularity === "MONTHLY" && series.granularity === "MONTHLY")) return this.failure("GRANULARITY_UNSUPPORTED");
    const seriesHistory = await this.repository.getSeriesHistory(tenantId, seriesId);
    const approvedSeries = [];
    for (const item of seriesHistory) {
      const state = await this.repository.getVersionState(tenantId, "MarketDataSeries", item.id);
      if (item.approvalStatus === "APPROVED" && state?.state === "CURRENT" && inInterval(item, instant)) approvedSeries.push(item);
    }
    if (approvedSeries.length > 1) return this.failure("CONFLICTING_APPROVED_VERSIONS");
    const points = await this.repository.getPointVersions(tenantId, seriesId);
    if (points.length === 0) return this.failure("DATA_NOT_FOUND");
    const effective = points.filter((point) => inInterval(point, instant));
    if (effective.length === 0) return this.failure("DATA_NOT_FOUND");
    if (effective.some((point) => point.sourceId !== sourceResult.id || point.seriesId !== series.id)) return this.failure("EFFECTIVE_DATE_MISMATCH");
    if (effective.some((point) => point.approvalStatus !== "APPROVED")) return this.failure("POINT_NOT_APPROVED");
    for (const point of effective) {
      const pointIssue = await this.verify("MarketDataPoint", point, "POINT_NOT_APPROVED", instant, series);
      if (pointIssue) return pointIssue;
    }
    const pointHistory = await this.repository.getPointHistory(tenantId, seriesId);
    for (const point of effective) {
      const sameBand = [];
      for (const item of pointHistory) {
        const state = await this.repository.getVersionState(tenantId, "MarketDataPoint", item.id);
        if (item.band === point.band && item.approvalStatus === "APPROVED" && state?.state === "CURRENT" && inInterval(item, instant)) sameBand.push(item);
      }
      if (sameBand.length > 1) return this.failure("CONFLICTING_APPROVED_VERSIONS");
    }
    const bands = requiredBands(series.structure);
    if (effective.length !== bands.length || bands.some((band) => !effective.some((point) => point.band === band))) return this.failure("TARIFF_STRUCTURE_INCOMPLETE");
    return { kind: "USABLE", series, points: effective };
  }
}
