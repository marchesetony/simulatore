import type { RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_575_TIME_TABLES_URL, ARERA_MEASUREMENT_PAGE, ARERA_TIME_TABLES_REQUIRED, type AreraFetcher } from "../foundation/arera-electricity-regulatory.ts";

/** An official ARERA table the nightly refresh needs and that, when ARERA's site cannot be read, the platform owner downloads and uploads by hand
 *  (Tony, 6/11: "devi mettere un allert che quando aggiorni noi produttori dell'app dobbiamo scaricare e inserire le tabelle che servono secondo le indicazioni"). */
export interface RequiredOfficialTable {
  readonly code: "ARERA_TIME";
  readonly title: string;
  readonly page: string;
  readonly file: string;
  readonly instructions: readonly string[];
  /** The archive domains the table feeds; covered when an approved value read from this table covers 1 January of the year. */
  readonly domains: readonly { readonly componentCode: string; readonly customerScope: string; readonly normalizedUnit: string }[];
  readonly identifierMark: string;
}

export const REQUIRED_OFFICIAL_TABLES: readonly RequiredOfficialTable[] = [{
  code: "ARERA_TIME",
  title: "Tabelle TIME: tariffa del servizio di misura (MIS1 INS-RAV + MIS1 RES), BT altri usi",
  page: ARERA_MEASUREMENT_PAGE,
  file: ARERA_575_TIME_TABLES_URL,
  instructions: [
    "Apri la pagina ARERA \"Tariffa per il servizio di misura\".",
    "Scarica il file Excel delle tabelle TIME della delibera in vigore (oggi 575/2025/R/eel, file 575-2025-R-eel-TABELLE_TIME.xlsx).",
    "Caricalo qui sotto con \"Carica tabella\": l'app legge la riga \"Altre utenze in bassa tensione\" di Tabella 1 (MIS1 INS-RAV) e di Tabella 2 (MIS1 RES) e le somma per l'anno in corso.",
    "Non modificare il file: va caricato così come lo pubblica ARERA.",
  ],
  domains: [
    { componentCode: "METERING_FIXED", customerScope: "NON_DOMESTIC_BT_BTA1_5", normalizedUnit: "EUR/POD/YEAR" },
    { componentCode: "METERING_FIXED", customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit: "EUR/POD/YEAR" },
  ],
  identifierMark: ":TIME:",
}];

export interface RequiredTableAlert {
  readonly code: RequiredOfficialTable["code"];
  readonly year: number;
  readonly title: string;
  readonly page: string;
  readonly file: string;
  readonly instructions: readonly string[];
  readonly reason: "MISSING" | "NEXT_YEAR";
  readonly refreshError: string | null;
}

const coversJanuary = (record: RegulatoryValueRecord, year: number): boolean => {
  const day = Date.UTC(year, 0, 1);
  return Date.parse(record.effectiveFrom) <= day && (record.effectiveTo === null || Date.parse(record.effectiveTo) > day);
};

export function tableCoversYear(table: RequiredOfficialTable, approved: readonly RegulatoryValueRecord[], year: number): boolean {
  return table.domains.every((domain) => approved.some((record) => record.componentCode === domain.componentCode && record.customerScope === domain.customerScope && record.normalizedUnit === domain.normalizedUnit && record.officialIdentifier.includes(table.identifierMark) && coversJanuary(record, year)));
}

/** "Azione richiesta": a required table with no approved value for this year; from 15 December also for next year. */
export function requiredTableAlerts(approved: readonly RegulatoryValueRecord[], lastErrors: readonly string[], now: string): readonly RequiredTableAlert[] {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const years = date.getUTCMonth() === 11 && date.getUTCDate() >= 15 ? [year, year + 1] : [year];
  const alerts: RequiredTableAlert[] = [];
  for (const table of REQUIRED_OFFICIAL_TABLES) for (const wanted of years) {
    if (tableCoversYear(table, approved, wanted)) continue;
    const refreshError = lastErrors.find((error) => error.includes(ARERA_TIME_TABLES_REQUIRED)) ?? null;
    alerts.push({ code: table.code, year: wanted, title: table.title, page: table.page, file: table.file, instructions: table.instructions, reason: wanted === year ? "MISSING" : "NEXT_YEAR", refreshError });
  }
  return alerts;
}

/** Serves the uploaded file where the refresh would download it from ARERA, so the uploaded table goes through the same parser,
 *  checks and archive approval as the nightly refresh. Every other source is still read from ARERA. */
export function uploadedTableFetcher(table: RequiredOfficialTable, bytes: Uint8Array, base: AreraFetcher = fetch as unknown as AreraFetcher): AreraFetcher {
  return async (url, init) => {
    if (url === table.file) return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    // The table page is skipped, so the uploaded file is the only TIME file read.
    if (url === table.page) return new Response("", { status: 404 });
    return base(url, init);
  };
}
