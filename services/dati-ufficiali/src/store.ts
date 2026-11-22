import type { PutRecordInput, TenantRecord, TenantRecordRepository } from "../../../app/lib/persistence/types";
import type { MarketArchiveRecord, MarketArchiveRepository } from "../../../app/lib/market/types";
import { validateStoredMarketArchive } from "../../../app/lib/market/validation";

/**
 * Tony (21/11/2026, punti 8 e 9; Fase B): the service reuses the existing archive (table runtime_records) through the functions of
 * schema servizio_dati (database.ts), and can touch only the official data collections below. Bills, CTE, customers,
 * offers, proposals, users and companies cannot even be opened for writing, and no repository of the service can delete.
 */
export const WRITABLE_COLLECTIONS = [
  "market-archives",
  "regulatory-values",
  "regulatory-approval-domains",
  "audit-events",
  "regulatory-refresh-state",
  "regulatory-refresh-runs",
  "official-alerts",
  "official-checks",
  "official-service-documents",
  "official-service-runs",
  "official-service-audits",
  "official-service-locks",
] as const;
/** Read only: the list of client companies, to publish the official data to each of them. */
export const READ_ONLY_COLLECTIONS = ["companies"] as const;
/** Written once, never rewritten (documents, runs, audits, checks, approval audit). */
export const APPEND_ONLY_COLLECTIONS: readonly string[] = ["official-service-documents", "official-service-runs", "official-service-audits", "official-checks", "audit-events", "regulatory-refresh-runs"];

export type WritableCollection = (typeof WRITABLE_COLLECTIONS)[number];
export type ReadOnlyCollection = (typeof READ_ONLY_COLLECTIONS)[number];
export type ReadOnlyRepository<T> = Pick<TenantRecordRepository<T>, "get" | "list">;

/** Raw access to runtime_records for one collection (servizio_dati functions in database.ts, or memory in the tests). */
export interface RecordBackend {
  get(collection: string, tenantId: string, recordId: string): Promise<TenantRecord<unknown> | null>;
  list(collection: string, tenantId: string): Promise<readonly TenantRecord<unknown>[]>;
  write(collection: string, input: PutRecordInput<unknown>, appendOnly: boolean): Promise<TenantRecord<unknown>>;
}

export interface ServiceStore {
  writable<T = unknown>(collection: WritableCollection): TenantRecordRepository<T>;
  readOnly<T = unknown>(collection: ReadOnlyCollection): ReadOnlyRepository<T>;
  market(): MarketArchiveRepository;
}

const TENANT = /^tenant_[a-z0-9-]+$/;
const RECORD = /^[A-Za-z0-9._:-]{1,160}$/;
const fail = (code: string): never => { throw new Error(code); };

/** The guard: unknown collection → refused; put on an append-only collection → refused; no delete exists. */
export function createServiceStore(backend: RecordBackend): ServiceStore {
  const writable = new Set<string>(WRITABLE_COLLECTIONS);
  const readable = new Set<string>([...WRITABLE_COLLECTIONS, ...READ_ONLY_COLLECTIONS]);
  const check = (collection: string, tenantId: string, recordId?: string) => {
    if (!readable.has(collection)) fail(`SERVICE_COLLECTION_FORBIDDEN:${collection}`);
    if (!TENANT.test(tenantId)) fail("SERVICE_TENANT_INVALID");
    if (recordId !== undefined && (!RECORD.test(recordId) || recordId.includes(".."))) fail("SERVICE_RECORD_ID_INVALID");
  };
  const repository = <T>(collection: string): TenantRecordRepository<T> => {
    if (!writable.has(collection)) fail(`SERVICE_COLLECTION_NOT_WRITABLE:${collection}`);
    return {
      async get(tenantId, recordId) { check(collection, tenantId, recordId); return (await backend.get(collection, tenantId, recordId)) as TenantRecord<T> | null; },
      async list(tenantId) { check(collection, tenantId); return (await backend.list(collection, tenantId)) as readonly TenantRecord<T>[]; },
      async put(input) {
        check(collection, input.tenantId, input.recordId);
        if (APPEND_ONLY_COLLECTIONS.includes(collection)) fail(`SERVICE_COLLECTION_APPEND_ONLY:${collection}`);
        return (await backend.write(collection, input as PutRecordInput<unknown>, false)) as TenantRecord<T>;
      },
      async append(input) { check(collection, input.tenantId, input.recordId); return (await backend.write(collection, input as PutRecordInput<unknown>, true)) as TenantRecord<T>; },
    };
  };
  return {
    writable: <T>(collection: WritableCollection) => repository<T>(collection),
    readOnly: <T>(collection: ReadOnlyCollection): ReadOnlyRepository<T> => {
      if (!(READ_ONLY_COLLECTIONS as readonly string[]).includes(collection)) fail(`SERVICE_COLLECTION_FORBIDDEN:${collection}`);
      return {
        async get(tenantId, recordId) { check(collection, tenantId, recordId); return (await backend.get(collection, tenantId, recordId)) as TenantRecord<T> | null; },
        async list(tenantId) { check(collection, tenantId); return (await backend.list(collection, tenantId)) as readonly TenantRecord<T>[]; },
      };
    },
    market(): MarketArchiveRepository {
      const records = repository<MarketArchiveRecord>("market-archives");
      return {
        async get(tenantId, archiveId) { const record = await records.get(tenantId, archiveId); return record ? validateStoredMarketArchive(record.payload) : null; },
        async list(tenantId) { return (await records.list(tenantId)).map((record) => validateStoredMarketArchive(record.payload)); },
        async save(record) {
          const valid = validateStoredMarketArchive(record);
          const previous = await records.get(valid.tenantId, valid.archiveId);
          await records.put({ tenantId: valid.tenantId, recordId: valid.archiveId, payload: valid, expectedVersion: previous?.version });
        },
      };
    },
  };
}

/** In-memory runtime_records with the same append-only and version rules (tests and local dry runs). */
export function memoryBackend(seed: readonly { readonly collection: string; readonly tenantId: string; readonly recordId: string; readonly payload: unknown }[] = []): RecordBackend & { readonly rows: Map<string, TenantRecord<unknown> & { collection: string }>; readonly writes: { collection: string; recordId: string; tenantId: string }[] } {
  const rows = new Map<string, TenantRecord<unknown> & { collection: string }>();
  const writes: { collection: string; recordId: string; tenantId: string }[] = [];
  const key = (collection: string, tenantId: string, recordId: string) => `${collection}|${tenantId}|${recordId}`;
  const at = "2026-11-01T00:00:00.000Z";
  for (const item of seed) rows.set(key(item.collection, item.tenantId, item.recordId), { collection: item.collection, schemaVersion: 1, recordId: item.recordId, tenantId: item.tenantId, version: 1, createdAt: at, updatedAt: at, payload: structuredClone(item.payload) });
  return {
    rows, writes,
    async get(collection, tenantId, recordId) { const row = rows.get(key(collection, tenantId, recordId)); return row ? structuredClone(row) : null; },
    async list(collection, tenantId) { return [...rows.values()].filter((row) => row.collection === collection && row.tenantId === tenantId).sort((a, b) => a.recordId.localeCompare(b.recordId)).map((row) => structuredClone(row)); },
    async write(collection, input, appendOnly) {
      const id = key(collection, input.tenantId, input.recordId);
      const existing = rows.get(id);
      if (existing && appendOnly) {
        if (input.idempotencyKey && existing.idempotencyKey === input.idempotencyKey) return structuredClone(existing);
        fail("PERSISTENCE_APPEND_ONLY_CONFLICT");
      }
      if (existing && input.expectedVersion !== undefined && existing.version !== input.expectedVersion) fail("PERSISTENCE_VERSION_CONFLICT");
      if (!existing && input.expectedVersion !== undefined) fail("PERSISTENCE_VERSION_CONFLICT");
      const now = input.now ?? new Date().toISOString();
      const row = { collection, schemaVersion: 1 as const, recordId: input.recordId, tenantId: input.tenantId, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now, payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
      rows.set(id, row); writes.push({ collection, recordId: input.recordId, tenantId: input.tenantId });
      return structuredClone(row);
    },
  };
}
