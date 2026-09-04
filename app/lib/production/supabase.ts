import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ServerSessionAdapter } from "../auth/adapter.ts";
import type { AuthenticatedPrincipal, AuthRole } from "../auth/types.ts";
import type { ProductionStorageAdapter } from "../persistence/adapter.ts";
import type { DeleteRecordInput, PutRecordInput, TenantRecord, TenantRecordRepository, UnscopedAppendRepository, UnscopedRecord } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PERSISTENCE_SCHEMA_VERSION } from "../persistence/types.ts";
import type { BillDocument, BillRepository, DocumentStoragePort } from "../foundation/real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStoredDocument } from "../foundation/real-bill.ts";
import type { CteArchiveRecord, CteArchiveRepository } from "../cte/archive/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStoredCteArchive } from "../cte/archive/validation.ts";
import type { MarketArchiveRecord, MarketArchiveRepository } from "../market/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStoredMarketArchive } from "../market/validation.ts";
import type { RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
import type { RegulatoryApprovalDomainState } from "../regulatory-approval-domain.ts";
import type { AuditEvent, BillIngestionMetadata, CalculationResultRecord, CommercialProposalRecord, ComparisonResultRecord, DeletableTenantRecordRepository, ExportMetadataRecord, NormalizedBillSnapshot } from "../persistence/types.ts";

const TENANT_PATTERN = /^tenant_[a-z0-9-]+$/;
const USER_PATTERN = /^user_[a-z0-9-]+$/;
const SESSION_PATTERN = /^session_[a-z0-9-]+$/;
const RECORD_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const COOKIE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const UNSCOPED_TENANT = "__unscoped__";
const RUNTIME_RECORDS_TABLE = "runtime_records";

type ProviderClient = SupabaseClient;

type ProviderError = { readonly message?: string; readonly code?: string } | null;
type RuntimeRow = {
  readonly collection: string;
  readonly tenant_id: string;
  readonly record_id: string;
  readonly schema_version: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly payload: unknown;
  readonly idempotency_key?: string | null;
};
type DocumentMetadataRecord = {
  readonly documentId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly mime: "application/pdf";
  readonly size: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type QueryResult<T> = PromiseLike<{ readonly data: T; readonly error: ProviderError }>;

export type ProductionProviderConfig = {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly publishableKey: string;
  readonly storageBucket: string;
  readonly sessionCookieName: string;
  readonly sessionMaxAgeSeconds: number;
};

export type ProductionProviderConfigResult =
  | { readonly valid: true; readonly config: ProductionProviderConfig }
  | { readonly valid: false; readonly missing: readonly string[] };

export function readProductionProviderConfig(env: NodeJS.ProcessEnv = process.env): ProductionProviderConfigResult {
  const missing: string[] = [];
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const storageBucket = env.SUPABASE_STORAGE_BUCKET?.trim();
  if (!supabaseUrl || !/^https:\/\/[-a-z0-9]+\.supabase\.co$/i.test(supabaseUrl)) missing.push("SUPABASE_URL");
  if (!secretKey || !/^sb_secret_[A-Za-z0-9_-]{8,4096}$/.test(secretKey)) missing.push("SUPABASE_SECRET_KEY");
  if (!publishableKey || publishableKey.length > 4096) missing.push("SUPABASE_PUBLISHABLE_KEY");
  if (!storageBucket || !/^[a-z0-9][a-z0-9._-]{1,62}$/.test(storageBucket)) missing.push("SUPABASE_STORAGE_BUCKET");
  const cookieName = env.PRODUCTION_SESSION_COOKIE_NAME?.trim() || "__Host-simulatore_session";
  if (!/^__Host-[A-Za-z0-9_-]{1,80}$/.test(cookieName)) missing.push("PRODUCTION_SESSION_COOKIE_NAME");
  const configuredMaxAge = env.PRODUCTION_SESSION_MAX_AGE_SECONDS?.trim();
  const maxAge = configuredMaxAge === undefined ? 28_800 : Number(configuredMaxAge);
  if (!Number.isSafeInteger(maxAge) || maxAge < 900 || maxAge > 2_592_000) missing.push("PRODUCTION_SESSION_MAX_AGE_SECONDS");
  if (missing.length > 0) return { valid: false, missing: [...new Set(missing)] };
  return { valid: true, config: { supabaseUrl: supabaseUrl!, secretKey: secretKey!, publishableKey: publishableKey!, storageBucket: storageBucket!, sessionCookieName: cookieName, sessionMaxAgeSeconds: maxAge } };
}

export function createSupabaseProviderClient(config: ProductionProviderConfig): ProviderClient {
  return createClient(config.supabaseUrl, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "simulatore-production" } },
  });
}

export function createSupabaseAuthClient(config: ProductionProviderConfig): ProviderClient {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "simulatore-production-auth" } },
  });
}

function fail(code: string): never { throw new Error(code); }
function assertTenant(tenantId: string): void { if (!TENANT_PATTERN.test(tenantId)) fail("PERSISTENCE_TENANT_INVALID"); }
function assertRecordId(recordId: string): void { if (!RECORD_PATTERN.test(recordId) || recordId.includes("..")) fail("PERSISTENCE_RECORD_ID_INVALID"); }
function assertCollection(collection: string): void { if (!RECORD_PATTERN.test(collection) || collection.includes("..")) fail("PERSISTENCE_COLLECTION_INVALID"); }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value))) return fail("PERSISTENCE_TIMESTAMP_INVALID"); return new Date(value).toISOString(); }
function clone<T>(value: T): T { return structuredClone(value); }
function providerError(error: ProviderError, fallback: string): never { throw new Error(error?.code || fallback); }

async function unwrap<T>(query: QueryResult<T>): Promise<T> {
  const result = await query;
  if (result.error) providerError(result.error, "PERSISTENCE_PROVIDER_ERROR");
  return result.data;
}

function normalizeRuntimeRow<T>(row: RuntimeRow, tenantId: string, recordId: string): TenantRecord<T> {
  if (row.collection === "" || row.tenant_id !== tenantId || row.record_id !== recordId || row.schema_version !== PERSISTENCE_SCHEMA_VERSION || !Number.isSafeInteger(row.version) || row.version < 1 || !row.created_at || !row.updated_at || row.payload === undefined) fail("PERSISTENCE_DATA_INVALID");
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    recordId,
    tenantId,
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    payload: clone(row.payload as T),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
  };
}

function normalizeUnscopedRow<T>(row: RuntimeRow): UnscopedRecord<T> {
  if (row.tenant_id !== UNSCOPED_TENANT || row.schema_version !== PERSISTENCE_SCHEMA_VERSION || row.version !== 1 || row.payload === undefined) fail("PERSISTENCE_DATA_INVALID");
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    recordId: row.record_id,
    version: 1,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    payload: clone(row.payload as T),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
  };
}

export class SupabaseRecordRepository<TPayload> implements TenantRecordRepository<TPayload>, UnscopedAppendRepository<TPayload> {
  private readonly client: ProviderClient;
  private readonly collection: string;
  constructor(client: ProviderClient, collection: string) { this.client = client; this.collection = collection; assertCollection(collection); }

  private async row(tenantId: string, recordId: string): Promise<RuntimeRow | null> {
    assertTenant(tenantId); assertRecordId(recordId);
    const query = this.client.from(RUNTIME_RECORDS_TABLE).select("collection,tenant_id,record_id,schema_version,version,created_at,updated_at,payload,idempotency_key").eq("collection", this.collection).eq("tenant_id", tenantId).eq("record_id", recordId).maybeSingle();
    return unwrap(query as unknown as QueryResult<RuntimeRow | null>);
  }

  async get(tenantId: string, recordId: string): Promise<TenantRecord<TPayload> | null> {
    const row = await this.row(tenantId, recordId);
    return row ? normalizeRuntimeRow<TPayload>(row, tenantId, recordId) : null;
  }

  async list(tenantId: string): Promise<readonly TenantRecord<TPayload>[]> {
    assertTenant(tenantId);
    const query = this.client.from(RUNTIME_RECORDS_TABLE).select("collection,tenant_id,record_id,schema_version,version,created_at,updated_at,payload,idempotency_key").eq("collection", this.collection).eq("tenant_id", tenantId).order("record_id", { ascending: true });
    const rows = await unwrap(query as unknown as QueryResult<RuntimeRow[]>);
    return rows.map((row) => normalizeRuntimeRow<TPayload>(row, tenantId, row.record_id));
  }

  async put(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>> { return this.write(input, false); }
  async append(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>> { return this.write(input, true); }

  private async write(input: PutRecordInput<TPayload>, appendOnly: boolean): Promise<TenantRecord<TPayload>> {
    assertTenant(input.tenantId); assertRecordId(input.recordId);
    const query = this.client.rpc("runtime_put_record", {
      p_collection: this.collection,
      p_tenant_id: input.tenantId,
      p_record_id: input.recordId,
      p_payload: input.payload,
      p_expected_version: input.expectedVersion ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_now: input.now ?? null,
      p_append_only: appendOnly,
    });
    const result = await unwrap(query as unknown as QueryResult<RuntimeRow | RuntimeRow[]>);
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) fail("PERSISTENCE_PROVIDER_EMPTY_RESULT");
    return normalizeRuntimeRow<TPayload>(row, input.tenantId, input.recordId);
  }

  async appendUnscoped(input: Omit<PutRecordInput<TPayload>, "tenantId">): Promise<UnscopedRecord<TPayload>> {
    assertRecordId(input.recordId);
    const query = this.client.rpc("runtime_put_record", {
      p_collection: this.collection,
      p_tenant_id: UNSCOPED_TENANT,
      p_record_id: input.recordId,
      p_payload: input.payload,
      p_expected_version: null,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_now: input.now ?? null,
      p_append_only: true,
    });
    const result = await unwrap(query as unknown as QueryResult<RuntimeRow | RuntimeRow[]>);
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) fail("PERSISTENCE_PROVIDER_EMPTY_RESULT");
    return normalizeUnscopedRow<TPayload>(row);
  }

  async listUnscoped(): Promise<readonly UnscopedRecord<TPayload>[]> {
    const query = this.client.from(RUNTIME_RECORDS_TABLE).select("collection,tenant_id,record_id,schema_version,version,created_at,updated_at,payload,idempotency_key").eq("collection", this.collection).eq("tenant_id", UNSCOPED_TENANT).order("record_id", { ascending: true });
    const rows = await unwrap(query as unknown as QueryResult<RuntimeRow[]>);
    return rows.map((row) => normalizeUnscopedRow<TPayload>(row));
  }

  async delete(input: DeleteRecordInput): Promise<void> {
    assertTenant(input.tenantId); assertRecordId(input.recordId);
    const query = this.client.rpc("runtime_delete_record", { p_collection: this.collection, p_tenant_id: input.tenantId, p_record_id: input.recordId, p_expected_version: input.expectedVersion ?? null });
    await unwrap(query as unknown as QueryResult<unknown>);
  }
}

class SupabaseBillRepository implements BillRepository {
  private readonly records: SupabaseRecordRepository<BillDocument>;
  constructor(client: ProviderClient) { this.records = new SupabaseRecordRepository(client, "bills"); }
  async save(document: BillDocument): Promise<void> {
    const valid = validateStoredDocument(document);
    const previous = await this.records.get(valid.tenantId, valid.id);
    await this.records.put({ tenantId: valid.tenantId, recordId: valid.id, payload: valid, expectedVersion: previous?.version });
  }
  async get(tenantId: string, id: string): Promise<BillDocument | null> { const record = await this.records.get(tenantId, id); return record ? validateStoredDocument(record.payload) : null; }
  async list(tenantId: string): Promise<readonly BillDocument[]> { const records = await this.records.list(tenantId); return records.map((record) => validateStoredDocument(record.payload)).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)); }
  async delete(tenantId: string, id: string): Promise<void> { const record = await this.records.get(tenantId, id); if (record) await this.records.delete({ tenantId, recordId: id, expectedVersion: record.version }); }
}

class SupabaseCteArchiveRepository implements CteArchiveRepository {
  private readonly records: SupabaseRecordRepository<CteArchiveRecord>;
  constructor(client: ProviderClient) { this.records = new SupabaseRecordRepository(client, "cte-archives"); }
  async get(tenantId: string, archiveId: string): Promise<CteArchiveRecord | null> { const record = await this.records.get(tenantId, archiveId); return record ? validateStoredCteArchive(record.payload) : null; }
  async list(tenantId: string): Promise<ReadonlyArray<CteArchiveRecord>> { const records = await this.records.list(tenantId); return records.map((record) => validateStoredCteArchive(record.payload)); }
  async save(record: CteArchiveRecord): Promise<void> { const valid = validateStoredCteArchive(record); const previous = await this.records.get(valid.tenantId, valid.archiveId); await this.records.put({ tenantId: valid.tenantId, recordId: valid.archiveId, payload: valid, expectedVersion: previous?.version }); }
}

class SupabaseMarketArchiveRepository implements MarketArchiveRepository {
  private readonly records: SupabaseRecordRepository<MarketArchiveRecord>;
  constructor(client: ProviderClient) { this.records = new SupabaseRecordRepository(client, "market-archives"); }
  async get(tenantId: string, archiveId: string): Promise<MarketArchiveRecord | null> { const record = await this.records.get(tenantId, archiveId); return record ? validateStoredMarketArchive(record.payload) : null; }
  async list(tenantId: string): Promise<ReadonlyArray<MarketArchiveRecord>> { const records = await this.records.list(tenantId); return records.map((record) => validateStoredMarketArchive(record.payload)); }
  async save(record: MarketArchiveRecord): Promise<void> { const valid = validateStoredMarketArchive(record); const previous = await this.records.get(valid.tenantId, valid.archiveId); await this.records.put({ tenantId: valid.tenantId, recordId: valid.archiveId, payload: valid, expectedVersion: previous?.version }); }
}

class SupabaseDocumentStorage implements DocumentStoragePort {
  private readonly client: ProviderClient;
  private readonly bucket: string;
  private readonly metadata: SupabaseRecordRepository<DocumentMetadataRecord>;
  constructor(client: ProviderClient, bucket: string) { this.client = client; this.bucket = bucket; this.metadata = new SupabaseRecordRepository(client, "document-metadata"); }
  private key(tenantId: string, id: string): string { assertTenant(tenantId); assertRecordId(id); return `${tenantId}/${id}.pdf`; }
  async store(tenantId: string, id: string, bytes: Uint8Array): Promise<string> {
    const objectKey = this.key(tenantId, id);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const result = await this.client.storage.from(this.bucket).upload(objectKey, body, { contentType: "application/pdf", upsert: true });
    if (result.error) providerError(result.error, "DOCUMENT_STORAGE_ERROR");
    const now = new Date().toISOString();
    const previous = await this.metadata.get(tenantId, id);
    try {
      await this.metadata.put({ tenantId, recordId: id, expectedVersion: previous?.version, payload: { documentId: id, storageKey: objectKey, sha256: createHash("sha256").update(bytes).digest("hex"), mime: "application/pdf", size: bytes.byteLength, createdAt: previous?.payload.createdAt ?? now, updatedAt: now } });
    } catch (error) {
      await this.client.storage.from(this.bucket).remove([objectKey]);
      throw error;
    }
    return objectKey;
  }
  async read(objectKey: string): Promise<Uint8Array> {
    if (!/^tenant_[a-z0-9-]+\/[A-Za-z0-9._:-]{1,160}\.pdf$/.test(objectKey)) fail("DOCUMENT_STORAGE_KEY_INVALID");
    const result = await this.client.storage.from(this.bucket).download(objectKey);
    if (result.error) providerError(result.error, "DOCUMENT_STORAGE_ERROR");
    return new Uint8Array(await result.data.arrayBuffer());
  }
  async remove(objectKey: string): Promise<void> {
    const match = /^(tenant_[a-z0-9-]+)\/([A-Za-z0-9._:-]{1,160})\.pdf$/.exec(objectKey);
    if (!match) fail("DOCUMENT_STORAGE_KEY_INVALID");
    const result = await this.client.storage.from(this.bucket).remove([objectKey]);
    if (result.error) providerError(result.error, "DOCUMENT_STORAGE_ERROR");
    const metadata = await this.metadata.get(match[1], match[2]);
    if (metadata) await this.metadata.delete({ tenantId: match[1], recordId: match[2], expectedVersion: metadata.version });
  }
}

export class SupabaseProductionStorageAdapter implements ProductionStorageAdapter {
  readonly kind = "provider" as const;
  readonly cteArchiveRepository: CteArchiveRepository;
  readonly marketArchiveRepository: MarketArchiveRepository;
  readonly billRepository: BillRepository;
  readonly documentStorage: DocumentStoragePort;
  readonly billIngestionMetadata: TenantRecordRepository<BillIngestionMetadata>;
  readonly normalizedBillSnapshots: TenantRecordRepository<NormalizedBillSnapshot>;
  readonly cteArchives: DeletableTenantRecordRepository<unknown>;
  readonly marketDataArchives: TenantRecordRepository<unknown>;
  readonly regulatoryValues: TenantRecordRepository<RegulatoryValueRecord>;
  readonly approvalDomains: TenantRecordRepository<RegulatoryApprovalDomainState>;
  readonly calculationResults: TenantRecordRepository<CalculationResultRecord>;
  readonly comparisonResults: TenantRecordRepository<ComparisonResultRecord>;
  readonly proposals: TenantRecordRepository<CommercialProposalRecord>;
  readonly exports: TenantRecordRepository<ExportMetadataRecord>;
  readonly auditEvents: SupabaseRecordRepository<AuditEvent>;
  readonly regulatoryRefreshState: TenantRecordRepository<unknown>;
  readonly regulatoryRefreshRuns: TenantRecordRepository<unknown>;

  constructor(client: ProviderClient, storageBucket: string) {
    this.cteArchiveRepository = new SupabaseCteArchiveRepository(client);
    this.marketArchiveRepository = new SupabaseMarketArchiveRepository(client);
    this.billRepository = new SupabaseBillRepository(client);
    this.documentStorage = new SupabaseDocumentStorage(client, storageBucket);
    this.billIngestionMetadata = new SupabaseRecordRepository(client, "bill-ingestion-metadata");
    this.normalizedBillSnapshots = new SupabaseRecordRepository(client, "normalized-bill-snapshots");
    this.cteArchives = new SupabaseRecordRepository(client, "cte-records") as SupabaseRecordRepository<unknown> & DeletableTenantRecordRepository<unknown>;
    this.marketDataArchives = new SupabaseRecordRepository(client, "market-data-archives");
    this.regulatoryValues = new SupabaseRecordRepository<RegulatoryValueRecord>(client, "regulatory-values");
    this.approvalDomains = new SupabaseRecordRepository<RegulatoryApprovalDomainState>(client, "regulatory-approval-domains");
    this.calculationResults = new SupabaseRecordRepository(client, "calculations");
    this.comparisonResults = new SupabaseRecordRepository(client, "comparisons");
    this.proposals = new SupabaseRecordRepository(client, "proposals");
    this.exports = new SupabaseRecordRepository(client, "exports");
    this.auditEvents = new SupabaseRecordRepository(client, "audit-events");
    this.regulatoryRefreshState = new SupabaseRecordRepository(client, "regulatory-refresh-state");
    this.regulatoryRefreshRuns = new SupabaseRecordRepository(client, "regulatory-refresh-runs");
  }
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = decodeURIComponent(part.slice(index + 1).trim());
    return COOKIE_TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

function tokenDigest(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }

type SessionRow = { readonly session_id: string; readonly user_id: string; readonly tenant_id: string; readonly role: AuthRole; readonly issued_at: string; readonly expires_at: string; readonly revoked_at?: string | null };
type UserRow = { readonly user_id: string; readonly display_name: string; readonly active: boolean };
type MembershipRow = { readonly tenant_id?: string; readonly role: AuthRole; readonly status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED" };
type IdentityRow = { readonly auth_user_id: string; readonly user_id: string; readonly provider: "supabase" };

export type ProductionMembership = { readonly tenantId: string; readonly role: AuthRole };

export type ProductionIdentityResolution =
  | { readonly kind: "IDENTITY_MAPPING_REQUIRED" }
  | { readonly kind: "USER_INACTIVE" }
  | { readonly kind: "MEMBERSHIP_REQUIRED" }
  | { readonly kind: "TENANT_SELECTION_REQUIRED"; readonly memberships: readonly ProductionMembership[] }
  | { readonly kind: "READY"; readonly userId: string; readonly displayName: string; readonly membership: ProductionMembership };

const AUTH_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseServerSessionAdapter implements ServerSessionAdapter {
  private readonly client: ProviderClient;
  private readonly cookieName: string;
  constructor(client: ProviderClient, cookieName: string) { this.client = client; this.cookieName = cookieName; }
  async resolve(request: Request): Promise<AuthenticatedPrincipal | null> {
    const token = cookieValue(request, this.cookieName);
    if (!token) return null;
    const sessionQuery = this.client.from("runtime_sessions").select("session_id,user_id,tenant_id,role,issued_at,expires_at,revoked_at").eq("session_hash", tokenDigest(token)).maybeSingle();
    const session = await unwrap(sessionQuery as unknown as QueryResult<SessionRow | null>);
    if (!session || session.revoked_at || !SESSION_PATTERN.test(session.session_id) || !USER_PATTERN.test(session.user_id) || !TENANT_PATTERN.test(session.tenant_id) || !["ADMIN", "ANALYST", "VIEWER"].includes(session.role)) return null;
    const now = Date.now();
    const issuedAt = Date.parse(session.issued_at);
    const expiresAt = Date.parse(session.expires_at);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now || expiresAt <= now) return null;
    const userQuery = this.client.from("runtime_users").select("user_id,display_name,active").eq("user_id", session.user_id).maybeSingle();
    const user = await unwrap(userQuery as unknown as QueryResult<UserRow | null>);
    if (!user || user.user_id !== session.user_id || user.active !== true) return null;
    const membershipQuery = this.client.from("runtime_memberships").select("role,status").eq("user_id", session.user_id).eq("tenant_id", session.tenant_id).maybeSingle();
    const membership = await unwrap(membershipQuery as unknown as QueryResult<MembershipRow | null>);
    if (!membership || membership.status !== "ACTIVE" || membership.role !== session.role) return null;
    return Object.freeze({ userId: session.user_id, tenantId: session.tenant_id, role: session.role, sessionId: session.session_id, issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), source: "VERIFIED_SESSION" });
  }
}

export async function findProductionSessionId(client: ProviderClient, request: Request, cookieName: string): Promise<string | null> {
  const token = cookieValue(request, cookieName);
  if (!token) return null;
  const query = client.from("runtime_sessions").select("session_id").eq("session_hash", tokenDigest(token)).maybeSingle();
  const session = await unwrap(query as unknown as QueryResult<{ readonly session_id: string } | null>);
  return session && SESSION_PATTERN.test(session.session_id) ? session.session_id : null;
}

export async function resolveProductionIdentity(client: ProviderClient, authUserId: string): Promise<ProductionIdentityResolution> {
  if (!AUTH_USER_ID_PATTERN.test(authUserId)) return { kind: "IDENTITY_MAPPING_REQUIRED" };
  const identityQuery = client.from("runtime_identities").select("auth_user_id,user_id,provider").eq("auth_user_id", authUserId).maybeSingle();
  const identity = await unwrap(identityQuery as unknown as QueryResult<IdentityRow | null>);
  if (!identity || identity.provider !== "supabase" || !USER_PATTERN.test(identity.user_id)) return { kind: "IDENTITY_MAPPING_REQUIRED" };

  const userQuery = client.from("runtime_users").select("user_id,display_name,active").eq("user_id", identity.user_id).maybeSingle();
  const user = await unwrap(userQuery as unknown as QueryResult<UserRow | null>);
  if (!user || user.user_id !== identity.user_id) return { kind: "IDENTITY_MAPPING_REQUIRED" };
  if (user.active !== true) return { kind: "USER_INACTIVE" };

  const membershipQuery = client.from("runtime_memberships").select("tenant_id,role,status").eq("user_id", identity.user_id).eq("status", "ACTIVE").order("tenant_id", { ascending: true });
  const memberships = await unwrap(membershipQuery as unknown as QueryResult<MembershipRow[]>);
  const activeMemberships = memberships.filter((row): row is MembershipRow & { readonly tenant_id: string } => Boolean(row.tenant_id && TENANT_PATTERN.test(row.tenant_id) && ["ADMIN", "ANALYST", "VIEWER"].includes(row.role) && row.status === "ACTIVE")).map((row) => ({ tenantId: row.tenant_id, role: row.role }));
  if (activeMemberships.length === 0) return { kind: "MEMBERSHIP_REQUIRED" };
  if (activeMemberships.length > 1) return { kind: "TENANT_SELECTION_REQUIRED", memberships: activeMemberships };
  return { kind: "READY", userId: identity.user_id, displayName: user.display_name, membership: activeMemberships[0] };
}

export type ProductionSessionInput = { readonly userId: string; readonly tenantId: string; readonly role: AuthRole; readonly now?: Date; readonly expiresAt?: Date };

export async function createProductionSession(client: ProviderClient, input: ProductionSessionInput, cookieName: string, maxAgeSeconds: number): Promise<{ readonly token: string; readonly sessionId: string; readonly expiresAt: string; readonly cookie: string }> {
  if (!USER_PATTERN.test(input.userId) || !TENANT_PATTERN.test(input.tenantId) || !["ADMIN", "ANALYST", "VIEWER"].includes(input.role)) fail("SESSION_INPUT_INVALID");
  const membershipQuery = client.from("runtime_memberships").select("role,status").eq("user_id", input.userId).eq("tenant_id", input.tenantId).maybeSingle();
  const membership = await unwrap(membershipQuery as unknown as QueryResult<MembershipRow | null>);
  if (!membership || membership.status !== "ACTIVE" || membership.role !== input.role) fail("SESSION_MEMBERSHIP_DENIED");
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + maxAgeSeconds * 1000);
  if (expiresAt.getTime() <= now.getTime()) fail("SESSION_EXPIRY_INVALID");
  const token = randomBytes(32).toString("base64url");
  const sessionId = `session_${randomUUID()}`;
  const insert = client.from("runtime_sessions").insert({ session_id: sessionId, session_hash: tokenDigest(token), user_id: input.userId, tenant_id: input.tenantId, role: input.role, issued_at: now.toISOString(), expires_at: expiresAt.toISOString(), revoked_at: null });
  await unwrap(insert as unknown as QueryResult<unknown>);
  const secureName = cookieName.startsWith("__Host-") ? cookieName : cookieName;
  return { token, sessionId, expiresAt: expiresAt.toISOString(), cookie: `${secureName}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax` };
}

export async function revokeProductionSession(client: ProviderClient, sessionId: string, at = new Date()): Promise<void> {
  if (!SESSION_PATTERN.test(sessionId)) fail("SESSION_ID_INVALID");
  const update = client.from("runtime_sessions").update({ revoked_at: at.toISOString() }).eq("session_id", sessionId);
  await unwrap(update as unknown as QueryResult<unknown>);
}

export function createProductionAdapters(config: ProductionProviderConfig): { readonly client: ProviderClient; readonly auth: ServerSessionAdapter; readonly storage: ProductionStorageAdapter } {
  const client = createSupabaseProviderClient(config);
  return { client, auth: new SupabaseServerSessionAdapter(client, config.sessionCookieName), storage: new SupabaseProductionStorageAdapter(client, config.storageBucket) };
}
