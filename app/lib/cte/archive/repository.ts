// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { readJsonFile, atomicWriteJson } from "../../archive/atomic.ts";
import path from "node:path";
import type { CteArchiveRecord, CteArchiveRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertTenantId, validateStoredCteArchive } from "./validation.ts";

type CteArchiveStore = { readonly schemaVersion: 1; readonly records: readonly CteArchiveRecord[] };
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

  async get(tenantId: string, archiveId: string): Promise<CteArchiveRecord | null> {
    assertTenantId(tenantId);
    const store = await this.readStore();
    const record = store.records.find((candidate) => candidate.tenantId === tenantId && candidate.archiveId === archiveId);
    return record ? structuredClone(record) : null;
  }

  async list(tenantId: string): Promise<ReadonlyArray<CteArchiveRecord>> {
    assertTenantId(tenantId);
    const store = await this.readStore();
    return store.records.filter((candidate) => candidate.tenantId === tenantId).map((candidate) => structuredClone(candidate));
  }

  async save(record: CteArchiveRecord): Promise<void> {
    validateStoredCteArchive(record);
    const store = await this.readStore();
    const previous = store.records.find((candidate) => candidate.tenantId === record.tenantId && candidate.archiveId === record.archiveId);
    if (previous) assertAppendOnly(previous, record);
    const records = store.records.filter((candidate) => !(candidate.tenantId === record.tenantId && candidate.archiveId === record.archiveId));
    await atomicWriteJson(this.file, { schemaVersion: 1, records: [...records, structuredClone(record)] });
  }

  private async readStore(): Promise<CteArchiveStore> {
    const value = await readJsonFile<unknown>(this.file, { schemaVersion: 1, records: [] });
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ARCHIVE_STORE_CORRUPT");
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== 1 || !Array.isArray(item.records)) throw new Error("ARCHIVE_STORE_CORRUPT");
    const records = item.records.map(validateStoredCteArchive);
    const keys = new Set<string>();
    for (const record of records) {
      const key = `${record.tenantId}:${record.archiveId}`;
      if (keys.has(key)) throw new Error("ARCHIVE_STORE_CORRUPT");
      keys.add(key);
    }
    return { schemaVersion: 1, records };
  }
}

export { LocalCteArchiveRepository as LocalCteRepository };
