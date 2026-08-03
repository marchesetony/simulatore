export const PERSISTENCE_SCHEMA_VERSION = 1 as const;

export interface TenantRecord<TPayload = unknown> {
  readonly schemaVersion: typeof PERSISTENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload: TPayload;
  readonly idempotencyKey?: string;
}

export interface PutRecordInput<TPayload> {
  readonly recordId: string;
  readonly tenantId: string;
  readonly payload: TPayload;
  readonly expectedVersion?: number;
  readonly idempotencyKey?: string;
  readonly now?: string;
}

export interface TenantRecordRepository<TPayload> {
  get(tenantId: string, recordId: string): Promise<TenantRecord<TPayload> | null>;
  list(tenantId: string): Promise<readonly TenantRecord<TPayload>[]>;
  put(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>>;
  append(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>>;
}

export interface UnscopedRecord<TPayload = unknown> {
  readonly schemaVersion: typeof PERSISTENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly version: 1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload: TPayload;
  readonly idempotencyKey?: string;
}

export interface UnscopedAppendRepository<TPayload> {
  appendUnscoped(input: Omit<PutRecordInput<TPayload>, "tenantId">): Promise<UnscopedRecord<TPayload>>;
  listUnscoped(): Promise<readonly UnscopedRecord<TPayload>[]>;
}

export interface BillIngestionMetadata { readonly documentId: string; readonly sourceVersionId?: string; readonly status: string; }
export interface NormalizedBillSnapshot { readonly documentId: string; readonly snapshot: unknown; }
export interface CalculationResultRecord { readonly calculationId: string; readonly fingerprint: string; readonly result: unknown; }
export interface ComparisonResultRecord { readonly comparisonId: string; readonly fingerprint: string; readonly result: unknown; }
export interface CommercialProposalRecord { readonly proposalId: string; readonly proposalFingerprint: string; readonly proposal: unknown; }
export interface ExportMetadataRecord { readonly exportId: string; readonly proposalId?: string; readonly format: "JSON" | "CSV" | "HTML"; readonly contentFingerprint: string; }

export interface AuditEvent {
  readonly schemaVersion: typeof PERSISTENCE_SCHEMA_VERSION;
  readonly eventId: string;
  readonly tenantId?: string;
  readonly principalId?: string;
  readonly role?: "ADMIN" | "ANALYST" | "VIEWER";
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly timestamp: string;
  readonly outcome: "ALLOWED" | "DENIED" | "FAILED";
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export type BillIngestionRepository = TenantRecordRepository<BillIngestionMetadata | NormalizedBillSnapshot>;
export type CteArchiveRepository = TenantRecordRepository<unknown>;
export type MarketDataArchiveRepository = TenantRecordRepository<unknown>;
export type CalculationResultRepository = TenantRecordRepository<CalculationResultRecord>;
export type ComparisonResultRepository = TenantRecordRepository<ComparisonResultRecord>;
export type CommercialProposalRepository = TenantRecordRepository<CommercialProposalRecord>;
export type ExportMetadataRepository = TenantRecordRepository<ExportMetadataRecord>;
export type AuditEventRepository = TenantRecordRepository<AuditEvent> & UnscopedAppendRepository<AuditEvent>;

export function deterministicRecordId(namespace: string, tenantId: string, stableKey: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(namespace) || !/^tenant_[a-z0-9-]+$/.test(tenantId) || typeof stableKey !== "string" || stableKey.length > 4096) throw new Error("PERSISTENCE_ID_INVALID");
  return `${namespace}_${createHash("sha256").update(`${namespace}|${tenantId}|${stableKey}`, "utf8").digest("hex")}`;
}
import { createHash } from "node:crypto";
