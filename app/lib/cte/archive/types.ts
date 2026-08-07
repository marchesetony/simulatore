import type { CteContract } from "../types";

export type CteArchiveStatus = "DRAFT" | "REVIEWED" | "APPROVED" | "EXPIRED" | "REJECTED";
export type CteArchiveEventType = "CREATED" | "CORRECTED" | "REVIEWED" | "APPROVED" | "REJECTED" | "EXPIRED" | "COMMERCIAL_BLOCKED" | "COMMERCIAL_REACTIVATED" | "COMMERCIAL_DELETED";
export type CteCommercialStatus = "ACTIVE" | "BLOCKED" | "DELETED";

export interface CteArchiveVersion {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly supersedesVersionId: string | null;
  readonly status: CteArchiveStatus;
  readonly contract: CteContract;
  readonly createdAt: string;
}

export interface CteArchiveApproval {
  readonly approvalId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly decision: "APPROVED" | "REJECTED";
  readonly reviewer: string;
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly supersedesApprovalId: string | null;
}

export interface CteArchiveHistoryEvent {
  readonly eventId: string;
  readonly type: CteArchiveEventType;
  readonly tenantId: string;
  readonly cteId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly at: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly sourceVersionId: string | null;
}

export interface CteArchiveRecord {
  readonly archiveId: string;
  readonly tenantId: string;
  readonly cteId: string;
  readonly vector: "EE" | "GAS";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentWorkingVersionId: string;
  readonly currentApprovedVersionId: string | null;
  readonly versions: readonly CteArchiveVersion[];
  readonly approvals: readonly CteArchiveApproval[];
  readonly history: readonly CteArchiveHistoryEvent[];
  readonly commercialStatus?: CteCommercialStatus;
  readonly blockedAt?: string | null;
  readonly blockedBy?: string | null;
  readonly blockReason?: string | null;
  readonly reactivatedAt?: string | null;
  readonly reactivatedBy?: string | null;
  readonly deletedAt?: string | null;
  readonly deletedBy?: string | null;
}

export interface CteArchiveRepository {
  get(tenantId: string, archiveId: string): Promise<CteArchiveRecord | null>;
  list(tenantId: string): Promise<ReadonlyArray<CteArchiveRecord>>;
  save(record: CteArchiveRecord): Promise<void>;
}

export interface CreateCteArchiveInput {
  readonly tenantId: string;
  readonly contract: CteContract;
  readonly now?: string;
  readonly archiveId?: string;
  readonly actor?: string;
}

export interface CorrectCteArchiveInput {
  readonly tenantId: string;
  readonly archiveId: string;
  readonly expectedVersionId: string;
  readonly contract: CteContract;
  readonly now?: string;
  readonly actor?: string;
  readonly reason?: string;
}
