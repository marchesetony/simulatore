import type { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
import type { RegulatoryValueComponentCode, RegulatoryCustomerScope, RegulatoryValueRecord } from "../foundation/regulatory-types.ts";

export interface RegulatoryTimelineRequest {
  readonly tenantId: string;
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope: RegulatoryCustomerScope;
  readonly normalizedUnit: RegulatoryValueRecord["normalizedUnit"];
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface RegulatoryTimelineSegment {
  readonly segmentStart: string;
  readonly segmentEnd: string;
  readonly regulatoryRecordId: string;
  readonly regulatoryVersion: string;
  readonly authority: RegulatoryValueRecord["authority"];
  readonly sourceType: RegulatoryValueRecord["sourceType"];
  readonly sourceReference: RegulatoryValueRecord["sourceReference"];
  readonly publicationDate: RegulatoryValueRecord["publicationDate"];
  readonly retrievedAt: RegulatoryValueRecord["retrievedAt"];
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope: RegulatoryCustomerScope;
  readonly normalizedValue: number;
  readonly normalizedUnit: string;
  readonly applicationBasis: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly officialIdentifier: string;
  readonly sourceSha256: RegulatoryValueRecord["sourceSha256"];
  readonly conversionProvenance: RegulatoryValueRecord["conversionProvenance"];
  readonly checksum: string;
  readonly publishedBy?: RegulatoryValueRecord["publishedBy"];
  readonly calculatedBy?: RegulatoryValueRecord["calculatedBy"];
  readonly officialName?: RegulatoryValueRecord["officialName"];
  readonly referenceDomain?: RegulatoryValueRecord["referenceDomain"];
  readonly contractPassThroughRequired?: RegulatoryValueRecord["contractPassThroughRequired"];
  readonly carriedForwardFrom?: RegulatoryValueRecord["carriedForwardFrom"];
  readonly confirmationSource?: RegulatoryValueRecord["confirmationSource"];
}

export interface RegulatoryTimeline {
  readonly tenantId: string;
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope: RegulatoryCustomerScope;
  readonly normalizedUnit: RegulatoryValueRecord["normalizedUnit"];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly segments: readonly RegulatoryTimelineSegment[];
}

export type RegulatoryTimelineErrorCode =
  | "REGULATORY_TIMELINE_PERIOD_INVALID"
  | "REGULATORY_TIMELINE_DATE_INVALID"
  | "REGULATORY_TIMELINE_GAP"
  | "REGULATORY_TIMELINE_OVERLAP";

export class RegulatoryTimelineError extends Error {
  readonly code: RegulatoryTimelineErrorCode;

  constructor(code: RegulatoryTimelineErrorCode) {
    super(code);
    this.name = "RegulatoryTimelineError";
    this.code = code;
  }
}

const fail = (code: RegulatoryTimelineErrorCode): never => { throw new RegulatoryTimelineError(code); };
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WITH_EXPLICIT_ZONE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

function parseDateOnly(value: string, errorCode: "REGULATORY_TIMELINE_PERIOD_INVALID" | "REGULATORY_TIMELINE_DATE_INVALID"): number {
  const match = DATE_ONLY.exec(value);
  if (!match) return fail(errorCode);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return fail(errorCode);
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return fail(errorCode);
  return parsed;
}

function parseRegulatoryInstant(value: string): number {
  if (DATE_ONLY.test(value)) return parseDateOnly(value, "REGULATORY_TIMELINE_DATE_INVALID");
  const timestampMatch = ISO_WITH_EXPLICIT_ZONE.exec(value);
  if (!timestampMatch) return fail("REGULATORY_TIMELINE_DATE_INVALID");
  const year = Number(timestampMatch[1]);
  const month = Number(timestampMatch[2]);
  const day = Number(timestampMatch[3]);
  if (!isValidCalendarDate(year, month, day)) return fail("REGULATORY_TIMELINE_DATE_INVALID");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return fail("REGULATORY_TIMELINE_DATE_INVALID");
  return parsed;
}

function isoUtc(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function validateRequest(request: RegulatoryTimelineRequest): { readonly start: number; readonly end: number } {
  const start = parseDateOnly(request.periodStart, "REGULATORY_TIMELINE_PERIOD_INVALID");
  const end = parseDateOnly(request.periodEnd, "REGULATORY_TIMELINE_PERIOD_INVALID");
  if (start >= end) return fail("REGULATORY_TIMELINE_PERIOD_INVALID");
  return { start, end };
}

function intervalFor(record: RegulatoryValueRecord): { readonly from: number; readonly to: number } {
  const from = parseRegulatoryInstant(record.effectiveFrom);
  const to = record.effectiveTo === null ? Number.POSITIVE_INFINITY : parseRegulatoryInstant(record.effectiveTo);
  if (from >= to) return fail("REGULATORY_TIMELINE_DATE_INVALID");
  return { from, to };
}

function sortedApplicableRecords(
  records: readonly RegulatoryValueRecord[],
  periodStart: number,
  periodEnd: number,
): readonly { readonly record: RegulatoryValueRecord; readonly from: number; readonly to: number }[] {
  const applicable = records
    .map((record) => {
      const interval = intervalFor(record);
      return { record, ...interval };
    })
    .filter(({ from, to }) => from < periodEnd && periodStart < to)
    .sort((left, right) => left.from - right.from || left.to - right.to || left.record.id.localeCompare(right.record.id) || left.record.version.localeCompare(right.record.version) || left.record.checksum.localeCompare(right.record.checksum));

  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const item of applicable) {
    if (item.from < coveredUntil) return fail("REGULATORY_TIMELINE_OVERLAP");
    coveredUntil = Math.max(coveredUntil, item.to);
  }
  return applicable;
}

function segmentFrom(record: RegulatoryValueRecord, segmentStart: number, segmentEnd: number): RegulatoryTimelineSegment {
  return {
    segmentStart: isoUtc(segmentStart),
    segmentEnd: isoUtc(segmentEnd),
    regulatoryRecordId: record.id,
    regulatoryVersion: record.version,
    authority: record.authority,
    sourceType: record.sourceType,
    sourceReference: record.sourceReference,
    publicationDate: record.publicationDate,
    retrievedAt: record.retrievedAt,
    componentCode: record.componentCode,
    customerScope: record.customerScope,
    normalizedValue: record.normalizedValue,
    normalizedUnit: record.normalizedUnit,
    applicationBasis: record.applicationBasis,
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    officialIdentifier: record.officialIdentifier,
    sourceSha256: record.sourceSha256,
    conversionProvenance: [...record.conversionProvenance],
    checksum: record.checksum,
    ...(record.publishedBy === undefined ? {} : { publishedBy: record.publishedBy }),
    ...(record.calculatedBy === undefined ? {} : { calculatedBy: record.calculatedBy }),
    ...(record.officialName === undefined ? {} : { officialName: record.officialName }),
    ...(record.referenceDomain === undefined ? {} : { referenceDomain: record.referenceDomain }),
    ...(record.contractPassThroughRequired === undefined ? {} : { contractPassThroughRequired: record.contractPassThroughRequired }),
    ...(record.carriedForwardFrom === undefined ? {} : { carriedForwardFrom: record.carriedForwardFrom }),
    ...(record.confirmationSource === undefined ? {} : { confirmationSource: record.confirmationSource }),
  };
}

export async function resolveRegulatoryTimeline(
  bridge: Pick<ProductionRegulatoryPersistenceBridge, "list">,
  request: RegulatoryTimelineRequest,
): Promise<RegulatoryTimeline> {
  const period = validateRequest(request);
  const records = await bridge.list(request.tenantId, { componentCode: request.componentCode, customerScope: request.customerScope, normalizedUnit: request.normalizedUnit });
  const applicable = sortedApplicableRecords(records, period.start, period.end);
  const segments: RegulatoryTimelineSegment[] = [];
  let cursor = period.start;

  for (const item of applicable) {
    if (item.from > cursor) return fail("REGULATORY_TIMELINE_GAP");
    const segmentStart = Math.max(cursor, item.from);
    const segmentEnd = Math.min(period.end, item.to);
    if (segmentStart >= segmentEnd) continue;
    segments.push(segmentFrom(item.record, segmentStart, segmentEnd));
    cursor = segmentEnd;
    if (cursor === period.end) break;
  }

  if (cursor < period.end) return fail("REGULATORY_TIMELINE_GAP");
  return { tenantId: request.tenantId, componentCode: request.componentCode, customerScope: request.customerScope, normalizedUnit: request.normalizedUnit, periodStart: request.periodStart, periodEnd: request.periodEnd, segments };
}
