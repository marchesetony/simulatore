import type { CteContract } from "../types";

export const CTE_ARCHIVE_APPROVAL_CAPABILITY = Symbol("CTE_ARCHIVE_APPROVAL_CAPABILITY");

export type CteArchiveStatus = "DRAFT" | "REVIEWED" | "APPROVED" | "EXPIRED" | "REJECTED";
export type CteArchiveEventType = "CREATED" | "CORRECTED" | "REVIEWED" | "APPROVED" | "REJECTED" | "EXPIRED" | "COMMERCIAL_BLOCKED" | "COMMERCIAL_REACTIVATED" | "COMMERCIAL_DELETED" | "COMMERCIAL_ADJUSTED";

/** Company correction on an approved CTE: energy price in €/kWh or €/Smc and fixed fee in €/month, either sign. */
export interface CteCommercialAdjustment {
  readonly energyPriceDelta: number;
  readonly monthlyFeeDelta: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}
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
  readonly commercialAdjustment?: CteCommercialAdjustment | null;
}

/** A stored CTE left out of a list because it cannot be read: identifiers and error code only, never its content. */
export interface CteArchiveExclusion {
  readonly tenantId: string;
  readonly archiveId: string;
  readonly code: string;
}

export interface CteArchiveListResult {
  readonly records: ReadonlyArray<CteArchiveRecord>;
  readonly excluded: ReadonlyArray<CteArchiveExclusion>;
}

export interface CteArchiveRepository {
  get(tenantId: string, archiveId: string): Promise<CteArchiveRecord | null>;
  /** Tolerant: an unreadable CTE is left out (see listWithExclusions) instead of failing the whole tenant's archive. */
  list(tenantId: string): Promise<ReadonlyArray<CteArchiveRecord>>;
  /** Tony (9/11/2026, "lettura tollerante, scrittura rigorosa"): the readable CTEs plus a summary of the excluded ones. */
  listWithExclusions?(tenantId: string): Promise<CteArchiveListResult>;
  save(record: CteArchiveRecord, capability?: symbol): Promise<void>;
  /** Removes the CTE for good; only the company archive purge uses it (Tony, 31/10, "pulizia totale"). */
  remove?(tenantId: string, archiveId: string): Promise<void>;
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
