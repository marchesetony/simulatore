// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createGmeHistoricalArchiveReader, type GmeHistoricalFetcher } from "../market/gme-historical-archive.ts";
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

export function createOfficialPunSourceReader(input: { readonly historicalFetcher?: GmeHistoricalFetcher; readonly archiveUrl?: string } = {}): PunSourceReader {
  const historical = createGmeHistoricalArchiveReader({ fetcher: input.historicalFetcher, archiveUrl: input.archiveUrl });
  return {
    async load({ tenantId, referenceMonth, retrievedAt }): Promise<PunSourceBundle> {
      try {
        const record = await historical.load({ tenantId, referenceMonth, retrievedAt });
        return { gme: { record, sourceSha256: record.source.sourceSha256 } };
      } catch (error) {
        return { gmeError: error instanceof Error ? error.message : "GME_HISTORICAL_SOURCE_FAILED" };
      }
    },
  };
}
