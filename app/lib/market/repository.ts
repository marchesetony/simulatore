import path from "node:path";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { atomicWriteJson, readJsonFile } from "../archive/atomic.ts";
import type { MarketArchiveRecord, MarketArchiveRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertMarketTenantId, validateStoredMarketArchive } from "./validation.ts";

type MarketArchiveStore = { readonly schemaVersion: 1; readonly records: readonly MarketArchiveRecord[] };
export type MarketRepository = MarketArchiveRepository;
function archiveRoot(rootDir?: string): string { return path.resolve(rootDir ?? path.join(/* turbopackIgnore: true */ process.cwd(), "var", "market-archive")); }
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function immutableRecord(value: MarketArchiveRecord): unknown { const copy = structuredClone(value.record) as { approval: unknown }; delete copy.approval; return copy; }
function allowedStatusTransition(from: MarketArchiveRecord["status"], to: MarketArchiveRecord["status"]): boolean { return (from === "DRAFT" && ["REVIEWED", "APPROVED", "REJECTED"].includes(to)) || (from === "REVIEWED" && ["APPROVED", "REJECTED"].includes(to)) || (from === "REJECTED" && ["REVIEWED", "APPROVED"].includes(to)); }
function assertAppendOnly(previous: MarketArchiveRecord, next: MarketArchiveRecord): void {
  if (next.history.length < previous.history.length || next.approvals.length < previous.approvals.length) throw new Error("ARCHIVE_APPEND_ONLY_VIOLATION");
  for (let index = 0; index < previous.history.length; index += 1) if (!equal(previous.history[index], next.history[index])) throw new Error("ARCHIVE_HISTORY_IMMUTABLE");
  for (let index = 0; index < previous.approvals.length; index += 1) if (!equal(previous.approvals[index], next.approvals[index])) throw new Error("ARCHIVE_APPROVAL_HISTORY_IMMUTABLE");
  if (!equal(immutableRecord(previous), immutableRecord(next)) || previous.record.recordId !== next.record.recordId || previous.record.version !== next.record.version) throw new Error("ARCHIVE_VERSION_IMMUTABLE");
  if (previous.status === next.status && !equal(previous.record.approval, next.record.approval)) throw new Error("ARCHIVE_APPROVAL_METADATA_IMMUTABLE");
  if (previous.status !== next.status && !allowedStatusTransition(previous.status, next.status)) throw new Error("ARCHIVE_STATUS_TRANSITION_INVALID");
}

export class LocalMarketArchiveRepository implements MarketArchiveRepository {
  private readonly file: string;
  constructor(rootDir?: string) { this.file = path.join(archiveRoot(rootDir), "metadata.json"); }
  async get(tenantId: string, archiveId: string): Promise<MarketArchiveRecord | null> { assertMarketTenantId(tenantId); const store = await this.readStore(); const record = store.records.find((candidate) => candidate.tenantId === tenantId && candidate.archiveId === archiveId); return record ? structuredClone(record) : null; }
  async list(tenantId: string): Promise<ReadonlyArray<MarketArchiveRecord>> { assertMarketTenantId(tenantId); const store = await this.readStore(); return store.records.filter((candidate) => candidate.tenantId === tenantId).map((candidate) => structuredClone(candidate)); }
  async save(record: MarketArchiveRecord): Promise<void> { validateStoredMarketArchive(record); const store = await this.readStore(); const previous = store.records.find((candidate) => candidate.tenantId === record.tenantId && candidate.archiveId === record.archiveId); if (previous) assertAppendOnly(previous, record); const duplicateApproved = store.records.some((candidate) => candidate.tenantId === record.tenantId && candidate.status === "APPROVED" && record.status === "APPROVED" && candidate.archiveId !== record.archiveId && candidate.vector === record.vector && candidate.index === record.index && candidate.month === record.month && candidate.record.version === record.record.version); if (duplicateApproved) throw new Error("MARKET_APPROVED_DUPLICATE"); const records = store.records.filter((candidate) => !(candidate.tenantId === record.tenantId && candidate.archiveId === record.archiveId)); await atomicWriteJson(this.file, { schemaVersion: 1, records: [...records, structuredClone(record)] }); }
  private async readStore(): Promise<MarketArchiveStore> { const value = await readJsonFile<unknown>(this.file, { schemaVersion: 1, records: [] }); if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ARCHIVE_STORE_CORRUPT"); const item = value as Record<string, unknown>; if (item.schemaVersion !== 1 || !Array.isArray(item.records)) throw new Error("ARCHIVE_STORE_CORRUPT"); const records = item.records.map(validateStoredMarketArchive); const keys = new Set<string>(); for (const record of records) { const key = `${record.tenantId}:${record.archiveId}`; if (keys.has(key)) throw new Error("ARCHIVE_STORE_CORRUPT"); keys.add(key); } return { schemaVersion: 1, records }; }
}

export { LocalMarketArchiveRepository as LocalMarketRepository };
