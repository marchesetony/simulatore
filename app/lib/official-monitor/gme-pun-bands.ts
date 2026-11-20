import { createHash } from "node:crypto";
import type { ElectricityMonthlyPunRecord } from "../energy/market-data";
import type { MarketArchiveRepository } from "../market/types";
import { approveMarketArchive, createMarketArchive } from "../market/service";
import { operationalMarketMonths, romeToday } from "../market/operational-window";
import { assertAllowedGmeUrl, publishedPdfText } from "../market/gme-pun-source";
import { findGmeMonthlyBandsPdf, parseGmeMonthlyBandsText, GME_MONTHLY_BANDS_SOURCE_ID } from "../market/gme-monthly-bands";

/**
 * Tony (20/11/2026, "PUN maggio 2026 — approvazione delle sole fasce"): il PDF ufficiale GME "Prezzo medio per fasce" di un mese
 * si carica in Control Room, si conserva così com'è con la sua impronta SHA-256 e diventa una nuova versione del PUN del mese
 * con le SOLE fasce F1, F2, F3 stampate. Il documento non stampa un valore mensile: il mensile non viene registrato, né ricavato
 * dalle fasce. Nessun dato è disponibile ai calcoli finché il produttore non pubblica il documento con conferma esplicita.
 */
export const GME_PUN_BANDS_DOCUMENT = "GME_PUN_BANDS_DOCUMENT" as const;

export interface GmeBandsCheck { readonly code: string; readonly ok: boolean; readonly detail: string }
export interface GmeBandsValues {
  readonly month: string;
  /** €/MWh, as printed (two decimals). */
  readonly f1: number;
  readonly f2: number;
  readonly f3: number;
  readonly hours: readonly [number, number, number];
  readonly unit: "EUR_PER_MWH";
}
export interface GmeBandsReading { readonly checks: readonly GmeBandsCheck[]; readonly values: GmeBandsValues | null }

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const isPdf = (bytes: Uint8Array) => bytes.byteLength > 4 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** Reads and checks the PDF for one month: title, month, unit, the three bands with their hours. Never derives a monthly value. */
export function readGmeBandsPdf(bytes: Uint8Array, month: string, now: string): GmeBandsReading {
  const checks: GmeBandsCheck[] = [];
  checks.push({ code: "FORMAT", ok: isPdf(bytes), detail: "atteso un file PDF (intestazione %PDF-)" });
  const periodOk = /^20\d\d-(0[1-9]|1[0-2])$/.test(month);
  checks.push({ code: "PERIOD_FORMAT", ok: periodOk, detail: `periodo "${month.slice(0, 20)}": atteso un mese AAAA-MM` });
  const window = operationalMarketMonths(romeToday(new Date(now)));
  checks.push({ code: "OPERATIONAL_WINDOW", ok: window.includes(month), detail: `finestra operativa (sei mesi chiusi): ${[...window].reverse().join(", ")}` });
  let text = "";
  try { text = isPdf(bytes) ? publishedPdfText(bytes).replace(/\s+/g, " ") : ""; } catch { text = ""; }
  checks.push({ code: "TEXT", ok: Boolean(text), detail: text ? "testo del PDF leggibile" : "testo del PDF non leggibile" });
  const titled = /prezzo medio/i.test(text) && /fasce/i.test(text);
  checks.push({ code: "TITLE", ok: titled, detail: titled ? "titolo GME \"Prezzo medio … per fasce\" trovato" : "titolo \"Prezzo medio per fasce\" non trovato" });
  let values: GmeBandsValues | null = null;
  if (text && periodOk) {
    try {
      // The parser checks the month label, the unit €/MWh, three bands with their hours and the hours of the month.
      const parsed = parseGmeMonthlyBandsText(text, month);
      values = { month, f1: parsed.f1, f2: parsed.f2, f3: parsed.f3, hours: parsed.hours, unit: "EUR_PER_MWH" };
      checks.push({ code: "VALUES", ok: true, detail: `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}, €/MWh: F1 ${parsed.f1} (${parsed.hours[0]} ore), F2 ${parsed.f2} (${parsed.hours[1]} ore), F3 ${parsed.f3} (${parsed.hours[2]} ore)` });
    } catch (error) {
      checks.push({ code: "VALUES", ok: false, detail: `fasce non lette: ${error instanceof Error ? error.message : "errore"}` });
    }
  }
  // Informative: the document prints no monthly value, and none is recorded or derived (Tony 20/11/2026).
  checks.push({ code: "MONTHLY_NOT_RECORDED", ok: true, detail: "il documento non stampa il PUN mensile: si registrano solo F1, F2, F3; il mensile resta assente e non è ricavato dalle fasce" });
  return { checks, values };
}

/** A PDF whose content is a GME "Prezzo medio per fasce" of one month: the month comes from the text, never from the file name. */
export function detectGmeBandsPdf(bytes: Uint8Array): string | null {
  if (!isPdf(bytes)) return null;
  let text = "";
  try { text = publishedPdfText(bytes).replace(/\s+/g, " "); } catch { return null; }
  if (!/prezzo medio/i.test(text) || !/fasce/i.test(text)) return null;
  const found = [...text.matchAll(new RegExp(`\\b(${MONTHS.join("|")})\\s*(20\\d\\d)\\b`, "gi"))].map((match) => `${match[2]}-${String(MONTHS.indexOf(match[1].toLowerCase()) + 1).padStart(2, "0")}`);
  const months = [...new Set(found)];
  return months.length === 1 ? months[0] : null;
}

export type BandsProvenance = { readonly level: "MATCHES_OFFICIAL_DOWNLOAD" | "EQUIVALENT_TO_OFFICIAL_DOWNLOAD" | "DIFFERS_FROM_OFFICIAL_DOWNLOAD" | "DECLARED_BY_PRODUCER"; readonly officialLink: string; readonly officialSha256: string | null; readonly detail: string; readonly comparison: "IDENTICAL" | "EQUIVALENT" | "DIFFERENT" | "NOT_DEMONSTRABLE" | "INVALID_DOWNLOAD" | "UNREACHABLE" | "NOT_ATTEMPTED"; readonly discardedDownloadSha256: string | null };

/** The uploaded PDF compared with the one on the GME site: same fingerprint, or same three bands, or blocked. */
export async function compareBandsWithGme(input: { readonly pageLink: string; readonly knownPdf: string | null; readonly month: string; readonly sha256: string; readonly values: GmeBandsValues | null; readonly now: string; readonly fetchOfficial?: (url: string) => Promise<Uint8Array | null> }): Promise<BandsProvenance> {
  const declared = (comparison: BandsProvenance["comparison"], detail: string, officialLink: string, discarded: string | null = null): BandsProvenance => ({ level: "DECLARED_BY_PRODUCER", officialLink, officialSha256: null, detail, comparison, discardedDownloadSha256: discarded });
  if (!input.fetchOfficial) return declared("NOT_ATTEMPTED", "provenienza dichiarata dal produttore: confronto con il sito GME non eseguito", input.knownPdf ?? input.pageLink);
  let pdfLink = input.knownPdf;
  if (!pdfLink) {
    const page = await input.fetchOfficial(input.pageLink).catch(() => null);
    if (!page) return declared("UNREACHABLE", "provenienza dichiarata dal produttore: pagina GME non raggiungibile per trovare il PDF ufficiale", input.pageLink);
    try { pdfLink = findGmeMonthlyBandsPdf(new TextDecoder().decode(page), input.month, input.pageLink); } catch { return declared("NOT_DEMONSTRABLE", "provenienza dichiarata dal produttore: sulla pagina GME non c'è il PDF del mese", input.pageLink); }
  }
  assertAllowedGmeUrl(pdfLink);
  const official = await input.fetchOfficial(pdfLink).catch(() => null);
  if (!official || official.byteLength === 0) return declared("UNREACHABLE", "provenienza dichiarata dal produttore: PDF GME non raggiungibile per il confronto dell'impronta", pdfLink);
  const downloadSha256 = sha(official);
  const reference = readGmeBandsPdf(official, input.month, input.now);
  if (!reference.values) return declared("INVALID_DOWNLOAD", "provenienza dichiarata dal produttore: il download dal sito GME non è un PDF per fasce leggibile, la sua impronta non è usata", pdfLink, downloadSha256);
  if (downloadSha256 === input.sha256) return { level: "MATCHES_OFFICIAL_DOWNLOAD", officialLink: pdfLink, officialSha256: downloadSha256, detail: "impronta SHA-256 identica al PDF scaricato dal sito GME", comparison: "IDENTICAL", discardedDownloadSha256: null };
  const same = input.values && (["f1", "f2", "f3"] as const).every((band) => input.values![band] === reference.values![band]) && input.values.hours.every((hours, index) => hours === reference.values!.hours[index]);
  if (!same) return { level: "DIFFERS_FROM_OFFICIAL_DOWNLOAD", officialLink: pdfLink, officialSha256: downloadSha256, detail: `impronta diversa dal PDF GME (${downloadSha256.slice(0, 12)}…) e fasce diverse: documento bloccato`, comparison: "DIFFERENT", discardedDownloadSha256: null };
  return { level: "EQUIVALENT_TO_OFFICIAL_DOWNLOAD", officialLink: pdfLink, officialSha256: downloadSha256, detail: `impronta diversa dal PDF GME (${downloadSha256.slice(0, 12)}…), ma F1, F2, F3 e ore identiche: da verificare, l'equivalenza non prova l'autenticità del file`, comparison: "EQUIVALENT", discardedDownloadSha256: null };
}

/**
 * Publication into the PUN archive of each company: a new version of the month with F1, F2, F3 only, the conserved document's
 * fingerprint and link, linked to the previous version of the month (approved or rejected, which stays as it is with its audit).
 */
export async function publishBandsToMarket(input: { readonly repository: MarketArchiveRepository; readonly tenants: readonly string[]; readonly values: GmeBandsValues; readonly sha256: string; readonly officialLink: string; readonly documentId: string; readonly publicationId: string; readonly publishedBy: string; readonly now: string }): Promise<readonly { readonly tenantId: string; readonly archiveId: string; readonly version: string; readonly reused: boolean }[]> {
  if (!operationalMarketMonths(romeToday(new Date(input.now))).includes(input.values.month)) throw new Error("OFFICIAL_PUBLISH_OUTSIDE_WINDOW");
  const results: { tenantId: string; archiveId: string; version: string; reused: boolean }[] = [];
  const rate = (value: number) => ({ value, currency: "EUR" as const, unit: "EUR_PER_MWH" as const });
  for (const tenantId of input.tenants) {
    const sameMonth = (await input.repository.list(tenantId)).filter((record) => record.vector === "EE" && record.index === "PUN" && record.month === input.values.month);
    // A retry after a partial publication reuses the version already written from this same document.
    const done = sameMonth.find((record) => record.record.source.sourceSha256 === input.sha256 && record.record.source.sourceId === GME_MONTHLY_BANDS_SOURCE_ID && (record.record as ElectricityMonthlyPunRecord).monthly === undefined);
    if (done) {
      if (done.status !== "APPROVED") await approveMarketArchive(input.repository, tenantId, done.archiveId, input.publishedBy, `${input.publicationId}-${tenantId}`, input.now);
      results.push({ tenantId, archiveId: done.archiveId, version: done.record.version, reused: true }); continue;
    }
    const versionOf = (value: string) => Number.parseInt(value, 10) || 0;
    const previous = [...sameMonth].sort((a, b) => versionOf(b.record.version) - versionOf(a.record.version))[0];
    const version = (previous ? versionOf(previous.record.version) : 0) + 1;
    const recordId = version === 1 ? `gme-pun-${input.values.month}` : `gme-pun-${input.values.month}-v${version}`;
    const [year, month] = input.values.month.split("-").map(Number);
    const record = {
      schemaVersion: 1, recordId, version: String(version), parentVersionId: previous?.archiveId ?? null, tenantId,
      recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month: input.values.month,
      f1: rate(input.values.f1), f2: rate(input.values.f2), f3: rate(input.values.f3),
      source: { sourceId: GME_MONTHLY_BANDS_SOURCE_ID, name: "GME Prezzo medio per fasce (PDF conservato in Control Room)", url: input.officialLink, authority: "GME", sourceType: "OFFICIAL", sourceSha256: input.sha256, relatedUrls: [input.officialLink] },
      approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" }, publicationDate: null,
      effectiveFrom: `${input.values.month}-01`, effectiveTo: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    } as unknown as ElectricityMonthlyPunRecord;
    const created = await createMarketArchive(input.repository, { tenantId, record, archiveId: recordId, now: input.now, actor: input.publishedBy });
    await approveMarketArchive(input.repository, tenantId, created.archiveId, input.publishedBy, `${input.publicationId}-${tenantId}`, input.now);
    results.push({ tenantId, archiveId: created.archiveId, version: String(version), reused: false });
  }
  return results;
}
