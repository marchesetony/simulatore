import { createHash } from "node:crypto";
import type { TenantRecordRepository } from "../persistence/types";
import { catalogEntry, officialLinkFor, type OfficialDocumentCode, type OfficialSource } from "./catalog";
import { OFFICIAL_MONITOR_TENANT, setAlertStatus, type MonitorRepositories } from "./monitor";
import { readTitTable5File, validateTable5Year, type Table5Check, type Table5Value } from "./tit-table5";
import { GME_PUN_BANDS_DOCUMENT, compareBandsWithGme, detectGmeBandsPdf, publishBandsToMarket, readGmeBandsPdf, type GmeBandsValues } from "./gme-pun-bands";
import type { MarketArchiveRepository } from "../market/types";

/**
 * Control Room Produttore → Archivi ufficiali (Tony, 17/11/2026). Due operazioni distinte:
 * 1. "Valida documento": il file originale è conservato così com'è (base64) con impronta SHA-256, versione per documento e
 *    periodo, esito di ogni controllo e provenienza. Nessun dato diventa disponibile ai calcoli: l'alert passa solo a
 *    "File caricato, in validazione" (o "rifiutato").
 * 2. "Pubblica aggiornamento": solo per un documento VALIDATED, con conferma esplicita del produttore legata a quel documento:
 *    la schermata invia l'impronta SHA-256 della versione mostrata (il produttore non la trascrive più, Tony 17/11/2026 "flusso
 *    semplificato") e il server la confronta con quella conservata, poi ricalcola l'impronta e rilegge i valori dal file
 *    originale. Se la provenienza non è verificata (dichiarata, o equivalente ma non identica) serve la conferma esplicita del
 *    produttore, che non è un'autenticazione presso la fonte. La pubblicazione è un record a sé (append-only), il documento non viene riscritto. Solo dopo la
 *    pubblicazione l'alert è risolto e il dato è nell'archivio globale letto da tutte le aziende.
 * Nessuna versione precedente viene modificata: la nuova si aggiunge; vale l'ultima pubblicata.
 */
export const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
/** Documents that have a verified reader for a manual upload. The others come from the automatic refresh or a manual check. */
export const UPLOADABLE_DOCUMENTS: readonly OfficialDocumentCode[] = ["ARERA_TIT_TABLE5_REACTIVE", GME_PUN_BANDS_DOCUMENT];
/** First year of the TIT 2024-2027 period; a period beyond next year is not a published tariff yet. */
const FIRST_SUPPORTED_YEAR = 2024;

/**
 * Provenienza (Tony, 17/11/2026, "correzione minima PROVENANCE"): tre esiti del confronto con il file scaricato dalla fonte.
 * - MATCHES: impronta identica → verificata.
 * - EQUIVALENT: impronta diversa ma valori tariffari del periodo identici (tensione, tipo, fascia, valore, soglia), stessa unità
 *   e stesso anno → DA VERIFICARE: pubblicabile solo con la conferma esplicita del produttore; valori identici non provano
 *   l'autenticità del file.
 * - DIFFERS: valori diversi o equivalenza non dimostrabile → bloccato.
 * Un download che non è un Excel con la Tabella 5 leggibile non è un riferimento: la sua impronta non è usata e la provenienza
 * resta dichiarata (DECLARED_BY_PRODUCER, anch'essa da confermare).
 */
export type ProvenanceLevel = "MATCHES_OFFICIAL_DOWNLOAD" | "EQUIVALENT_TO_OFFICIAL_DOWNLOAD" | "DIFFERS_FROM_OFFICIAL_DOWNLOAD" | "DECLARED_BY_PRODUCER";
export const PROVENANCE_LABEL: Readonly<Record<ProvenanceLevel, string>> = {
  MATCHES_OFFICIAL_DOWNLOAD: "Verificata: impronta identica al file scaricato dal sito ufficiale",
  EQUIVALENT_TO_OFFICIAL_DOWNLOAD: "Da verificare: impronta diversa dal file scaricato dal sito ufficiale, valori tariffari del periodo identici (non è prova di autenticità)",
  DIFFERS_FROM_OFFICIAL_DOWNLOAD: "Bloccata: valori diversi dal file pubblicato sul sito ufficiale, o equivalenza non dimostrabile",
  DECLARED_BY_PRODUCER: "Solo dichiarata dal produttore: impronta non confrontata con il sito ufficiale (non è prova di autenticità)",
};
/** Levels that may be published only with the producer's explicit acknowledgment. */
export const PROVENANCE_NEEDS_ACK: readonly ProvenanceLevel[] = ["EQUIVALENT_TO_OFFICIAL_DOWNLOAD", "DECLARED_BY_PRODUCER"];
export type ProvenanceComparison = "IDENTICAL" | "EQUIVALENT" | "DIFFERENT" | "NOT_DEMONSTRABLE" | "INVALID_DOWNLOAD" | "UNREACHABLE" | "NOT_ATTEMPTED";

export interface OfficialDocumentRecord {
  readonly documentId: string;
  readonly code: OfficialDocumentCode;
  readonly source: OfficialSource;
  readonly period: string;
  readonly version: number;
  readonly originalName: string;
  readonly size: number;
  readonly sha256: string;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
  readonly originalBase64: string;
  readonly provenance: {
    readonly level: ProvenanceLevel;
    readonly officialLink: string;
    /** SHA-256 of the official reference: only a download that is a valid Excel with a readable Tabella 5. */
    readonly officialSha256: string | null;
    readonly detail: string;
    /** Outcome of the comparison (absent on records created before 17/11/2026 correction). */
    readonly comparison?: ProvenanceComparison;
    /** Fingerprint of a download that was NOT a valid reference (kept for audit, never used as official). */
    readonly discardedDownloadSha256?: string | null;
  };
  readonly checks: readonly Table5Check[];
  readonly warnings: readonly string[];
  readonly status: "VALIDATED" | "REJECTED";
  readonly values: readonly Table5Value[];
  /** GME "Prezzo medio per fasce": the three bands read from the PDF (no monthly value). */
  readonly marketValues?: GmeBandsValues | null;
  readonly structure: { readonly sheet: string | null; readonly titleCell: string | null; readonly years: readonly number[] };
}

export interface OfficialPublicationRecord {
  readonly publicationId: string;
  readonly documentId: string;
  readonly code: OfficialDocumentCode;
  readonly source: OfficialSource;
  readonly period: string;
  readonly version: number;
  readonly sha256: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly provenanceLevel: ProvenanceLevel;
  /** True when the producer explicitly accepted a provenance that is not verified (declared, or equivalent but not identical). */
  readonly provenanceAcknowledged: boolean;
  /** Publication this one replaces for the same document and period, if any. */
  readonly supersedes: string | null;
  /** GME bands: the PUN versions written into each company's archive. */
  readonly marketRecords?: readonly { readonly tenantId: string; readonly archiveId: string; readonly version: string; readonly reused: boolean }[];
}

export type DocumentRepositories = MonitorRepositories & { readonly documents: TenantRecordRepository<unknown>; readonly publications: TenantRecordRepository<unknown> };

export interface ValidateInput {
  readonly code: OfficialDocumentCode;
  readonly period: string;
  readonly originalName: string;
  readonly bytes: Uint8Array;
  readonly uploadedBy: string;
  readonly now: string;
  /** Downloads the official file to compare fingerprints; null when the official site cannot be reached. */
  readonly fetchOfficial?: (url: string) => Promise<Uint8Array | null>;
}
export interface ValidateResult { readonly record: OfficialDocumentRecord; readonly duplicate: boolean }

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const allDocuments = async (documents: TenantRecordRepository<unknown>) => (await documents.list(OFFICIAL_MONITOR_TENANT)).map((record) => record.payload as OfficialDocumentRecord);
export const allPublications = async (publications: TenantRecordRepository<unknown>) => (await publications.list(OFFICIAL_MONITOR_TENANT)).map((record) => record.payload as OfficialPublicationRecord);

/** "Valida documento": reads and checks the file, stores it with its fingerprint. Never makes data available to calculations. */
export async function validateOfficialDocument(repositories: DocumentRepositories, input: ValidateInput): Promise<ValidateResult> {
  if (!UPLOADABLE_DOCUMENTS.includes(input.code)) throw new Error(`OFFICIAL_UPLOAD_NOT_SUPPORTED:${input.code}`);
  if (input.code === GME_PUN_BANDS_DOCUMENT) return validateGmeBandsDocument(repositories, input);
  if (!/^20\d\d$/.test(input.period)) throw new Error("OFFICIAL_UPLOAD_PERIOD_INVALID");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ORIGINAL_BYTES) throw new Error("OFFICIAL_UPLOAD_SIZE_INVALID");
  const entry = catalogEntry(input.code);
  const year = Number(input.period);
  const sha256 = sha(input.bytes);
  const existing = (await allDocuments(repositories.documents)).filter((record) => record.code === input.code && record.period === input.period);
  // Same file already validated for the same document and period: no new version, the stored validation is returned. A rejected
  // file may be validated again (provenance and the period window depend on when and where the check runs).
  const same = existing.filter((record) => record.sha256 === sha256 && record.status === "VALIDATED").sort((a, b) => b.version - a.version)[0];
  if (same) return { record: same, duplicate: true };

  const checks: Table5Check[] = [];
  // The browser's file name is only a hint: the content decides. The name check is reported, never trusted.
  checks.push({ code: "FORMAT_NAME", ok: /\.xlsx$/i.test(input.originalName), detail: `nome "${input.originalName.slice(0, 160)}": atteso un file .xlsx` });
  const currentYear = new Date(input.now).getUTCFullYear();
  checks.push({ code: "PERIOD_WINDOW", ok: year >= FIRST_SUPPORTED_YEAR && year <= currentYear + 1, detail: `periodo ${year}: ammesso dal ${FIRST_SUPPORTED_YEAR} al ${currentYear + 1}` });
  let reading: ReturnType<typeof readTitTable5File> | null = null;
  try { reading = readTitTable5File(input.bytes); checks.push({ code: "INTEGRITY", ok: true, detail: "archivio xlsx integro: CRC-32 e dimensioni di ogni parte verificati" }); }
  catch (error) { checks.push({ code: "INTEGRITY", ok: false, detail: `file non leggibile come Excel integro: ${error instanceof Error ? error.message : "errore"}` }); }
  const period = reading ? validateTable5Year(reading, year) : null;
  if (reading) checks.push(...reading.checks);
  if (period) checks.push(...period.checks.filter((check) => !reading?.checks.some((item) => item.code === check.code)));

  // Provenance: the uploaded file is compared with the one on the official site when the site can be reached.
  const officialLink = officialLinkFor(entry, input.period);
  const provenance = await compareWithOfficial({ officialLink, sha256, year, uploaded: period, fetchOfficial: input.fetchOfficial });
  checks.push({ code: "PROVENANCE", ok: provenance.level !== "DIFFERS_FROM_OFFICIAL_DOWNLOAD", detail: provenance.detail });

  const status = checks.every((item) => item.ok) ? "VALIDATED" : "REJECTED";
  const version = existing.reduce((highest, record) => Math.max(highest, record.version), 0) + 1;
  const documentId = `official-document_${createHash("sha256").update(`${input.code}|${input.period}|${version}|${sha256}`, "utf8").digest("hex").slice(0, 40)}`;
  const record: OfficialDocumentRecord = {
    documentId, code: input.code, source: entry.source, period: input.period, version, originalName: input.originalName.slice(0, 160), size: input.bytes.byteLength, sha256,
    uploadedAt: input.now, uploadedBy: input.uploadedBy, originalBase64: Buffer.from(input.bytes).toString("base64"), provenance, checks,
    warnings: reading?.warnings ?? [], status, values: status === "VALIDATED" ? period!.values : [],
    structure: reading?.structure ?? { sheet: null, titleCell: null, years: [] },
  };
  await repositories.documents.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: documentId, payload: record, idempotencyKey: documentId, now: input.now });
  await setAlertStatus(repositories, input.code, input.period, status === "VALIDATED" ? "FILE_UPLOADED" : "REJECTED", status === "VALIDATED" ? `file v${version} validato (SHA-256 ${sha256.slice(0, 12)}…), in attesa di pubblicazione` : `file v${version} rifiutato: ${checks.filter((item) => !item.ok).map((item) => item.code).join(", ")}`, input.now);
  return { record, duplicate: false };
}

/**
 * Flusso semplificato (Tony, 17/11/2026): tipo e periodo rilevati dal contenuto quando sono verificabili, mai dal nome del file.
 * Tipo: oggi solo la Tabella 5 del TIT ha un lettore verificato (titolo "Tabella 5 … reattiva" trovato nel file). Periodo:
 * l'anno di un alert aperto per quel documento, se il file lo contiene; altrimenti l'anno in corso, se il file lo contiene.
 * Più alert aperti o nessun anno riconoscibile: il periodo va scelto dal produttore. La validazione completa resta quella di
 * validateOfficialDocument: il rilevamento decide soltanto dove il file va validato.
 */
export interface DetectedUpload { readonly code: OfficialDocumentCode; readonly period: string; readonly basis: string }
export function detectOfficialUpload(bytes: Uint8Array, input: { readonly openAlerts: readonly { readonly code: string; readonly period: string; readonly status: string }[]; readonly now: string }): DetectedUpload {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ORIGINAL_BYTES) throw new Error("OFFICIAL_UPLOAD_SIZE_INVALID");
  const gmeMonth = detectGmeBandsPdf(bytes);
  if (gmeMonth) return { code: GME_PUN_BANDS_DOCUMENT, period: gmeMonth, basis: `PDF GME "Prezzo medio per fasce" di ${gmeMonth}, letto dal contenuto` };
  let reading: ReturnType<typeof readTitTable5File>;
  try { reading = readTitTable5File(bytes); } catch { throw new Error("OFFICIAL_UPLOAD_TYPE_UNKNOWN"); }
  if (!reading.structure.sheet) throw new Error("OFFICIAL_UPLOAD_TYPE_UNKNOWN");
  const code: OfficialDocumentCode = "ARERA_TIT_TABLE5_REACTIVE";
  const years = reading.structure.years.map(String);
  const open = [...new Set(input.openAlerts.filter((alert) => alert.code === code && alert.status !== "RESOLVED" && years.includes(alert.period)).map((alert) => alert.period))];
  if (open.length === 1) return { code, period: open[0], basis: `anno ${open[0]} richiesto dall'alert aperto e presente nel file` };
  if (open.length > 1) throw new Error("OFFICIAL_UPLOAD_PERIOD_AMBIGUOUS");
  const current = String(new Date(input.now).getUTCFullYear());
  if (years.includes(current)) return { code, period: current, basis: `anno in corso ${current}, presente nel file` };
  throw new Error("OFFICIAL_UPLOAD_PERIOD_UNDETERMINED");
}

/** Tariff content that must match: classification, value and threshold of every row of the period (cell positions may move). */
const tariffKey = (values: readonly Table5Value[]) => values.map((value) => [value.voltage, value.year, value.kind, value.band, value.centsPerKvarh, value.thresholdRatio].join("|")).sort().join(";");

async function compareWithOfficial(input: { readonly officialLink: string; readonly sha256: string; readonly year: number; readonly uploaded: ReturnType<typeof validateTable5Year> | null; readonly fetchOfficial?: (url: string) => Promise<Uint8Array | null> }): Promise<OfficialDocumentRecord["provenance"]> {
  const { officialLink } = input;
  const declared = (comparison: ProvenanceComparison, detail: string, discardedDownloadSha256: string | null = null): OfficialDocumentRecord["provenance"] => ({ level: "DECLARED_BY_PRODUCER", officialLink, officialSha256: null, detail, comparison, discardedDownloadSha256 });
  if (!input.fetchOfficial || !/\.xlsx$/i.test(officialLink)) return declared("NOT_ATTEMPTED", "provenienza dichiarata dal produttore: nessun file ufficiale da scaricare per il confronto dell'impronta");
  const official = await input.fetchOfficial(officialLink).catch(() => null);
  if (!official || official.byteLength === 0) return declared("UNREACHABLE", "provenienza dichiarata dal produttore: sito ufficiale non raggiungibile per il confronto dell'impronta");
  const downloadSha256 = sha(official);
  // The download is a reference only if it is itself a valid Excel with a readable Tabella 5 (not an HTML page, not a broken file).
  let officialReading: ReturnType<typeof readTitTable5File>;
  try { officialReading = readTitTable5File(official); } catch { return declared("INVALID_DOWNLOAD", "provenienza dichiarata dal produttore: il download dal sito ufficiale non è un Excel valido, la sua impronta non è usata come riferimento", downloadSha256); }
  if (!officialReading.ok) return declared("INVALID_DOWNLOAD", "provenienza dichiarata dal produttore: nel download dal sito ufficiale la Tabella 5 non è leggibile, la sua impronta non è usata come riferimento", downloadSha256);
  if (downloadSha256 === input.sha256) return { level: "MATCHES_OFFICIAL_DOWNLOAD", officialLink, officialSha256: downloadSha256, detail: "impronta SHA-256 identica al file scaricato dal sito ufficiale", comparison: "IDENTICAL", discardedDownloadSha256: null };
  // Different fingerprint: equivalence must be demonstrated on the tariff content of the period, with the unit and year of both files.
  const officialPeriod = validateTable5Year(officialReading, input.year);
  const differs = (comparison: ProvenanceComparison, detail: string): OfficialDocumentRecord["provenance"] => ({ level: "DIFFERS_FROM_OFFICIAL_DOWNLOAD", officialLink, officialSha256: downloadSha256, detail, comparison, discardedDownloadSha256: null });
  if (!input.uploaded?.ok || !officialPeriod.ok) return differs("NOT_DEMONSTRABLE", `impronta diversa dal file ufficiale (${downloadSha256.slice(0, 12)}…) e anno ${input.year} non leggibile in entrambi i file: equivalenza non dimostrabile`);
  const unitOk = (checks: readonly Table5Check[]) => checks.some((check) => check.code === "UNIT" && check.ok);
  if (!unitOk(officialReading.checks)) return differs("NOT_DEMONSTRABLE", "impronta diversa dal file ufficiale e unità di misura non confermata nel file ufficiale: equivalenza non dimostrabile");
  if (tariffKey(input.uploaded.values) !== tariffKey(officialPeriod.values)) return differs("DIFFERENT", `impronta diversa dal file ufficiale (${downloadSha256.slice(0, 12)}…) e valori tariffari ${input.year} diversi: documento bloccato`);
  return { level: "EQUIVALENT_TO_OFFICIAL_DOWNLOAD", officialLink, officialSha256: downloadSha256, detail: `impronta diversa dal file ufficiale (${downloadSha256.slice(0, 12)}…), ma ${input.uploaded.values.length} valori ${input.year} identici per tensione, tipo, fascia, valore e soglia, stessa unità c€/kvarh: da verificare, l'equivalenza non prova l'autenticità del file`, comparison: "EQUIVALENT", discardedDownloadSha256: null };
}

export interface PublishInput {
  readonly documentId: string;
  /**
   * SHA-256 of the exact version the producer confirmed on screen (sent by the confirmation, no longer typed by hand). It binds the
   * confirmation to that version: a different or changed document is refused, and the server re-checks the stored original anyway.
   */
  readonly confirmSha256: string;
  /** Required when the provenance is only declared, or equivalent but not identical (DA VERIFICARE). */
  readonly acknowledgeDeclaredProvenance: boolean;
  readonly publishedBy: string;
  readonly now: string;
  /** GME bands only: the PUN archive and the companies the new version is written for. */
  readonly market?: { readonly repository: MarketArchiveRepository; readonly tenants: readonly string[] };
}

/** "Pubblica aggiornamento": only a fully validated document, explicitly confirmed, re-checked from the stored original. */
export async function publishOfficialDocument(repositories: DocumentRepositories, input: PublishInput): Promise<OfficialPublicationRecord> {
  const stored = await repositories.documents.get(OFFICIAL_MONITOR_TENANT, input.documentId);
  if (!stored) throw new Error("OFFICIAL_PUBLISH_DOCUMENT_NOT_FOUND");
  const document = stored.payload as OfficialDocumentRecord;
  if (document.status !== "VALIDATED" || !document.checks.every((check) => check.ok)) throw new Error("OFFICIAL_PUBLISH_NOT_VALIDATED");
  if (input.confirmSha256.trim().toLowerCase() !== document.sha256) throw new Error("OFFICIAL_PUBLISH_CONFIRMATION_MISMATCH");
  if (document.provenance.level === "DIFFERS_FROM_OFFICIAL_DOWNLOAD") throw new Error("OFFICIAL_PUBLISH_PROVENANCE_REJECTED");
  if (PROVENANCE_NEEDS_ACK.includes(document.provenance.level) && input.acknowledgeDeclaredProvenance !== true) throw new Error("OFFICIAL_PUBLISH_PROVENANCE_ACK_REQUIRED");
  // The stored original is read again: fingerprint and values must be the ones that were validated.
  const original = new Uint8Array(Buffer.from(document.originalBase64, "base64"));
  if (sha(original) !== document.sha256) throw new Error("OFFICIAL_PUBLISH_INTEGRITY_FAILED");
  if (document.code === GME_PUN_BANDS_DOCUMENT) return publishGmeBandsDocument(repositories, document, original, input);
  const again = validateTable5Year(readTitTable5File(original), Number(document.period));
  const fingerprint = (values: readonly Table5Value[]) => values.map((value) => [value.voltage, value.year, value.kind, value.band, value.centsPerKvarh, value.thresholdRatio, value.sheet, value.cell].join("|")).sort().join(";");
  if (!again.ok || fingerprint(again.values) !== fingerprint(document.values)) throw new Error("OFFICIAL_PUBLISH_CONTENT_CHANGED");

  const samePeriod = (await allPublications(repositories.publications)).filter((item) => item.code === document.code && item.period === document.period).sort((a, b) => b.version - a.version || b.publishedAt.localeCompare(a.publishedAt));
  const current = samePeriod[0];
  if (current?.documentId === document.documentId) throw new Error("OFFICIAL_PUBLISH_ALREADY_PUBLISHED");
  if (current && current.version > document.version) throw new Error("OFFICIAL_PUBLISH_OLDER_VERSION");
  const publicationId = `official-publication_${createHash("sha256").update(`${document.documentId}|publish`, "utf8").digest("hex").slice(0, 40)}`;
  const publication: OfficialPublicationRecord = {
    publicationId, documentId: document.documentId, code: document.code, source: document.source, period: document.period, version: document.version, sha256: document.sha256,
    publishedAt: input.now, publishedBy: input.publishedBy, provenanceLevel: document.provenance.level, provenanceAcknowledged: PROVENANCE_NEEDS_ACK.includes(document.provenance.level),
    supersedes: current?.publicationId ?? null,
  };
  await repositories.publications.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: publicationId, payload: publication, idempotencyKey: publicationId, now: input.now });
  await setAlertStatus(repositories, document.code, document.period, "RESOLVED", `pubblicato v${document.version} (SHA-256 ${document.sha256.slice(0, 12)}…) da ${input.publishedBy}`, input.now);
  return publication;
}

/** Published versions only, the latest publication per period, newest period first. Validated but unpublished files never count. */
export async function publishedDocuments(repositories: { readonly documents: TenantRecordRepository<unknown>; readonly publications: TenantRecordRepository<unknown> }, code: OfficialDocumentCode): Promise<readonly OfficialDocumentRecord[]> {
  const latest = new Map<string, OfficialPublicationRecord>();
  for (const item of (await allPublications(repositories.publications)).filter((publication) => publication.code === code)) {
    const current = latest.get(item.period);
    if (!current || item.version > current.version) latest.set(item.period, item);
  }
  const out: OfficialDocumentRecord[] = [];
  for (const publication of latest.values()) {
    const stored = await repositories.documents.get(OFFICIAL_MONITOR_TENANT, publication.documentId);
    const document = stored?.payload as OfficialDocumentRecord | undefined;
    if (document && document.status === "VALIDATED" && document.sha256 === publication.sha256) out.push(document);
  }
  return out.sort((a, b) => b.period.localeCompare(a.period));
}

/** Manual verification of a document with no automatic source (ADM): closes the alert with who confirmed it and what. */
export async function confirmManualVerification(repositories: MonitorRepositories, input: { readonly code: OfficialDocumentCode; readonly period: string; readonly note: string; readonly confirmedBy: string; readonly now: string }) {
  if (catalogEntry(input.code).acquisition !== "MANUAL_VERIFICATION") throw new Error("OFFICIAL_CONFIRMATION_NOT_ALLOWED");
  const note = input.note.trim().slice(0, 300);
  if (note.length < 10) throw new Error("OFFICIAL_CONFIRMATION_NOTE_REQUIRED");
  return setAlertStatus(repositories, input.code, input.period, "RESOLVED", `verifica manuale di ${input.confirmedBy}: ${note}`, input.now);
}

/** Summary without the original bytes, for screens and API answers. */
export function documentSummary(record: OfficialDocumentRecord): Omit<OfficialDocumentRecord, "originalBase64"> {
  const { originalBase64: _omitted, ...rest } = record; void _omitted; return rest;
}

// Tony (20/11/2026, "PUN maggio 2026 — approvazione delle sole fasce"): the GME PDF of one month, conserved and checked like the
// TIT table; the publication writes a new PUN version with F1, F2, F3 only into every company's archive.
async function validateGmeBandsDocument(repositories: DocumentRepositories, input: ValidateInput): Promise<ValidateResult> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ORIGINAL_BYTES) throw new Error("OFFICIAL_UPLOAD_SIZE_INVALID");
  const entry = catalogEntry(input.code);
  const sha256 = sha(input.bytes);
  const existing = (await allDocuments(repositories.documents)).filter((record) => record.code === input.code && record.period === input.period);
  const same = existing.filter((record) => record.sha256 === sha256 && record.status === "VALIDATED").sort((a, b) => b.version - a.version)[0];
  if (same) return { record: same, duplicate: true };
  const reading = readGmeBandsPdf(input.bytes, input.period, input.now);
  const checks: Table5Check[] = [{ code: "FORMAT_NAME", ok: /\.pdf$/i.test(input.originalName), detail: `nome "${input.originalName.slice(0, 160)}": atteso un file .pdf` }, ...reading.checks];
  const known = entry.linkByPeriod?.[input.period] ?? null;
  const provenance = await compareBandsWithGme({ pageLink: entry.officialLink, knownPdf: known, month: input.period, sha256, values: reading.values, now: input.now, fetchOfficial: input.fetchOfficial });
  checks.push({ code: "PROVENANCE", ok: provenance.level !== "DIFFERS_FROM_OFFICIAL_DOWNLOAD", detail: provenance.detail });
  const status = checks.every((item) => item.ok) && reading.values ? "VALIDATED" : "REJECTED";
  const version = existing.reduce((highest, record) => Math.max(highest, record.version), 0) + 1;
  const documentId = `official-document_${createHash("sha256").update(`${input.code}|${input.period}|${version}|${sha256}`, "utf8").digest("hex").slice(0, 40)}`;
  const record: OfficialDocumentRecord = {
    documentId, code: input.code, source: entry.source, period: input.period, version, originalName: input.originalName.slice(0, 160), size: input.bytes.byteLength, sha256,
    uploadedAt: input.now, uploadedBy: input.uploadedBy, originalBase64: Buffer.from(input.bytes).toString("base64"), provenance, checks, warnings: [], status,
    values: [], marketValues: status === "VALIDATED" ? reading.values : null, structure: { sheet: null, titleCell: null, years: [] },
  };
  await repositories.documents.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: documentId, payload: record, idempotencyKey: documentId, now: input.now });
  await setAlertStatus(repositories, input.code, input.period, status === "VALIDATED" ? "FILE_UPLOADED" : "REJECTED", status === "VALIDATED" ? `file v${version} validato (SHA-256 ${sha256.slice(0, 12)}…), in attesa di pubblicazione` : `file v${version} rifiutato: ${checks.filter((item) => !item.ok).map((item) => item.code).join(", ")}`, input.now);
  return { record, duplicate: false };
}

async function publishGmeBandsDocument(repositories: DocumentRepositories, document: OfficialDocumentRecord, original: Uint8Array, input: PublishInput): Promise<OfficialPublicationRecord> {
  if (!input.market || !input.market.tenants.length) throw new Error("OFFICIAL_PUBLISH_MARKET_UNAVAILABLE");
  // The stored original is read again: the three bands must be the ones that were validated.
  const again = readGmeBandsPdf(original, document.period, input.now);
  const stored = document.marketValues;
  if (!again.values || !stored || (["f1", "f2", "f3"] as const).some((band) => again.values![band] !== stored[band]) || again.values.hours.some((hours, index) => hours !== stored.hours[index])) throw new Error("OFFICIAL_PUBLISH_CONTENT_CHANGED");
  if (!again.checks.every((check) => check.ok)) throw new Error("OFFICIAL_PUBLISH_NOT_VALIDATED");
  const samePeriod = (await allPublications(repositories.publications)).filter((item) => item.code === document.code && item.period === document.period).sort((a, b) => b.version - a.version || b.publishedAt.localeCompare(a.publishedAt));
  const current = samePeriod[0];
  if (current?.documentId === document.documentId) throw new Error("OFFICIAL_PUBLISH_ALREADY_PUBLISHED");
  if (current && current.version > document.version) throw new Error("OFFICIAL_PUBLISH_OLDER_VERSION");
  const publicationId = `official-publication_${createHash("sha256").update(`${document.documentId}|publish`, "utf8").digest("hex").slice(0, 40)}`;
  const officialLink = document.provenance.officialLink;
  const marketRecords = await publishBandsToMarket({ repository: input.market.repository, tenants: input.market.tenants, values: again.values, sha256: document.sha256, officialLink, documentId: document.documentId, publicationId, publishedBy: input.publishedBy, now: input.now });
  const publication: OfficialPublicationRecord = {
    publicationId, documentId: document.documentId, code: document.code, source: document.source, period: document.period, version: document.version, sha256: document.sha256,
    publishedAt: input.now, publishedBy: input.publishedBy, provenanceLevel: document.provenance.level, provenanceAcknowledged: PROVENANCE_NEEDS_ACK.includes(document.provenance.level),
    supersedes: current?.publicationId ?? null, marketRecords,
  };
  await repositories.publications.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: publicationId, payload: publication, idempotencyKey: publicationId, now: input.now });
  await setAlertStatus(repositories, document.code, document.period, "RESOLVED", `pubblicato v${document.version} (SHA-256 ${document.sha256.slice(0, 12)}…) da ${input.publishedBy}: sole fasce F1, F2, F3`, input.now);
  return publication;
}
