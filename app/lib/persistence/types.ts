export const PERSISTENCE_SCHEMA_VERSION = 1 as const;

import type { EligibilityOverride } from "../eligibility/override";

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

export interface DeleteRecordInput {
  readonly recordId: string;
  readonly tenantId: string;
  readonly expectedVersion?: number;
}

export interface TenantRecordRepository<TPayload> {
  get(tenantId: string, recordId: string): Promise<TenantRecord<TPayload> | null>;
  list(tenantId: string): Promise<readonly TenantRecord<TPayload>[]>;
  put(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>>;
  append(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>>;
}

export interface DeletableTenantRecordRepository<TPayload> extends TenantRecordRepository<TPayload> {
  delete(input: DeleteRecordInput): Promise<void>;
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
export interface ExportMetadataRecord { readonly exportId: string; readonly proposalId?: string; readonly format: "JSON" | "CSV" | "HTML" | "PDF"; readonly contentFingerprint: string; }
export interface FoundationInvitationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly recipientUserId: string;
  readonly recipientEmail: string;
  readonly role: "PRODUCT_OWNER" | "PLATFORM_OWNER" | "TENANT_ADMIN" | "SALES_MANAGER" | "SALES_OPERATOR";
  readonly tokenDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly createdBy: string;
  readonly status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  readonly acceptedAt?: string;
  readonly revokedAt?: string;
}
export interface FoundationMembershipRecord {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly role: "PRODUCT_OWNER" | "PLATFORM_OWNER" | "TENANT_ADMIN" | "SALES_MANAGER" | "SALES_OPERATOR";
  readonly status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  readonly permissions: ReadonlyArray<"tenant:read" | "tenant:manage" | "membership:read" | "membership:manage" | "customer:read" | "customer:manage" | "document:read" | "document:manage" | "audit:read">;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt?: string;
  /** Server-managed reporting line. Only a SUPER_ADMIN may mutate it. */
  readonly managerUserId?: string;
  /** Server-managed group membership used by feature governance. */
  readonly groupIds?: readonly string[];
}

export type BillFeaturePermissionRecord = import("../foundation/bill-feature-permissions.ts").BillFeaturePermissionRecord;

export type ObservedJobKey = "BILL_RETENTION" | "CTE_EXPIRY" | "MARKET_REFRESH" | "REGULATORY_REFRESH";
export type ObservedJobTrigger = "CRON" | "MANUAL" | "TEST";
export type ObservedJobRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL_FAILURE" | "FAILED" | "ALREADY_RUNNING";
export type JobIncidentStatus = "OPEN" | "RESOLVED";

export interface SafeJobDiagnostics {
  readonly code: string;
  readonly stage: string;
  readonly retryable: boolean;
}

export interface JobRunRecord {
  readonly runId: string;
  readonly tenantId: string;
  readonly jobKey: ObservedJobKey;
  readonly trigger: ObservedJobTrigger;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: ObservedJobRunStatus;
  readonly durationMs: number | null;
  readonly summary: Readonly<Record<string, number>>;
  readonly diagnostics: SafeJobDiagnostics | null;
}

export interface JobIncidentRecord {
  readonly incidentId: string;
  readonly tenantId: string;
  readonly jobKey: ObservedJobKey;
  readonly fingerprint: string;
  readonly status: JobIncidentStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly resolvedAt: string | null;
  readonly occurrences: number;
  readonly lastRunId: string;
  readonly diagnostics: SafeJobDiagnostics;
}

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
export type EligibilityOverrideRepository = TenantRecordRepository<EligibilityOverride>;

export function deterministicRecordId(namespace: string, tenantId: string, stableKey: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(namespace) || !/^tenant_[a-z0-9-]+$/.test(tenantId) || typeof stableKey !== "string" || stableKey.length > 4096) throw new Error("PERSISTENCE_ID_INVALID");
  return `${namespace}_${createHash("sha256").update(`${namespace}|${tenantId}|${stableKey}`, "utf8").digest("hex")}`;
}
import { createHash } from "node:crypto";
