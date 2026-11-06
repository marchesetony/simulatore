import type { GasMonthlyPsvRecord } from "../energy/market-data.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { approveMarketArchive, compareMarketVersions, createMarketArchive } from "../market/service.ts";
import type { MarketArchiveRecord, MarketArchiveRepository } from "../market/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { fetchAreraCmem, psvRecordFromCmem, type AreraCmemFetcher, type AreraCmemRow } from "../market/arera-cmem-source.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { closedPunTargetMonths } from "./service.ts";

export interface PsvSourceReader {
  load(): Promise<{ readonly rows: readonly AreraCmemRow[]; readonly sourceSha256: string }>;
}

export interface PsvRefreshSummary {
  readonly status: "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  readonly targetMonths: readonly string[];
  readonly months: readonly { readonly month: string; readonly status: "CREATED" | "CORRECTED" | "UNCHANGED" | "NOT_PUBLISHED" | "FAILED"; readonly eurPerSmc?: number; readonly error?: string }[];
  readonly monthsCreated: number;
  readonly monthsFailed: number;
  readonly errors: readonly string[];
}

const actor = "market-regulatory-auto-refresh";
// ARERA publishes a month's CMEM,m in the first days of the following month.
const PUBLICATION_GRACE_DAYS = 10;

/** Keeps the monthly PSV (ARERA CMEM,m) approved for the last closed months a quote may use. */
export async function runPsvMarketRefresh(input: { readonly tenantId: string; readonly repositories: { readonly marketArchiveRepository: MarketArchiveRepository }; readonly sourceReader?: PsvSourceReader; readonly fetcher?: AreraCmemFetcher; readonly now?: string; readonly runId?: string }): Promise<PsvRefreshSummary> {
  const now = new Date(input.now ?? new Date().toISOString()).toISOString();
  const runId = input.runId ?? `psv-refresh-${now}`;
  const targetMonths = closedPunTargetMonths(now);
  const reader = input.sourceReader ?? { load: () => fetchAreraCmem(input.fetcher) };
  let source: Awaited<ReturnType<PsvSourceReader["load"]>>;
  try { source = await reader.load(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "PSV_SOURCE_FAILED";
    return { status: "FAILED", targetMonths, months: targetMonths.map((month) => ({ month, status: "FAILED" as const, error: message })), monthsCreated: 0, monthsFailed: targetMonths.length, errors: [message] };
  }
  const months: PsvRefreshSummary["months"][number][] = [];
  const errors: string[] = [];
  let monthsCreated = 0;
  for (const month of targetMonths) {
    try {
      const row = source.rows.find((item) => item.month === month);
      if (!row) {
        if (month === targetMonths[0] && new Date(now).getUTCDate() <= PUBLICATION_GRACE_DAYS) { months.push({ month, status: "NOT_PUBLISHED" }); continue; }
        throw new Error("PSV_MONTH_NOT_PUBLISHED");
      }
      const existing = await input.repositories.marketArchiveRepository.list(input.tenantId);
      const sameMonth = existing.filter((record) => record.vector === "GAS" && record.index === "PSV" && record.month === month);
      const current = sameMonth.filter((record) => record.status === "APPROVED").sort(compareMarketVersions)[0] as MarketArchiveRecord | undefined;
      if (current && Math.round((current.record as GasMonthlyPsvRecord).value.value * 1e6) === Math.round(row.eurPerSmc * 1e6)) { months.push({ month, status: "UNCHANGED", eurPerSmc: row.eurPerSmc }); continue; }
      const base = psvRecordFromCmem({ tenantId: input.tenantId, row, sourceSha256: source.sourceSha256, retrievedAt: now });
      const version = sameMonth.reduce((max, record) => Math.max(max, Number.parseInt(record.record.version, 10) || 0), 0) + 1;
      const record: GasMonthlyPsvRecord = version === 1 ? base : { ...base, recordId: `${base.recordId}-v${version}`, version: String(version), parentVersionId: current?.archiveId ?? null, approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_CORRECTION" } };
      const created = await createMarketArchive(input.repositories.marketArchiveRepository, { tenantId: input.tenantId, record, archiveId: record.recordId, now, actor });
      await approveMarketArchive(input.repositories.marketArchiveRepository, input.tenantId, created.archiveId, actor, `psv-refresh-${runId}-${month}-v${record.version}`, now);
      monthsCreated += 1;
      months.push({ month, status: current ? "CORRECTED" : "CREATED", eurPerSmc: row.eurPerSmc });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PSV_REFRESH_FAILED";
      months.push({ month, status: "FAILED", error: message });
      errors.push(`${month}:${message}`);
    }
  }
  const monthsFailed = months.filter((item) => item.status === "FAILED").length;
  return { status: monthsFailed === 0 ? "SUCCESS" : monthsFailed === targetMonths.length ? "FAILED" : "PARTIAL_FAILURE", targetMonths, months, monthsCreated, monthsFailed, errors };
}
