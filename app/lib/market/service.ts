import { randomUUID } from "node:crypto";
import type { MonthlyMarketDataRecord } from "../energy/market-data";
import type { CreateMarketArchiveInput, MarketArchiveRecord, MarketArchiveStatus } from "./types";
import type { MarketArchiveRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertMarketRecord, assertMarketTenantId } from "./validation.ts";

const nowValue = (value?: string): string => { const result = value ?? new Date().toISOString(); if (!Number.isFinite(Date.parse(result))) throw new Error("DATE_TIME_INVALID"); const date = result.slice(0, 10); const parsedDate = Date.parse(`${date}T00:00:00.000Z`); if (!/^\d{4}-\d{2}-\d{2}/.test(result) || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== date) throw new Error("DATE_TIME_INVALID"); return result; };
const actorValue = (value?: string): string => { if (typeof value !== "string" || value.trim().length === 0) throw new Error("ACTOR_REQUIRED"); return value.trim(); };
const statusFor = (record: MonthlyMarketDataRecord): MarketArchiveStatus => record.approval.status === "APPROVED" ? "APPROVED" : record.approval.status === "NEEDS_REVIEW" ? "REVIEWED" : record.approval.status;
const event = (record: MarketArchiveRecord, type: MarketArchiveRecord["history"][number]["type"], at: string, actor: string, reason: string | null) => ({ eventId: randomUUID(), type, tenantId: record.tenantId, recordId: record.archiveId, at, actor, reason });

function withApproval(record: MonthlyMarketDataRecord, approval: MonthlyMarketDataRecord["approval"]): MonthlyMarketDataRecord { return { ...record, approval } as MonthlyMarketDataRecord; }
function ensureMonthRecord(record: MonthlyMarketDataRecord, tenantId: string): void { assertMarketRecord(record, tenantId); }

export async function createMarketArchive(repository: MarketArchiveRepository, input: CreateMarketArchiveInput): Promise<MarketArchiveRecord> {
  assertMarketTenantId(input.tenantId); ensureMonthRecord(input.record, input.tenantId);
  const archiveId = input.archiveId ?? input.record.recordId;
  if (archiveId !== input.record.recordId) throw new Error("MARKET_RECORD_ID_MISMATCH");
  if (await repository.get(input.tenantId, archiveId)) throw new Error("MARKET_ARCHIVE_ALREADY_EXISTS");
  const now = nowValue(input.now); const actor = actorValue(input.actor ?? "LOCAL_IMPORT"); const status = statusFor(input.record);
  const record = { archiveId, tenantId: input.tenantId, vector: input.record.vector, index: input.record.index, month: input.record.month, record: input.record, status, createdAt: now, updatedAt: now, approvals: status === "APPROVED" ? [{ approvalId: randomUUID(), recordId: archiveId, decision: "APPROVED" as const, reviewer: actor, decisionId: `approved-${archiveId}`, decidedAt: now }] : [], history: [] } as MarketArchiveRecord;
  const next = { ...record, history: [event(record, "CREATED", now, actor, null)] };
  await repository.save(next); return structuredClone(next);
}

export async function approveMarketArchive(repository: MarketArchiveRepository, tenantId: string, archiveId: string, reviewer: string, decisionId: string, at?: string): Promise<MarketArchiveRecord> {
  assertMarketTenantId(tenantId); const record = await repository.get(tenantId, archiveId); if (!record) throw new Error("MARKET_ARCHIVE_NOT_FOUND"); if (record.status === "APPROVED") throw new Error("MARKET_RECORD_ALREADY_APPROVED");
  const actor = actorValue(reviewer); const decision = actorValue(decisionId); const now = nowValue(at); const approvalMetadata = { status: "APPROVED" as const, reviewer: actor, reviewedAt: now, decisionId: decision };
  const approvedRecord = withApproval(record.record, approvalMetadata); const next: MarketArchiveRecord = { ...record, updatedAt: now, status: "APPROVED", record: approvedRecord, approvals: [...record.approvals, { approvalId: randomUUID(), recordId: archiveId, decision: "APPROVED", reviewer: actor, decisionId: decision, decidedAt: now }], history: [...record.history, event(record, "APPROVED", now, actor, null)] };
  await repository.save(next); return structuredClone(next);
}

export async function rejectMarketArchive(repository: MarketArchiveRepository, tenantId: string, archiveId: string, reviewer: string, reason: string, at?: string): Promise<MarketArchiveRecord> {
  assertMarketTenantId(tenantId); if (typeof reason !== "string" || !reason.trim()) throw new Error("REJECTION_REASON_REQUIRED"); const record = await repository.get(tenantId, archiveId); if (!record) throw new Error("MARKET_ARCHIVE_NOT_FOUND"); if (record.status === "APPROVED") throw new Error("MARKET_RECORD_ALREADY_APPROVED"); const actor = actorValue(reviewer); const now = nowValue(at); const rejectedRecord = withApproval(record.record, { status: "REJECTED", reason: reason.trim() }); const next: MarketArchiveRecord = { ...record, updatedAt: now, status: "REJECTED", record: rejectedRecord, approvals: [...record.approvals, { approvalId: randomUUID(), recordId: archiveId, decision: "REJECTED", reviewer: actor, decisionId: `rejected-${archiveId}`, decidedAt: now }], history: [...record.history, event(record, "REJECTED", now, actor, reason.trim())] }; await repository.save(next); return structuredClone(next); }

function semverParts(version: string): number[] { return version.split(".").map((part) => Number.parseInt(part, 10)); }
function compareMarket(left: MarketArchiveRecord, right: MarketArchiveRecord): number { const l = semverParts(left.record.version); const r = semverParts(right.record.version); for (let index = 0; index < Math.max(l.length, r.length); index += 1) { const difference = (r[index] ?? 0) - (l[index] ?? 0); if (difference !== 0) return difference; } return (right.record.publicationDate ?? "").localeCompare(left.record.publicationDate ?? "") || right.updatedAt.localeCompare(left.updatedAt) || right.archiveId.localeCompare(left.archiveId); }

export async function queryApprovedHistoricalMarketData(repository: MarketArchiveRepository, tenantId: string, effectiveDate: string, vector?: "EE" | "GAS"): Promise<ReadonlyArray<MarketArchiveRecord>> {
  assertMarketTenantId(tenantId); const parsed = Date.parse(`${effectiveDate}T00:00:00.000Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== effectiveDate) throw new Error("EFFECTIVE_DATE_INVALID"); const records = await repository.list(tenantId); const matching = records.filter((record) => record.status === "APPROVED" && (vector === undefined || record.vector === vector) && record.record.effectiveFrom <= effectiveDate && (record.record.effectiveTo === null || effectiveDate < record.record.effectiveTo)).sort(compareMarket); const selected = new Map<string, MarketArchiveRecord>(); for (const record of matching) { const key = `${record.vector}:${record.index}:${record.month}`; if (!selected.has(key)) selected.set(key, record); } return [...selected.values()].map((record) => structuredClone(record));
}

export async function reviewMarketArchive(repository: MarketArchiveRepository, tenantId: string, archiveId: string, reviewer: string, at?: string): Promise<MarketArchiveRecord> {
  assertMarketTenantId(tenantId); const record = await repository.get(tenantId, archiveId); if (!record) throw new Error("MARKET_ARCHIVE_NOT_FOUND"); if (record.status !== "DRAFT" && record.status !== "REJECTED") throw new Error("MARKET_RECORD_NOT_REVIEWABLE"); const actor = actorValue(reviewer); const now = nowValue(at); const reviewed = withApproval(record.record, { status: "NEEDS_REVIEW", reason: "READY_FOR_APPROVAL" }); const next: MarketArchiveRecord = { ...record, updatedAt: now, status: "REVIEWED", record: reviewed, history: [...record.history, event(record, "REVIEWED", now, actor, null)] }; await repository.save(next); return structuredClone(next);
}

export async function getMarketArchiveHistory(repository: MarketArchiveRepository, tenantId: string, archiveId: string): Promise<ReadonlyArray<MarketArchiveRecord["history"][number]>> { const record = await repository.get(tenantId, archiveId); if (!record) throw new Error("MARKET_ARCHIVE_NOT_FOUND"); return structuredClone([...record.history].sort((left, right) => left.at.localeCompare(right.at) || left.eventId.localeCompare(right.eventId))); }

export const importMarketArchive = createMarketArchive;

export class MarketArchiveService {
  private readonly repository: MarketArchiveRepository;
  constructor(repository: MarketArchiveRepository) { this.repository = repository; }
  create(input: CreateMarketArchiveInput): Promise<MarketArchiveRecord> { return createMarketArchive(this.repository, input); }
  import(input: CreateMarketArchiveInput): Promise<MarketArchiveRecord> { return createMarketArchive(this.repository, input); }
  review(tenantId: string, archiveId: string, reviewer: string, at?: string): Promise<MarketArchiveRecord> { return reviewMarketArchive(this.repository, tenantId, archiveId, reviewer, at); }
  approve(tenantId: string, archiveId: string, reviewer: string, decisionId: string, at?: string): Promise<MarketArchiveRecord> { return approveMarketArchive(this.repository, tenantId, archiveId, reviewer, decisionId, at); }
  reject(tenantId: string, archiveId: string, reviewer: string, reason: string, at?: string): Promise<MarketArchiveRecord> { return rejectMarketArchive(this.repository, tenantId, archiveId, reviewer, reason, at); }
  history(tenantId: string, archiveId: string): Promise<ReadonlyArray<MarketArchiveRecord["history"][number]>> { return getMarketArchiveHistory(this.repository, tenantId, archiveId); }
  historical(tenantId: string, effectiveDate: string, vector?: "EE" | "GAS"): Promise<ReadonlyArray<MarketArchiveRecord>> { return queryApprovedHistoricalMarketData(this.repository, tenantId, effectiveDate, vector); }
}
