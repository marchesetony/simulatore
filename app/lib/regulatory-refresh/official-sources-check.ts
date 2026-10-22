// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { discoverTernaCorrispettiviEndpoints, importTernaCapacityQuarter, ternaQuarterFor, type TernaFetcher } from "../foundation/terna-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_CMEM_PAGE, fetchAreraCmem, type AreraCmemFetcher } from "../market/arera-cmem-source.ts";

const message = (error: unknown): string => error instanceof Error ? error.message : "CHECK_FAILED";

/** Reads the official sources the nightly refresh depends on and reports what it finds, without saving anything. */
export async function checkOfficialSources(input: { readonly now?: string; readonly ternaFetcher?: TernaFetcher; readonly areraFetcher?: AreraCmemFetcher } = {}) {
  const now = input.now ?? new Date().toISOString();
  const quarter = ternaQuarterFor(now);
  const terna = await (async () => {
    try {
      const discovery = await discoverTernaCorrispettiviEndpoints(input.ternaFetcher);
      const imported = await importTernaCapacityQuarter({ tenantId: "tenant_official-sources-check", retrievedAt: now, quarter, fetcher: input.ternaFetcher, discovery });
      const value = (code: string) => imported.records.find((record) => record.componentCode === code)?.originalValue ?? null;
      return { status: "OK" as const, quarter: `${quarter.quarter}° trimestre ${quarter.year}`, title: imported.document.title, url: imported.document.url, publicationDate: imported.document.publicationDate, offPeakEurPerMwh: value("CAPACITY_MARKET_OFF_PEAK"), peakEurPerMwh: value("CAPACITY_MARKET_PEAK") };
    } catch (error) { return { status: "ERROR" as const, quarter: `${quarter.quarter}° trimestre ${quarter.year}`, error: message(error) }; }
  })();
  const psv = await (async () => {
    try {
      const { rows } = await fetchAreraCmem(input.areraFetcher);
      return { status: "OK" as const, url: ARERA_CMEM_PAGE, months: rows.slice(0, 4).map((row) => ({ month: row.month, eurPerSmc: row.eurPerSmc, eurPerMwh: row.eurPerMwh })) };
    } catch (error) { return { status: "ERROR" as const, url: ARERA_CMEM_PAGE, error: message(error) }; }
  })();
  return { checkedAt: now, terna, psv };
}
