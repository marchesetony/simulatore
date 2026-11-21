import type { PutRecordInput, TenantRecord, TenantRecordRepository } from "../../../app/lib/persistence/types";
import type { MarketArchiveRecord, MarketArchiveRepository } from "../../../app/lib/market/types";
import { validateStoredMarketArchive } from "../../../app/lib/market/validation";

/**
 * Tony (21/11/2026, punti 8 e 9): the service reuses the existing Supabase archive (table runtime_records, RPC
 * runtime_put_record) with no migration, and can touch only the official data collections below. Bills, CTE, customers,
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

/** Raw access to runtime_records for one collection (Supabase REST or memory in the tests). */
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

type Row = { readonly collection: string; readonly tenant_id: string; readonly record_id: string; readonly schema_version: number; readonly version: number; readonly created_at: string; readonly updated_at: string; readonly payload: unknown; readonly idempotency_key?: string | null };
const toRecord = (row: Row): TenantRecord<unknown> => {
  if (row.schema_version !== 1 || !Number.isSafeInteger(row.version) || row.version < 1 || row.payload === undefined) fail("SERVICE_DATA_INVALID");
  return { schemaVersion: 1, recordId: row.record_id, tenantId: row.tenant_id, version: row.version, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), payload: structuredClone(row.payload), ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}) } as TenantRecord<unknown>;
};
const COLUMNS = "collection,tenant_id,record_id,schema_version,version,created_at,updated_at,payload,idempotency_key";

/**
 * Supabase through its REST interface only (no SDK): the same table and RPC the simulator uses, so no migration. The key is read
 * from the environment by the caller and never logged or returned.
 */
export function supabaseRestBackend(input: { readonly url: string; readonly key: string; readonly fetchImpl?: typeof fetch }): RecordBackend {
  if (!/^https:\/\/[-a-z0-9]+\.supabase\.co$/i.test(input.url)) fail("SERVICE_SUPABASE_URL_INVALID");
  if (!input.key) fail("SERVICE_SUPABASE_KEY_MISSING");
  const doFetch = input.fetchImpl ?? fetch;
  const headers = { apikey: input.key, Authorization: `Bearer ${input.key}`, "Content-Type": "application/json", "x-application-name": "servizio-dati-ufficiali" };
  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await doFetch(`${input.url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok) {
      let code = `SUPABASE_HTTP_${response.status}`;
      try { const body = JSON.parse(text) as { code?: string; message?: string }; const message = (body.message ?? "").trim(); if (/^[A-Z0-9_]{3,80}$/.test(message)) code = message; else if (body.code) code = `SUPABASE_${body.code}`; } catch { /* body is not JSON */ }
      fail(code);
    }
    return text ? JSON.parse(text) : null;
  };
  const q = (value: string) => encodeURIComponent(value);
  return {
    async get(collection, tenantId, recordId) {
      const rows = await call(`runtime_records?select=${COLUMNS}&collection=eq.${q(collection)}&tenant_id=eq.${q(tenantId)}&record_id=eq.${q(recordId)}&limit=1`) as Row[];
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async list(collection, tenantId) {
      const rows = await call(`runtime_records?select=${COLUMNS}&collection=eq.${q(collection)}&tenant_id=eq.${q(tenantId)}&order=record_id.asc`) as Row[];
      return rows.map(toRecord);
    },
    async write(collection, record, appendOnly) {
      const result = await call("rpc/runtime_put_record", { method: "POST", body: JSON.stringify({ p_collection: collection, p_tenant_id: record.tenantId, p_record_id: record.recordId, p_payload: record.payload, p_expected_version: record.expectedVersion ?? null, p_idempotency_key: record.idempotencyKey ?? null, p_now: record.now ?? null, p_append_only: appendOnly }) }) as Row | Row[];
      const row = Array.isArray(result) ? result[0] : result;
      if (!row) fail("SERVICE_PERSISTENCE_EMPTY_RESULT");
      return toRecord(row);
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
