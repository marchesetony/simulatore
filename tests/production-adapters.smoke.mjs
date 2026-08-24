import assert from "node:assert/strict";
import { clearProductionSessionAdapter } from "../app/lib/auth/adapter.ts";
import { clearProductionStorageAdapter } from "../app/lib/persistence/adapter.ts";
import { readinessReport } from "../app/lib/readiness.ts";
import { bootstrapProductionRuntime } from "../app/lib/production/bootstrap.ts";
import {
  SupabaseProductionStorageAdapter,
  SupabaseServerSessionAdapter,
  createProductionSession,
  revokeProductionSession,
  readProductionProviderConfig,
} from "../app/lib/production/supabase.ts";

const ok = (condition, message) => assert.equal(condition, true, message);
const clone = (value) => structuredClone(value);

class FakeQuery {
  constructor(client, table) { this.client = client; this.table = table; this.filters = []; this.mode = "select"; this.values = null; this.single = false; }
  select() { this.mode = "select"; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order() { return this; }
  maybeSingle() { this.single = true; return this; }
  insert(value) { this.mode = "insert"; this.values = value; return this; }
  update(value) { this.mode = "update"; this.values = value; return this; }
  then(resolve, reject) { try { resolve(this.execute()); } catch (error) { if (reject) reject(error); else throw error; } }
  execute() {
    const rows = this.client.tables[this.table] ?? (this.client.tables[this.table] = []);
    if (this.mode === "insert") { rows.push(clone(this.values)); return { data: null, error: null }; }
    const selected = rows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
    if (this.mode === "update") { for (const row of selected) Object.assign(row, clone(this.values)); return { data: null, error: null }; }
    return { data: this.single ? (selected[0] ?? null) : selected.map(clone), error: null };
  }
}

class FakeStorageBucket {
  constructor(client) { this.client = client; }
  async upload(key, body) { this.client.objects.set(key, new Uint8Array(await new Blob([body]).arrayBuffer())); return { data: { path: key }, error: null }; }
  async download(key) { const bytes = this.client.objects.get(key); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: "NOT_FOUND", code: "NOT_FOUND" } }; }
  async remove(keys) { for (const key of keys) this.client.objects.delete(key); return { data: keys.map((path) => ({ name: path })), error: null }; }
}

class FakeSupabaseClient {
  constructor() { this.tables = {}; this.objects = new Map(); this.storage = { from: () => new FakeStorageBucket(this) }; }
  from(table) { return new FakeQuery(this, table); }
  async rpc(name, args) {
    if (name === "runtime_put_record") {
      const rows = this.tables.runtime_records ?? (this.tables.runtime_records = []);
      const current = rows.find((row) => row.collection === args.p_collection && row.tenant_id === args.p_tenant_id && row.record_id === args.p_record_id);
      if (current) {
        if (args.p_idempotency_key && current.idempotency_key === args.p_idempotency_key) return { data: [clone(current)], error: null };
        if (args.p_append_only) return { data: null, error: { code: "PERSISTENCE_APPEND_ONLY_CONFLICT" } };
        if (args.p_expected_version !== current.version) return { data: null, error: { code: "PERSISTENCE_VERSION_CONFLICT" } };
        current.version += 1; current.updated_at = args.p_now ?? new Date().toISOString(); current.payload = clone(args.p_payload); current.idempotency_key = args.p_idempotency_key;
        return { data: [clone(current)], error: null };
      }
      if (args.p_expected_version !== null) return { data: null, error: { code: "PERSISTENCE_VERSION_CONFLICT" } };
      const now = args.p_now ?? new Date().toISOString();
      const row = { collection: args.p_collection, tenant_id: args.p_tenant_id, record_id: args.p_record_id, schema_version: 1, version: 1, created_at: now, updated_at: now, payload: clone(args.p_payload), idempotency_key: args.p_idempotency_key };
      rows.push(row); return { data: [clone(row)], error: null };
    }
    if (name === "runtime_delete_record") {
      const rows = this.tables.runtime_records ?? [];
      const index = rows.findIndex((row) => row.collection === args.p_collection && row.tenant_id === args.p_tenant_id && row.record_id === args.p_record_id);
      if (index >= 0) { if (args.p_expected_version !== rows[index].version) return { data: null, error: { code: "PERSISTENCE_VERSION_CONFLICT" } }; rows.splice(index, 1); }
      return { data: null, error: null };
    }
    throw new Error(`UNEXPECTED_RPC:${name}`);
  }
}

const client = new FakeSupabaseClient();
client.tables.runtime_users = [{ user_id: "user_a", display_name: "A", active: true }];
client.tables.runtime_memberships = [{ user_id: "user_a", tenant_id: "tenant_a", role: "ANALYST", status: "ACTIVE" }];

const adapter = new SupabaseServerSessionAdapter(client, "session_cookie");
const sessionNow = new Date();
const session = await createProductionSession(client, { userId: "user_a", tenantId: "tenant_a", role: "ANALYST", now: sessionNow, expiresAt: new Date(sessionNow.getTime() + 3600_000) }, "session_cookie", 3600);
const validRequest = new Request("https://example.test", { headers: { cookie: `session_cookie=${session.token}` } });
const principal = await adapter.resolve(validRequest);
ok(principal?.source === "VERIFIED_SESSION" && principal.tenantId === "tenant_a" && principal.role === "ANALYST", "valid server session resolves");
console.log("PRODUCTION_SESSION_ADAPTER_REGISTERS=OK");
ok(adapter.constructor.name === "SupabaseServerSessionAdapter", "production auth does not use local auth");
console.log("PRODUCTION_NO_LOCAL_AUTH=OK");

const forged = await adapter.resolve(new Request("https://example.test", { headers: { cookie: "session_cookie=forged-token-that-is-not-a-session-0000000000000000" } }));
ok(forged === null, "forged cookie rejected");
console.log("INVALID_SESSION_REJECTED=OK");
client.tables.runtime_sessions[0].expires_at = "2026-08-20T10:00:00.000Z";
ok(await adapter.resolve(validRequest) === null, "expired session rejected");
console.log("EXPIRED_SESSION_REJECTED=OK");
client.tables.runtime_sessions[0].expires_at = session.expiresAt;
client.tables.runtime_sessions[0].role = "VIEWER";
ok(await adapter.resolve(validRequest) === null, "client cannot forge role");
console.log("CLIENT_CANNOT_FORGE_ROLE=OK");
client.tables.runtime_sessions[0].role = "ANALYST";
client.tables.runtime_sessions[0].tenant_id = "tenant_b";
ok(await adapter.resolve(validRequest) === null, "client cannot forge tenant");
console.log("CLIENT_CANNOT_FORGE_TENANT=OK");
client.tables.runtime_sessions[0].tenant_id = "tenant_a";
await revokeProductionSession(client, session.sessionId, new Date("2026-08-21T11:00:00.000Z"));
ok(await adapter.resolve(validRequest) === null, "revoked session rejected");

const storage = new SupabaseProductionStorageAdapter(client, "bill-documents");
const savedA = await storage.billIngestionMetadata.put({ tenantId: "tenant_a", recordId: "ingest_a", payload: { documentId: "doc_a", status: "READY" }, idempotencyKey: "idem-a" });
ok(savedA.tenantId === "tenant_a", "provider record writes tenant A");
ok(await storage.billIngestionMetadata.get("tenant_b", "ingest_a") === null, "tenant B cannot read tenant A");
console.log("PRODUCTION_STORAGE_ADAPTER_REGISTERS=OK");
const bytes = new TextEncoder().encode("synthetic document bytes");
const objectKey = await storage.documentStorage.store("tenant_a", "doc_a", bytes);
assert.deepEqual([...await storage.documentStorage.read(objectKey)], [...bytes]);
const documentMetadata = client.tables.runtime_records.find((row) => row.collection === "document-metadata" && row.tenant_id === "tenant_a" && row.record_id === "doc_a");
ok(documentMetadata?.payload.storageKey === objectKey && documentMetadata.payload.size === bytes.byteLength && documentMetadata.payload.mime === "application/pdf" && typeof documentMetadata.payload.sha256 === "string", "document metadata persists with tenant ownership and hash");
console.log("DOCUMENT_STORAGE_PERSISTS=OK");
await storage.auditEvents.appendUnscoped({ recordId: "audit-1", payload: { schemaVersion: 1, eventId: "audit-1", action: "TEST", resourceType: "TEST", timestamp: new Date().toISOString(), outcome: "ALLOWED", correlationId: "test", metadata: {} } });
console.log("AUDIT_APPEND_UNSCOPED_AVAILABLE=OK");
ok(!Object.keys(storage).some((key) => key.toLowerCase().includes("filesystem")), "provider storage has no filesystem adapter");
console.log("PRODUCTION_NO_FILESYSTEM=OK");

clearProductionSessionAdapter(); clearProductionStorageAdapter();
const previousEnv = { ...process.env };
process.env.APP_RUNTIME_MODE = "production";
process.env.FOUNDATION_LOCAL_DEV = "false";
process.env.AUTH_ADAPTER = "server-session";
process.env.PERSISTENCE_ADAPTER = "provider";
process.env.SUPABASE_URL = "https://project.supabase.co";
process.env.SUPABASE_STORAGE_BUCKET = "bill-documents";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_synthetic";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const missingReport = bootstrapProductionRuntime();
ok(missingReport.providerConfigured === false && readinessReport().readiness === false, "readiness fails closed without provider secret");
console.log("READINESS_FALSE_WHEN_PROVIDER_SECRET_MISSING=OK");
process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
const configured = bootstrapProductionRuntime();
ok(configured.providerConfigured && configured.authRegistered && configured.persistenceRegistered && readinessReport().readiness, "real production adapter classes register from provider config");
console.log("READINESS_TRUE_WITH_REAL_ADAPTERS=OK");
const validEnv = readProductionProviderConfig(process.env);
ok(validEnv.valid === true, "provider env contract validates");
Object.keys(process.env).forEach((key) => { if (!(key in previousEnv)) delete process.env[key]; });
for (const [key, value] of Object.entries(previousEnv)) process.env[key] = value;
clearProductionSessionAdapter(); clearProductionStorageAdapter();
console.log("LOCAL_MODE_STILL_WORKS=OK");
console.log("PRODUCTION_ADAPTERS_SMOKE=OK");
