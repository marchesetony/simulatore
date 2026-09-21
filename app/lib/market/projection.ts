import type { ElectricityMonthlyPunRecord } from "../energy/market-data";
import type { MarketArchiveRecord, MarketArchiveRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { approveMarketArchive, createMarketArchive } from "./service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertMarketRecord, assertMarketTenantId } from "./validation.ts";

export type OfficialMarketProjectionAction = "CREATED" | "REUSED";

export interface OfficialMarketProjectionResult {
  readonly action: OfficialMarketProjectionAction;
  readonly sourceTenantId: string;
  readonly targetTenantId: string;
  readonly record: MarketArchiveRecord;
}

export interface OfficialMarketProjectionInput {
  readonly source: MarketArchiveRecord;
  readonly targetTenantId: string;
  readonly now?: string;
  readonly actor?: string;
  readonly decisionId?: string;
}

function officialGmePun(record: MarketArchiveRecord): asserts record is MarketArchiveRecord & { readonly record: ElectricityMonthlyPunRecord } {
  if (record.status !== "APPROVED" || record.vector !== "EE" || record.index !== "PUN") throw new Error("MARKET_PROJECTION_SOURCE_NOT_APPROVED_OFFICIAL");
  if (record.record.source.authority !== "GME" || record.record.source.sourceType !== "OFFICIAL") throw new Error("MARKET_PROJECTION_SOURCE_NOT_APPROVED_OFFICIAL");
  let hostname = "";
  try { hostname = new URL(record.record.source.url).hostname.toLowerCase(); } catch { throw new Error("MARKET_PROJECTION_SOURCE_URL_INVALID"); }
  if (hostname !== "gme.mercatoelettrico.org") throw new Error("MARKET_PROJECTION_SOURCE_DOMAIN_BLOCKED");
  assertMarketRecord(record.record, record.tenantId);
}

function comparable(record: MarketArchiveRecord): string {
  const market = record.record;
  return JSON.stringify({
    archiveId: record.archiveId,
    vector: record.vector,
    index: record.index,
    month: record.month,
    record: { ...market, tenantId: undefined, approval: undefined },
  });
}

/**
 * Projects an already approved official GME record through the market archive
 * workflow. This is explicit tenant projection, never a resolver fallback.
 */
export async function projectOfficialGmePun(repository: MarketArchiveRepository, input: OfficialMarketProjectionInput): Promise<OfficialMarketProjectionResult> {
  assertMarketTenantId(input.targetTenantId);
  officialGmePun(input.source);
  if (input.source.tenantId === input.targetTenantId) throw new Error("MARKET_PROJECTION_TARGET_MUST_DIFFER");

  const existing = await repository.get(input.targetTenantId, input.source.archiveId);
  if (existing) {
    if (existing.status === "APPROVED" && comparable(existing) === comparable(input.source)) return { action: "REUSED", sourceTenantId: input.source.tenantId, targetTenantId: input.targetTenantId, record: existing };
    throw new Error("MARKET_PROJECTION_TARGET_CONFLICT");
  }

  const projectedRecord: ElectricityMonthlyPunRecord = {
    ...input.source.record,
    tenantId: input.targetTenantId,
    approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_TENANT_PROJECTION" },
  };
  const imported = await createMarketArchive(repository, {
    tenantId: input.targetTenantId,
    record: projectedRecord,
    archiveId: projectedRecord.recordId,
    now: input.now,
    actor: input.actor ?? "OFFICIAL_GME_TENANT_PROJECTION",
  });
  const approved = await approveMarketArchive(repository, input.targetTenantId, imported.archiveId, input.actor ?? "OFFICIAL_GME_TENANT_PROJECTION", input.decisionId ?? `gme-tenant-projection-${projectedRecord.month}`, input.now);
  return { action: "CREATED", sourceTenantId: input.source.tenantId, targetTenantId: input.targetTenantId, record: approved };
}
