import type { MarketArchiveRecord, MarketArchiveRepository } from "./types";

// Tony (17/11/2026, binding): the operational PUN and PSV archive holds only the six months before the current date.
// Convention: the six calendar months before the current Italian month (Europe/Rome); the current month is never part of
// it. On 17/11/2026 the window is May–October 2026. Older months stay stored with their audit trail but are never used.
export const MARKET_OPERATIONAL_MONTHS = 6 as const;
export const PUN_RETENTION_REASON = `PUN_RETENTION_${MARKET_OPERATIONAL_MONTHS}_MONTHS` as const;
export const PSV_RETENTION_REASON = `PSV_RETENTION_${MARKET_OPERATIONAL_MONTHS}_MONTHS` as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in Italy. The windows are always measured from the server clock, never from a client date. */
export function romeToday(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("DATE_TIME_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function assertIsoDate(value: string): void {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!ISO_DATE.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error("DATE_INVALID");
}

/** The months (YYYY-MM, most recent first) of the operational window for `today` (YYYY-MM-DD, Italian date). */
export function operationalMarketMonths(today: string, count: number = MARKET_OPERATIONAL_MONTHS): readonly string[] {
  assertIsoDate(today);
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 2 - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function isOperationalMarketMonth(month: string, today: string): boolean {
  return operationalMarketMonths(today).includes(month);
}

/** True when the record left the active archive because of the retention rule, not because it was wrong. */
export function isRetentionRetirement(record: MarketArchiveRecord): boolean {
  if (record.status !== "REJECTED") return false;
  const last = (record.approvals ?? []).at(-1);
  const reason = (record.record?.approval as { readonly reason?: string } | undefined)?.reason ?? "";
  return (last?.decisionId?.startsWith("retired-") === true) || /^(PUN|PSV)_RETENTION_\d+_MONTHS$/.test(reason);
}

/**
 * Read-only view of the market archive for calculations: PUN and PSV of months outside the operational window are not
 * visible, even when no refresh has retired them yet. Nothing is written; writing through the view is refused.
 */
export function operationalMarketView(repository: MarketArchiveRepository, today: string = romeToday()): MarketArchiveRepository {
  const months = new Set(operationalMarketMonths(today));
  const visible = (record: MarketArchiveRecord | null): boolean => record !== null && months.has(record.month);
  return {
    async get(tenantId, archiveId) { const record = await repository.get(tenantId, archiveId); return visible(record) ? record : null; },
    async list(tenantId) { return (await repository.list(tenantId)).filter((record) => visible(record)); },
    async save() { throw new Error("MARKET_OPERATIONAL_VIEW_READ_ONLY"); },
  };
}
