// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { readJsonFile, atomicWriteJson } from "../../archive/atomic.ts";
import path from "node:path";
import type { CteArchiveExclusion, CteArchiveListResult, CteArchiveRecord, CteArchiveRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { CTE_ARCHIVE_APPROVAL_CAPABILITY } from "./types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertTenantId, CteArchiveRecordUnreadableError, logExcludedCteArchives, storedCteErrorCode, validateStoredCteArchive } from "./validation.ts";

type CteArchiveStore = { readonly schemaVersion: 1; readonly records: readonly CteArchiveRecord[] };
/** An unreadable stored entry: kept byte for byte in the file on every write, never shown, never rewritten. */
type UnreadableEntry = CteArchiveExclusion & { readonly raw: unknown };
type ReadStore = CteArchiveStore & { readonly unreadable: readonly UnreadableEntry[] };
export type CteRepository = CteArchiveRepository;

function archiveRoot(rootDir?: string): string {
  return path.resolve(rootDir ?? path.join(/* turbopackIgnore: true */ process.cwd(), "var", "cte-archive"));
}

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function immutableVersion(value: CteArchiveRecord["versions"][number]): unknown {
  const copy = structuredClone(value) as { status: unknown; contract: { approval: unknown } };
  delete copy.status;
  delete copy.contract.approval;
  return copy;
}
function allowedStatusTransition(from: CteArchiveRecord["versions"][number]["status"], to: CteArchiveRecord["versions"][number]["status"]): boolean {
  return (from === "DRAFT" && ["REVIEWED", "APPROVED", "REJECTED"].includes(to))
    || (from === "REVIEWED" && ["APPROVED", "REJECTED"].includes(to))
    || (from === "REJECTED" && ["REVIEWED", "APPROVED"].includes(to))
    || (from === "APPROVED" && to === "EXPIRED");
}
function assertAppendOnly(previous: CteArchiveRecord, next: CteArchiveRecord): void {
  if (next.versions.length < previous.versions.length || next.history.length < previous.history.length || next.approvals.length < previous.approvals.length) throw new Error("ARCHIVE_APPEND_ONLY_VIOLATION");
  const previousIds = new Set(previous.versions.map((version) => version.versionId));
  const previousMaximum = Math.max(...previous.versions.map((version) => version.versionNumber));
  if (next.versions.slice(0, previous.versions.length).some((version, index) => version.versionId !== previous.versions[index].versionId) || next.versions.filter((version) => !previousIds.has(version.versionId)).some((version) => version.versionNumber <= previousMaximum)) throw new Error("ARCHIVE_VERSION_ORDER_INVALID");
  for (let index = 0; index < previous.history.length; index += 1) if (!equal(previous.history[index], next.history[index])) throw new Error("ARCHIVE_HISTORY_IMMUTABLE");
  for (let index = 0; index < previous.approvals.length; index += 1) if (!equal(previous.approvals[index], next.approvals[index])) throw new Error("ARCHIVE_APPROVAL_HISTORY_IMMUTABLE");
  for (const oldVersion of previous.versions) {
    const current = next.versions.find((candidate) => candidate.versionId === oldVersion.versionId);
    if (!current || current.versionNumber !== oldVersion.versionNumber || current.supersedesVersionId !== oldVersion.supersedesVersionId || !equal(immutableVersion(oldVersion), immutableVersion(current))) throw new Error("ARCHIVE_VERSION_IMMUTABLE");
    if (oldVersion.status === current.status && !equal(oldVersion.contract.approval, current.contract.approval)) throw new Error("ARCHIVE_APPROVAL_METADATA_IMMUTABLE");
    if (current.status !== oldVersion.status && !allowedStatusTransition(oldVersion.status, current.status)) throw new Error("ARCHIVE_STATUS_TRANSITION_INVALID");
  }
}

export class LocalCteArchiveRepository implements CteArchiveRepository {
  private readonly file: string;

  constructor(rootDir?: string) { this.file = path.join(archiveRoot(rootDir), "metadata.json"); }

  // Tony (9/11/2026, "lettura tollerante, scrittura rigorosa"): an unreadable entry no longer stops the other CTEs of the
  // same company or of other companies; a single read of it is an explicit error and every write keeps it untouched.
  async get(tenantId: string, archiveId: string): Promise<CteArchiveRecord | null> {
    assertTenantId(tenantId);
    const store = await this.readStore();
    const unreadable = store.unreadable.find((entry) => entry.tenantId === tenantId && entry.archiveId === archiveId);
    if (unreadable) throw new CteArchiveRecordUnreadableError(tenantId, archiveId, unreadable.code);
    const record = store.records.find((candidate) => candidate.tenantId === tenantId && candidate.archiveId === archiveId);
    return record ? structuredClone(record) : null;
  }

  async listWithExclusions(tenantId: string): Promise<CteArchiveListResult> {
    assertTenantId(tenantId);
    const store = await this.readStore();
    const excluded = store.unreadable.filter((entry) => entry.tenantId === tenantId).map(({ tenantId: tenant, archiveId, code }) => ({ tenantId: tenant, archiveId, code }));
    logExcludedCteArchives(excluded);
    return { records: store.records.filter((candidate) => candidate.tenantId === tenantId).map((candidate) => structuredClone(candidate)), excluded };
  }

  async list(tenantId: string): Promise<ReadonlyArray<CteArchiveRecord>> {
    return (await this.listWithExclusions(tenantId)).records;
  }

  async save(record: CteArchiveRecord, capability?: symbol): Promise<void> {
    validateStoredCteArchive(record);
    const store = await this.readStore();
    const unreadable = store.unreadable.find((entry) => entry.tenantId === record.tenantId && entry.archiveId === record.archiveId);
    if (unreadable) throw new CteArchiveRecordUnreadableError(record.tenantId, record.archiveId, unreadable.code);
    const previous = store.records.find((candidate) => candidate.tenantId === record.tenantId && candidate.archiveId === record.archiveId);
    if (record.currentApprovedVersionId !== (previous?.currentApprovedVersionId ?? null) && capability !== CTE_ARCHIVE_APPROVAL_CAPABILITY) throw new Error("CTE_APPROVAL_WORKFLOW_REQUIRED");
    if (previous) assertAppendOnly(previous, record);
    const records = store.records.filter((candidate) => !(candidate.tenantId === record.tenantId && candidate.archiveId === record.archiveId));
    await atomicWriteJson(this.file, { schemaVersion: 1, records: [...records, ...store.unreadable.map((entry) => entry.raw), structuredClone(record)] });
  }

  async remove(tenantId: string, archiveId: string): Promise<void> {
    assertTenantId(tenantId);
    const store = await this.readStore();
    const unreadable = store.unreadable.find((entry) => entry.tenantId === tenantId && entry.archiveId === archiveId);
    if (unreadable) throw new CteArchiveRecordUnreadableError(tenantId, archiveId, unreadable.code);
    await atomicWriteJson(this.file, { schemaVersion: 1, records: [...store.records.filter((candidate) => !(candidate.tenantId === tenantId && candidate.archiveId === archiveId)), ...store.unreadable.map((entry) => entry.raw)] });
  }

  private async readStore(): Promise<ReadStore> {
    const value = await readJsonFile<unknown>(this.file, { schemaVersion: 1, records: [] });
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ARCHIVE_STORE_CORRUPT");
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== 1 || !Array.isArray(item.records)) throw new Error("ARCHIVE_STORE_CORRUPT");
    const records: CteArchiveRecord[] = [];
    const unreadable: UnreadableEntry[] = [];
    item.records.forEach((raw: unknown, index: number) => {
      try { records.push(validateStoredCteArchive(raw)); }
      catch (error) {
        const fields = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
        const tenantId = typeof fields.tenantId === "string" ? fields.tenantId : "unknown";
        const archiveId = typeof fields.archiveId === "string" ? fields.archiveId : `entry-${index}`;
        unreadable.push({ tenantId, archiveId, code: storedCteErrorCode(error), raw });
      }
    });
    const keys = new Set<string>();
    for (const record of [...records, ...unreadable]) {
      const key = `${record.tenantId}:${record.archiveId}`;
      if (keys.has(key)) throw new Error("ARCHIVE_STORE_CORRUPT");
      keys.add(key);
    }
    return { schemaVersion: 1, records, unreadable };
  }
}

export { LocalCteArchiveRepository as LocalCteRepository };
