import { createHash } from "node:crypto";
import type { TenantRecordRepository } from "../persistence/types";
import { catalogEntry, officialLinkFor, type OfficialDocumentCode, type OfficialSource } from "./catalog";
import { OFFICIAL_MONITOR_TENANT, setAlertStatus, type MonitorRepositories } from "./monitor";
import { readTitTable5File, validateTable5Year, type Table5Check, type Table5Value } from "./tit-table5";

/**
 * Control Room Produttore → Archivi ufficiali (Tony, 17/11/2026). Due operazioni distinte:
 * 1. "Valida documento": il file originale è conservato così com'è (base64) con impronta SHA-256, versione per documento e
 *    periodo, esito di ogni controllo e provenienza. Nessun dato diventa disponibile ai calcoli: l'alert passa solo a
 *    "File caricato, in validazione" (o "rifiutato").
 * 2. "Pubblica aggiornamento": solo per un documento VALIDATED, con conferma esplicita del produttore che riscrive lo SHA-256
 *    del file; se la provenienza è soltanto dichiarata (impronta non confrontata con il sito ufficiale) serve una seconda
 *    conferma esplicita. La pubblicazione è un record a sé (append-only), il documento non viene riscritto. Solo dopo la
 *    pubblicazione l'alert è risolto e il dato è nell'archivio globale letto da tutte le aziende.
 * Nessuna versione precedente viene modificata: la nuova si aggiunge; vale l'ultima pubblicata.
 */
export const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
/** Documents that have a verified reader for a manual upload. The others come from the automatic refresh or a manual check. */
export const UPLOADABLE_DOCUMENTS: readonly OfficialDocumentCode[] = ["ARERA_TIT_TABLE5_REACTIVE"];
/** First year of the TIT 2024-2027 period; a period beyond next year is not a published tariff yet. */
const FIRST_SUPPORTED_YEAR = 2024;

export type ProvenanceLevel = "MATCHES_OFFICIAL_DOWNLOAD" | "DIFFERS_FROM_OFFICIAL_DOWNLOAD" | "DECLARED_BY_PRODUCER";
export const PROVENANCE_LABEL: Readonly<Record<ProvenanceLevel, string>> = {
  MATCHES_OFFICIAL_DOWNLOAD: "Verificata: impronta identica al file scaricato dal sito ufficiale",
  DIFFERS_FROM_OFFICIAL_DOWNLOAD: "Respinta: impronta diversa dal file pubblicato sul sito ufficiale",
  DECLARED_BY_PRODUCER: "Solo dichiarata dal produttore: impronta non confrontata con il sito ufficiale (non è prova di autenticità)",
};

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
  readonly provenance: { readonly level: ProvenanceLevel; readonly officialLink: string; readonly officialSha256: string | null; readonly detail: string };
  readonly checks: readonly Table5Check[];
  readonly warnings: readonly string[];
  readonly status: "VALIDATED" | "REJECTED";
  readonly values: readonly Table5Value[];
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
  /** True when the producer explicitly accepted a provenance that is only declared. */
  readonly provenanceAcknowledged: boolean;
  /** Publication this one replaces for the same document and period, if any. */
  readonly supersedes: string | null;
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
  let provenance: OfficialDocumentRecord["provenance"] = { level: "DECLARED_BY_PRODUCER", officialLink, officialSha256: null, detail: "provenienza dichiarata dal produttore: sito ufficiale non raggiungibile per il confronto dell'impronta" };
  if (input.fetchOfficial && /\.xlsx$/i.test(officialLink)) {
    const official = await input.fetchOfficial(officialLink).catch(() => null);
    if (official) {
      const officialSha256 = sha(official);
      provenance = officialSha256 === sha256
        ? { level: "MATCHES_OFFICIAL_DOWNLOAD", officialLink, officialSha256, detail: "impronta SHA-256 identica al file scaricato dal sito ARERA" }
        : { level: "DIFFERS_FROM_OFFICIAL_DOWNLOAD", officialLink, officialSha256, detail: "impronta diversa dal file oggi pubblicato da ARERA: file modificato o versione diversa" };
    }
  }
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

export interface PublishInput {
  readonly documentId: string;
  /** The producer re-types (or pastes) the SHA-256 shown in the preview: the explicit confirmation of what is published. */
  readonly confirmSha256: string;
  /** Required when the provenance is only declared by the producer. */
  readonly acknowledgeDeclaredProvenance: boolean;
  readonly publishedBy: string;
  readonly now: string;
}

/** "Pubblica aggiornamento": only a fully validated document, explicitly confirmed, re-checked from the stored original. */
export async function publishOfficialDocument(repositories: DocumentRepositories, input: PublishInput): Promise<OfficialPublicationRecord> {
  const stored = await repositories.documents.get(OFFICIAL_MONITOR_TENANT, input.documentId);
  if (!stored) throw new Error("OFFICIAL_PUBLISH_DOCUMENT_NOT_FOUND");
  const document = stored.payload as OfficialDocumentRecord;
  if (document.status !== "VALIDATED" || !document.checks.every((check) => check.ok)) throw new Error("OFFICIAL_PUBLISH_NOT_VALIDATED");
  if (input.confirmSha256.trim().toLowerCase() !== document.sha256) throw new Error("OFFICIAL_PUBLISH_CONFIRMATION_MISMATCH");
  if (document.provenance.level === "DIFFERS_FROM_OFFICIAL_DOWNLOAD") throw new Error("OFFICIAL_PUBLISH_PROVENANCE_REJECTED");
  if (document.provenance.level === "DECLARED_BY_PRODUCER" && input.acknowledgeDeclaredProvenance !== true) throw new Error("OFFICIAL_PUBLISH_PROVENANCE_ACK_REQUIRED");
  // The stored original is read again: fingerprint and values must be the ones that were validated.
  const original = new Uint8Array(Buffer.from(document.originalBase64, "base64"));
  if (sha(original) !== document.sha256) throw new Error("OFFICIAL_PUBLISH_INTEGRITY_FAILED");
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
    publishedAt: input.now, publishedBy: input.publishedBy, provenanceLevel: document.provenance.level, provenanceAcknowledged: document.provenance.level === "DECLARED_BY_PRODUCER",
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
