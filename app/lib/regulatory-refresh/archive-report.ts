import type { RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
import type { RuntimeRepositories } from "../persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { mergeAreraCapacityMonths, type AreraCapacityMonth } from "../foundation/arera-capacity-tiv.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { mergeTernaTideQuarters } from "../foundation/terna-tide-dispatching.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { CALCULATED_REGULATORY_DOMAINS, REGULATORY_REFRESH_STALE_DAYS, TERNA_CAPACITY_DOMAINS, regulatoryDomainKey, type RegulatoryRefreshDomain } from "./registry.ts";

export interface ArchiveRecordView { readonly value: number; readonly unit: string; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly retrievedAt: string; readonly sourceReference: string }
export interface ArchiveDomainView {
  readonly key: string; readonly componentCode: string; readonly customerScope: string; readonly unit: string; readonly variant: string | null; readonly source: "ARERA" | "TERNA";
  readonly records: readonly ArchiveRecordView[];
  /** YYYY-MM months (the last 12 and the current one) with no approved value covering the whole month. */
  readonly missingMonths: readonly string[];
}
export interface ArchiveReport {
  readonly tenantId: string; readonly checkedAt: string; readonly lastSuccessfulAt: string | null; readonly stale: boolean; readonly lastErrors: readonly string[];
  readonly domains: readonly ArchiveDomainView[];
}

const monthStart = (year: number, month: number): number => Date.UTC(year, month, 1);
function lastMonths(now: string, count: number): readonly { readonly label: string; readonly from: number; readonly to: number }[] {
  const date = new Date(now);
  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    const from = monthStart(date.getUTCFullYear(), date.getUTCMonth() - offset);
    const to = monthStart(date.getUTCFullYear(), date.getUTCMonth() - offset + 1);
    return { label: new Date(from).toISOString().slice(0, 7), from, to };
  });
}
const covers = (records: readonly RegulatoryValueRecord[], from: number, to: number): boolean => {
  let cursor = from;
  for (const record of [...records].sort((left, right) => Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom))) {
    const start = Date.parse(record.effectiveFrom); const end = record.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(record.effectiveTo);
    if (end <= cursor) continue;
    if (start > cursor) return false;
    cursor = end;
    if (cursor >= to) return true;
  }
  return cursor >= to;
};

/** What the official archive holds for each domain the calculator uses, and which recent months are not covered. */
export async function officialArchiveReport(repositories: Pick<RuntimeRepositories, "regulatoryValues" | "approvalDomains" | "regulatoryRefreshState">, tenantId: string, now = new Date().toISOString()): Promise<ArchiveReport> {
  const bridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains);
  const approved = await bridge.list(tenantId);
  const months = lastMonths(now, 13);
  const view = (domain: RegulatoryRefreshDomain): ArchiveDomainView => {
    const records = approved.filter((record) => record.componentCode === domain.componentCode && record.customerScope === domain.customerScope && record.normalizedUnit === domain.normalizedUnit && record.regulatoryVariant === domain.regulatoryVariant);
    return {
      key: regulatoryDomainKey(domain), componentCode: domain.componentCode, customerScope: domain.customerScope, unit: domain.normalizedUnit, variant: domain.regulatoryVariant ?? null, source: domain.sourceAdapter === "TERNA_CAPACITY" ? "TERNA" : "ARERA",
      records: [...records].sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom)).map((record) => ({ value: record.normalizedValue, unit: record.normalizedUnit, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, retrievedAt: record.retrievedAt, sourceReference: record.sourceReference })),
      missingMonths: months.filter((month) => !covers(records, month.from, month.to)).map((month) => month.label),
    };
  };
  const stored = await repositories.regulatoryRefreshState.get(tenantId, deterministicRecordId("regulatory-refresh-state", tenantId, "regulatory-refresh"));
  const state = stored?.payload as { readonly lastSuccessfulAt?: string | null; readonly errors?: readonly string[] } | undefined;
  const lastSuccessfulAt = state?.lastSuccessfulAt ?? null;
  return {
    tenantId, checkedAt: now, lastSuccessfulAt, lastErrors: state?.errors ?? [],
    stale: lastSuccessfulAt === null || Date.parse(now) - Date.parse(lastSuccessfulAt) > REGULATORY_REFRESH_STALE_DAYS * 86_400_000,
    domains: [...[...CALCULATED_REGULATORY_DOMAINS, ...TERNA_CAPACITY_DOMAINS].map(view), areraCapacityView(months, mergeAreraCapacityMonths(approved), approved), ternaTideView(months, approved)],
  };
}

/** The monthly ARERA capacity charge for BT up to 55 kW (TIV quarterly updates, art. 4.1), most recent first. */
function areraCapacityView(months: readonly { readonly label: string }[], capacity: readonly AreraCapacityMonth[], approved: readonly RegulatoryValueRecord[]): ArchiveDomainView {
  const next = (month: string) => { const [year, value] = month.split("-").map(Number); return new Date(Date.UTC(year, value, 1)).toISOString(); };
  // A month read by the refresh shows when it was downloaded; a month still from the hand-checked table shows the table date.
  const retrieved = (item: AreraCapacityMonth) => approved.find((record) => record.componentCode === "CAPACITY_MARKET" && record.customerScope === "ALL_ELECTRICITY" && record.effectiveFrom.slice(0, 7) === item.month && record.sourceReference === item.url)?.retrievedAt ?? "2026-10-27T00:00:00.000Z";
  return {
    key: "CAPACITY_MARKET|LV_UP_TO_55KW|EUR/KWH|TIV_MONTHLY", componentCode: "CAPACITY_MARKET", customerScope: "LV_UP_TO_55KW", unit: "EUR/KWH", variant: null, source: "ARERA",
    records: [...capacity].reverse().map((item) => ({ value: Math.round(item.centsPerKwh * 1e6) / 1e8, unit: "EUR/KWH", effectiveFrom: `${item.month}-01T00:00:00.000Z`, effectiveTo: next(item.month), retrievedAt: retrieved(item), sourceReference: item.url })),
    missingMonths: months.filter((month) => !capacity.some((item) => item.month === month.label)).map((month) => month.label),
  };
}

/** Terna's TIDE dispatching total for customers other than households, by quarter: stored values over the checked table.
 *  Months before the first known quarter are not reported missing (the calculator never needs them). */
function ternaTideView(months: readonly { readonly label: string; readonly from: number; readonly to: number }[], approved: readonly RegulatoryValueRecord[]): ArchiveDomainView {
  const quarters = mergeTernaTideQuarters(approved);
  const stored = (from: string) => approved.find((record) => record.componentCode === "DISPATCHING_TOTAL" && record.regulatoryVariant === "TIDE" && record.effectiveFrom.slice(0, 10) === from);
  const first = quarters.length ? Date.parse(quarters[0].from) : Number.POSITIVE_INFINITY;
  return {
    key: "DISPATCHING_TOTAL|NON_DOMESTIC_BT|EUR/KWH|TIDE", componentCode: "DISPATCHING_TOTAL", customerScope: "NON_DOMESTIC_BT", unit: "EUR/KWH", variant: "TIDE", source: "TERNA",
    records: [...quarters].reverse().map((item) => ({ value: Math.round(item.centsPerKwh * 1e5) / 1e7, unit: "EUR/KWH", effectiveFrom: `${item.from}T00:00:00.000Z`, effectiveTo: `${item.to}T00:00:00.000Z`, retrievedAt: stored(item.from)?.retrievedAt ?? "2026-10-28T00:00:00.000Z", sourceReference: item.url })),
    missingMonths: months.filter((month) => month.from >= first && !quarters.some((item) => Date.parse(item.from) <= month.from && month.to <= Date.parse(item.to))).map((month) => month.label),
  };
}
