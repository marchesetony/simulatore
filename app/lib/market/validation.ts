import type { MonthlyMarketDataRecord } from "../energy/market-data";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateMonthlyMarketData } from "../energy/market-data.ts";
import type { MarketArchiveApproval, MarketArchiveHistoryEvent, MarketArchiveRecord, MarketArchiveStatus } from "./types";

export class MarketArchiveValidationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "MarketArchiveValidationError"; this.code = code; }
}
const fail = (code: string): never => { throw new MarketArchiveValidationError(code); };
const nonEmpty = (value: unknown, code: string): string => typeof value === "string" && value.trim() ? value : fail(code);
const dateTime = (value: unknown, code: string): string => { const text = nonEmpty(value, code); if (!Number.isFinite(Date.parse(text))) fail(code); const date = text.slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}/.test(text) || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) || new Date(Date.parse(`${date}T00:00:00.000Z`)).toISOString().slice(0, 10) !== date) fail(code); return text; };
const statuses: readonly MarketArchiveStatus[] = ["DRAFT", "REVIEWED", "APPROVED", "REJECTED"];

export function assertMarketTenantId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^tenant_[a-z0-9-]+$/.test(value)) fail("TENANT_ACCESS_DENIED");
}

export function assertMarketRecord(value: unknown, tenantId: string): asserts value is MonthlyMarketDataRecord {
  validateMonthlyMarketData(value);
  const record = value as MonthlyMarketDataRecord;
  if (record.tenantId !== tenantId) fail("TENANT_ACCESS_DENIED");
  if (record.vector === "EE" && record.index !== "PUN") fail("MARKET_VECTOR_INDEX_MISMATCH");
  if (record.vector === "GAS" && record.index !== "PSV") fail("MARKET_VECTOR_INDEX_MISMATCH");
}

export function validateStoredMarketArchive(value: unknown): MarketArchiveRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("ARCHIVE_METADATA_INVALID");
  const item = value as Record<string, unknown>;
  assertMarketTenantId(item.tenantId);
  const archiveId = nonEmpty(item.archiveId, "ARCHIVE_METADATA_INVALID");
  assertMarketRecord(item.record, item.tenantId);
  const record = item.record as MonthlyMarketDataRecord;
  if (record.recordId !== archiveId || item.vector !== record.vector || item.index !== record.index || item.month !== record.month) fail("ARCHIVE_METADATA_INVALID");
  if (!statuses.includes(item.status as MarketArchiveStatus)) fail("ARCHIVE_STATUS_INVALID");
  const approvals = Array.isArray(item.approvals) ? item.approvals : fail("ARCHIVE_METADATA_INVALID");
  const parsedApprovals: readonly MarketArchiveApproval[] = approvals.map((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) fail("ARCHIVE_METADATA_INVALID");
    const approval = candidate as Record<string, unknown>;
    const decision: MarketArchiveApproval["decision"] = approval.decision === "APPROVED" || approval.decision === "REJECTED" ? approval.decision : fail("ARCHIVE_METADATA_INVALID");
    return { approvalId: nonEmpty(approval.approvalId, "ARCHIVE_METADATA_INVALID"), recordId: nonEmpty(approval.recordId, "ARCHIVE_METADATA_INVALID"), decision, reviewer: nonEmpty(approval.reviewer, "ARCHIVE_METADATA_INVALID"), decisionId: nonEmpty(approval.decisionId, "ARCHIVE_METADATA_INVALID"), decidedAt: dateTime(approval.decidedAt, "ARCHIVE_METADATA_INVALID") };
  });
  if (parsedApprovals.some((approval) => approval.recordId !== archiveId)) fail("ARCHIVE_METADATA_INVALID");
  const rawHistory = Array.isArray(item.history) ? item.history : fail("ARCHIVE_HISTORY_INVALID");
  if (rawHistory.length === 0) fail("ARCHIVE_HISTORY_INVALID");
  const history: readonly MarketArchiveHistoryEvent[] = rawHistory.map((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) fail("ARCHIVE_HISTORY_INVALID");
    const event = candidate as Record<string, unknown>;
    if (!["CREATED", "REVIEWED", "APPROVED", "REJECTED"].includes(event.type as string) || event.tenantId !== item.tenantId || event.recordId !== archiveId) fail("ARCHIVE_HISTORY_INVALID");
    return { eventId: nonEmpty(event.eventId, "ARCHIVE_HISTORY_INVALID"), type: event.type as MarketArchiveHistoryEvent["type"], tenantId: item.tenantId as string, recordId: archiveId, at: dateTime(event.at, "ARCHIVE_HISTORY_INVALID"), actor: nonEmpty(event.actor, "ARCHIVE_HISTORY_INVALID"), reason: event.reason === null ? null : nonEmpty(event.reason, "ARCHIVE_HISTORY_INVALID") };
  });
  return { archiveId, tenantId: item.tenantId as string, vector: record.vector, index: record.index, month: record.month, record, status: item.status as MarketArchiveStatus, createdAt: dateTime(item.createdAt, "ARCHIVE_METADATA_INVALID"), updatedAt: dateTime(item.updatedAt, "ARCHIVE_METADATA_INVALID"), approvals: parsedApprovals, history };
}
