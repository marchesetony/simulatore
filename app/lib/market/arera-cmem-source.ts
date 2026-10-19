import { createHash } from "node:crypto";
import type { GasMonthlyPsvRecord } from "../energy/market-data.ts";

/** ARERA publishes CMEM,m, the monthly average of the PSV day-ahead price, for every month. */
export const ARERA_CMEM_PAGE = "https://www.arera.it/area-operatori/prezzi-e-tariffe/valore-cmemm-vulnerabili";
export const ARERA_CMEM_SOURCE_ID = "ARERA_CMEM_PSV_DAY_AHEAD";

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export interface AreraCmemRow {
  readonly month: string;
  readonly eurPerMwh: number;
  readonly eurPerSmc: number;
}

export interface AreraCmemFetchResponse {
  readonly status: number;
  readonly text: () => Promise<string>;
}

export type AreraCmemFetcher = (input: string, init?: RequestInit) => Promise<AreraCmemFetchResponse>;

const decimal = (value: string): number => Number(value.trim().replace(/\./g, "").replace(",", "."));
const cellText = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\*/g, "").replace(/\s+/g, " ").trim();

/**
 * Reads the CMEM,m table: a bold year row followed by one row per month with
 * EUR/MWh, EUR/GJ and EUR/Smc. Months appear newest first.
 */
export function parseAreraCmemTable(html: string): readonly AreraCmemRow[] {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1])));
  const result: AreraCmemRow[] = [];
  let year: number | null = null;
  for (const cells of rows) {
    const label = (cells[0] ?? "").toLowerCase();
    if (/^\d{4}$/.test(label)) { year = Number(label); continue; }
    const monthIndex = MONTHS.indexOf(label);
    if (monthIndex < 0 || year === null) continue;
    const [mwh, , smc] = cells.slice(1).map(decimal);
    if (![mwh, smc].every((value) => Number.isFinite(value) && value > 0)) throw new Error("ARERA_CMEM_VALUE_INVALID");
    // The three columns are the same price in different units: keep them consistent (PCS 0,038520 GJ/Smc).
    if (Math.abs(mwh * 0.03852 / 3.6 - smc) > 0.0005) throw new Error("ARERA_CMEM_UNITS_INCONSISTENT");
    result.push({ month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`, eurPerMwh: mwh, eurPerSmc: smc });
  }
  if (result.length === 0) throw new Error("ARERA_CMEM_TABLE_NOT_FOUND");
  if (new Set(result.map((row) => row.month)).size !== result.length) throw new Error("ARERA_CMEM_MONTH_DUPLICATED");
  return result;
}

export async function fetchAreraCmem(fetcher: AreraCmemFetcher = fetch as unknown as AreraCmemFetcher): Promise<{ readonly rows: readonly AreraCmemRow[]; readonly sourceSha256: string }> {
  const response = await fetcher(ARERA_CMEM_PAGE, { headers: { Accept: "text/html", "User-Agent": "BillRegulatoryAuditEngine/1.0 (official-source-import)" } });
  if (response.status < 200 || response.status >= 300) throw new Error(`ARERA_HTTP_${response.status}`);
  const html = await response.text();
  return { rows: parseAreraCmemTable(html), sourceSha256: createHash("sha256").update(html, "utf8").digest("hex") };
}

const nextMonthStart = (month: string): string => { const [year, number] = month.split("-").map(Number); return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10); };

export function psvRecordFromCmem(input: { readonly tenantId: string; readonly row: AreraCmemRow; readonly sourceSha256: string; readonly retrievedAt: string }): GasMonthlyPsvRecord {
  return {
    schemaVersion: 1, recordId: `arera-psv-${input.row.month}`, version: "1", parentVersionId: null, tenantId: input.tenantId,
    approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" },
    recordType: "MONTHLY_MARKET_DATA", vector: "GAS", index: "PSV", month: input.row.month,
    publicationDate: input.retrievedAt.slice(0, 10), effectiveFrom: `${input.row.month}-01`, effectiveTo: nextMonthStart(input.row.month),
    source: { sourceId: ARERA_CMEM_SOURCE_ID, name: `ARERA CMEM,m — media mensile PSV day-ahead (${String(input.row.eurPerMwh).replace(".", ",")} €/MWh, PCS 0,038520 GJ/Smc)`, url: ARERA_CMEM_PAGE, authority: "ARERA", sourceType: "OFFICIAL", sourceSha256: input.sourceSha256 },
    value: { value: input.row.eurPerSmc, currency: "EUR", unit: "EUR_PER_SMC" },
  } as GasMonthlyPsvRecord;
}
