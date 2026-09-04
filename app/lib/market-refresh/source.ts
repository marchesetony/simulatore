// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { findPublicationLink } from "../market/gme-publication.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { GME_PUN_BANDS_PUBLICATIONS_PAGE, GME_PUN_INDEX_PUBLICATIONS_PAGE, fetchGmePublicationText, parseGmeCompletePublication, type GmeFetcher } from "../market/gme-pun-source.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_PUN_PLACET_PAGE, parseAreraPunPublication } from "../market/arera-pun-source.ts";
import type { ElectricityMonthlyPunRecord } from "../energy/market-data.ts";

export interface PunSourceCandidate {
  readonly record: ElectricityMonthlyPunRecord;
  readonly sourceSha256?: string;
}

export interface PunSourceBundle {
  readonly gme?: PunSourceCandidate;
  readonly arera?: PunSourceCandidate;
  readonly gmeError?: string;
  readonly areraError?: string;
}

export interface PunSourceReader {
  load(input: { readonly tenantId: string; readonly referenceMonth: string; readonly retrievedAt: string }): Promise<PunSourceBundle>;
}

export interface AreraPunFetcherResponse { readonly status: number; readonly headers: { get(name: string): string | null }; readonly text: () => Promise<string>; }
export type AreraPunFetcher = (input: string, init?: RequestInit) => Promise<AreraPunFetcherResponse>;

function errorText(error: unknown): string { return error instanceof Error ? error.message : "PUN_SOURCE_READ_FAILED"; }
function publicationDate(text: string): string | null { const match = /(?:pubblicat[oa]|publication\s+date)[^0-9]{0,40}(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/i.exec(text); return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null; }

async function readArera(url: string, fetcher: AreraPunFetcher): Promise<{ readonly text: string; readonly sourceSha256?: string; readonly publishedAt: string | null }> {
  const response = await fetcher(url, { redirect: "manual", headers: { Accept: "text/html", "User-Agent": "SimulatoreMarketRefresh/1.0 (official-source-import)" } });
  if (response.status < 200 || response.status >= 300) throw new Error(`ARERA_HTTP_${response.status}`);
  const text = await response.text();
  return { text, publishedAt: publicationDate(text) };
}

export function createOfficialPunSourceReader(input: { readonly gmeFetcher?: GmeFetcher; readonly areraFetcher?: AreraPunFetcher; readonly gmeIndexPage?: string; readonly gmeBandsPage?: string; readonly areraPage?: string } = {}): PunSourceReader {
  const gmeFetcher = input.gmeFetcher;
  const areraFetcher = input.areraFetcher ?? (fetch as unknown as AreraPunFetcher);
  const gmeIndexPage = input.gmeIndexPage ?? GME_PUN_INDEX_PUBLICATIONS_PAGE;
  const gmeBandsPage = input.gmeBandsPage ?? GME_PUN_BANDS_PUBLICATIONS_PAGE;
  const areraPage = input.areraPage ?? ARERA_PUN_PLACET_PAGE;
  return {
    async load({ tenantId, referenceMonth, retrievedAt }): Promise<PunSourceBundle> {
      const result: { gme?: PunSourceCandidate; arera?: PunSourceCandidate; gmeError?: string; areraError?: string } = {};
      try {
        const fetcher = gmeFetcher ?? (fetch as unknown as GmeFetcher);
        const index = await fetchGmePublicationText(gmeIndexPage, fetcher);
        const bands = await fetchGmePublicationText(gmeBandsPage, fetcher);
        const monthlyUrl = findPublicationLink(index.text, index.url, referenceMonth);
        const bandsUrl = findPublicationLink(bands.text, bands.url, referenceMonth);
        const monthly = await fetchGmePublicationText(monthlyUrl, fetcher);
        const band = await fetchGmePublicationText(bandsUrl, fetcher);
        const record = parseGmeCompletePublication({ tenantId, referenceMonth, publicationText: monthly.text, monthlyPublicationText: monthly.text, bandsPublicationText: band.text, sourceReference: monthly.url, monthlySourceReference: monthly.url, bandsSourceReference: band.url, publishedAt: publicationDate(index.text) ?? publicationDate(monthly.text), retrievedAt });
        result.gme = { record, sourceSha256: record.source.sourceSha256 };
      } catch (error) { result.gmeError = errorText(error); }
      try {
        const arera = await readArera(areraPage, areraFetcher);
        const record = parseAreraPunPublication({ tenantId, referenceMonth, publicationText: arera.text, sourceReference: areraPage, publishedAt: arera.publishedAt, retrievedAt });
        result.arera = { record, sourceSha256: record.source.sourceSha256 };
      } catch (error) { result.areraError = errorText(error); }
      return result;
    },
  };
}
