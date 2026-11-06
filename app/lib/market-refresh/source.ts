// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createGmeHistoricalArchiveReader, type GmeHistoricalFetcher } from "../market/gme-historical-archive.ts";
import type { ElectricityMonthlyPunRecord } from "../energy/market-data.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { loadGmeMonthlyBandsRecord } from "../market/gme-monthly-bands.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { GME_PUN_BANDS_PUBLICATIONS_PAGE, fetchGmePublicationText, type GmeFetcher } from "../market/gme-pun-source.ts";

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

/** Tony (6/11): "va prelevato il dato mensile non il giornaliero": GME's monthly "Prezzo medio per fasce" first; the yearly
 *  15-minute archive only when that month's publication cannot be read (it gives the same monthly averages). */
export function createOfficialPunSourceReader(input: { readonly historicalFetcher?: GmeHistoricalFetcher; readonly archiveUrl?: string; readonly publicationFetcher?: GmeFetcher } = {}): PunSourceReader {
  const historical = createGmeHistoricalArchiveReader({ fetcher: input.historicalFetcher, archiveUrl: input.archiveUrl });
  let page: Promise<string> | null = null;
  return {
    async load({ tenantId, referenceMonth, retrievedAt }): Promise<PunSourceBundle> {
      let monthlyError = "";
      try {
        page ??= fetchGmePublicationText(GME_PUN_BANDS_PUBLICATIONS_PAGE, input.publicationFetcher).then((result: { readonly text: string }) => result.text);
        const record = await loadGmeMonthlyBandsRecord({ tenantId, referenceMonth, retrievedAt, fetcher: input.publicationFetcher, pageHtml: await page });
        return { gme: { record, sourceSha256: record.source.sourceSha256 } };
      } catch (error) { page = null; monthlyError = error instanceof Error ? error.message : "GME_MONTHLY_BANDS_FAILED"; }
      try {
        const record = await historical.load({ tenantId, referenceMonth, retrievedAt });
        return { gme: { record, sourceSha256: record.source.sourceSha256 } };
      } catch (error) {
        return { gmeError: `${monthlyError};${error instanceof Error ? error.message : "GME_HISTORICAL_SOURCE_FAILED"}` };
      }
    },
  };
}
