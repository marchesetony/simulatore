import type { MonthlyMarketDataRecord } from "../energy/market-data";

export type MarketArchiveStatus = "DRAFT" | "REVIEWED" | "APPROVED" | "REJECTED";
export type MarketArchiveEventType = "CREATED" | "REVIEWED" | "APPROVED" | "REJECTED";

export interface MarketArchiveApproval {
  readonly approvalId: string;
  readonly recordId: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly reviewer: string;
  readonly decisionId: string;
  readonly decidedAt: string;
}

export interface MarketArchiveHistoryEvent {
  readonly eventId: string;
  readonly type: MarketArchiveEventType;
  readonly tenantId: string;
  readonly recordId: string;
  readonly at: string;
  readonly actor: string;
  readonly reason: string | null;
}

export interface MarketArchiveRecord {
  readonly archiveId: string;
  readonly tenantId: string;
  readonly vector: "EE" | "GAS";
  readonly index: "PUN" | "PSV";
  readonly month: string;
  readonly record: MonthlyMarketDataRecord;
  readonly status: MarketArchiveStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvals: readonly MarketArchiveApproval[];
  readonly history: readonly MarketArchiveHistoryEvent[];
}

export interface MarketArchiveRepository {
  get(tenantId: string, archiveId: string): Promise<MarketArchiveRecord | null>;
  list(tenantId: string): Promise<ReadonlyArray<MarketArchiveRecord>>;
  save(record: MarketArchiveRecord): Promise<void>;
}

export interface CreateMarketArchiveInput {
  readonly tenantId: string;
  readonly record: MonthlyMarketDataRecord;
  readonly now?: string;
  readonly archiveId?: string;
  readonly actor?: string;
}
