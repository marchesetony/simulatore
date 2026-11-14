// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { discoverTernaCorrispettiviEndpoints, importTernaCapacityQuarter, ternaQuarterFor, type TernaFetcher } from "../foundation/terna-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_CMEM_PAGE, fetchAreraCmem, type AreraCmemFetcher } from "../market/arera-cmem-source.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { fetchAreraDomesticCdispdWorkbook, parseAreraDomesticCdispdXlsx, type AreraFetcher } from "../foundation/arera-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createAreraRegulatorySourceReader } from "./arera.ts";

const message = (error: unknown): string => error instanceof Error ? error.message : "CHECK_FAILED";

/** Reads the official sources the nightly refresh depends on and reports what it finds, without saving anything. */
export async function checkOfficialSources(input: { readonly now?: string; readonly ternaFetcher?: TernaFetcher; readonly areraFetcher?: AreraCmemFetcher; readonly cdispdFetcher?: AreraFetcher } = {}) {
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
  // Households' CDISPD (dispatching + capacity, TIV comma 48.9): the months the ARERA workbook holds today and any it cannot read.
  const cdispd = await (async () => {
    try {
      const workbook = await fetchAreraDomesticCdispdWorkbook(input.cdispdFetcher);
      const imported = parseAreraDomesticCdispdXlsx({ body: workbook.bytes, sourceReference: workbook.url, retrievedAt: now, discoveryReference: workbook.discoveryUrl });
      return { status: "OK" as const, url: workbook.url, months: [...imported.records].sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)).map((record) => ({ month: record.effectiveFrom.slice(0, 7), eurPerKwh: record.normalizedValue })), errors: imported.errors };
    } catch (error) { return { status: "ERROR" as const, error: message(error) }; }
  })();
  // The ARERA tariffs the nightly refresh reads (transport, oneri, BTA6, CDISPD), read the same way and not saved: what each
  // customer type gets, and each source that cannot be read with its reason.
  const tariffs = await (async () => {
    const reader = createAreraRegulatorySourceReader({ fetcher: input.cdispdFetcher });
    try {
      const records = await reader.load({ tenantId: "tenant_official-sources-check", retrievedAt: now });
      const byScope: Record<string, number> = {};
      for (const record of records) byScope[record.customerScope] = (byScope[record.customerScope] ?? 0) + 1;
      return { status: "OK" as const, values: records.length, byScope, errors: reader.lastErrors?.() ?? [] };
    } catch (error) { return { status: "ERROR" as const, error: message(error), errors: reader.lastErrors?.() ?? [] }; }
  })();
  return { checkedAt: now, terna, psv, cdispd, tariffs };
}
