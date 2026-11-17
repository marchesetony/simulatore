import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { AuditLogger } from "../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { OFFICIAL_CATALOG, dueChecks, type OfficialDocumentCode } from "../../../lib/official-monitor/catalog";
import { archiveOverview, documentPreview } from "../../../lib/official-monitor/archives";
import { UPLOADABLE_DOCUMENTS, confirmManualVerification, detectOfficialUpload, publishOfficialDocument, validateOfficialDocument, type DetectedUpload, type OfficialDocumentRecord } from "../../../lib/official-monitor/documents";
import type { OfficialAlert } from "../../../lib/official-monitor/monitor";
import { runOfficialMonitor } from "../../../lib/official-monitor/monitor";
import { liveProbes } from "../../../lib/official-monitor/probes";
import { computeCoverage, type CoverageCopy, type CoverageReport } from "../../../lib/official-monitor/coverage";
import type { OfficialCheck } from "../../../lib/official-monitor/monitor";
import { allPublications, type OfficialPublicationRecord } from "../../../lib/official-monitor/documents";
import { officialDataTenants } from "../../../lib/automation/official-data-tenants";
import { configuredMarketRefreshTenants } from "../../../lib/market-refresh/config";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Control Room Produttore → Archivi ufficiali (Tony, 17/11/2026). Solo il produttore della piattaforma (ADMIN di
 * tenant_piattaforma), verificato qui sul server dalla sessione: il tenant o il ruolo indicati dal browser non sono mai letti.
 * Direttori, amministratori, agenti e subagenti delle aziende clienti ricevono 403 su lettura, validazione e pubblicazione.
 * Operazioni distinte: "validate" (multipart) conserva e controlla il file; "publish" (JSON) lo pubblica nell'archivio
 * globale solo dopo la validazione completa e la conferma esplicita del produttore legata all'impronta della versione mostrata.
 * Flusso semplificato (17/11/2026): senza "code" il tipo e il periodo sono rilevati dal contenuto del file (detectOfficialUpload).
 */
const headers = { "cache-control": "no-store, private" };
const denied = () => Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Riservato al produttore della piattaforma" } }, { status: 403, headers });
const bad = (code: string, message: string, status = 400) => Response.json({ error: { code, message } }, { status, headers });

async function producer(request: Request) {
  try { const principal = await requestPrincipal(request, "ADMIN"); return isPlatformOwner(principal) ? principal : null; } catch { return null; }
}

function stores() {
  const repositories = runtimeRepositories();
  return { repositories, monitor: { alerts: repositories.officialAlerts, checks: repositories.officialChecks, documents: repositories.officialDocuments, publications: repositories.officialPublications } };
}

/**
 * Copertura reale (17/11/2026): legge, senza scrivere nulla, l'archivio del produttore e la copia di ogni azienda cliente
 * (valori regolatori con i loro domini di approvazione, archivi PUN/PSV), le pubblicazioni, i controlli e gli alert del
 * monitor. Se la lettura fallisce la Control Room resta disponibile e dice che la copertura non è calcolabile.
 */
async function coverage(repositories: ReturnType<typeof runtimeRepositories>, now: string): Promise<{ coverage: CoverageReport | null; coverageError: string | null }> {
  try {
    const platform = "tenant_piattaforma";
    const companies = await repositories.companies.list(platform).catch(() => []);
    const names = new Map(companies.map((record) => [record.payload.tenantId, record.payload.name]));
    const tenants = [platform, ...(await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies).catch(() => []))];
    const copies: CoverageCopy[] = await Promise.all(tenants.map(async (tenantId) => ({
      tenantId, platform: tenantId === platform, label: tenantId === platform ? "Archivio produttore" : names.get(tenantId) ?? tenantId,
      regulatoryValues: (await repositories.regulatoryValues.list(tenantId)).map((record) => record.payload),
      approvalDomains: (await repositories.approvalDomains.list(tenantId)).map((record) => record.payload),
      marketArchives: await repositories.marketArchiveRepository.list(tenantId),
    })));
    const [publications, checks, alerts] = await Promise.all([
      allPublications(repositories.officialPublications) as Promise<OfficialPublicationRecord[]>,
      repositories.officialChecks.list(platform).then((records) => records.map((record) => record.payload as OfficialCheck)),
      repositories.officialAlerts.list(platform).then((records) => records.map((record) => record.payload as OfficialAlert)),
    ]);
    return { coverage: computeCoverage({ now, copies, publications, checks, alerts }), coverageError: null };
  } catch {
    return { coverage: null, coverageError: "Copertura non calcolabile: lettura degli archivi non riuscita. Riprova più tardi." };
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!(await producer(request))) return denied();
  const { monitor, repositories } = stores();
  const now = new Date().toISOString();
  const documents = (await monitor.documents.list("tenant_piattaforma")).map((record) => documentPreview(record.payload as OfficialDocumentRecord)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return Response.json({
    archives: await archiveOverview(monitor), documents, ...(await coverage(repositories, now)),
    catalog: OFFICIAL_CATALOG.map((entry) => ({ ...entry, uploadable: UPLOADABLE_DOCUMENTS.includes(entry.code) })), dueToday: dueChecks(now),
  }, { headers });
}

async function fetchOfficial(url: string): Promise<Uint8Array | null> {
  const host = new URL(url).host;
  if (host !== "www.arera.it" && host !== "arera.it") return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "BillRegulatoryAuditEngine/1.0 (official-source-import)" } }).catch(() => null);
  if (!response?.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

const DETECT_MESSAGES: Readonly<Record<string, string>> = {
  OFFICIAL_UPLOAD_TYPE_UNKNOWN: "Tipo di documento non riconosciuto dal contenuto del file: scegli documento e periodo manualmente",
  OFFICIAL_UPLOAD_PERIOD_AMBIGUOUS: "Il file contiene più anni richiesti da alert aperti: scegli il periodo manualmente",
  OFFICIAL_UPLOAD_PERIOD_UNDETERMINED: "Periodo non determinabile dal file: scegli il periodo manualmente",
  OFFICIAL_UPLOAD_SIZE_INVALID: "File vuoto o oltre 2 MB",
};

const MESSAGES: Readonly<Record<string, string>> = {
  OFFICIAL_PUBLISH_DOCUMENT_NOT_FOUND: "Documento non trovato",
  OFFICIAL_PUBLISH_NOT_VALIDATED: "Si pubblica solo un documento con tutti i controlli superati",
  OFFICIAL_PUBLISH_CONFIRMATION_MISMATCH: "La conferma non corrisponde alla versione validata conservata (impronta SHA-256 diversa): aggiorna la pagina e riprova",
  OFFICIAL_PUBLISH_PROVENANCE_REJECTED: "Provenienza bloccata: valori diversi dal file pubblicato dalla fonte ufficiale, o equivalenza non dimostrabile",
  OFFICIAL_PUBLISH_PROVENANCE_ACK_REQUIRED: "Provenienza non verificata (dichiarata o da verificare): serve la conferma esplicita di aver controllato il file sulla fonte ufficiale",
  OFFICIAL_PUBLISH_INTEGRITY_FAILED: "Il file conservato non corrisponde più alla sua impronta: pubblicazione bloccata",
  OFFICIAL_PUBLISH_CONTENT_CHANGED: "La rilettura del file conservato non conferma i valori validati: pubblicazione bloccata",
  OFFICIAL_PUBLISH_ALREADY_PUBLISHED: "Questa versione è già pubblicata",
  OFFICIAL_PUBLISH_OLDER_VERSION: "È già pubblicata una versione più recente dello stesso documento e periodo",
};

export async function POST(request: Request): Promise<Response> {
  const principal = await producer(request);
  if (!principal) return denied();
  const { monitor, repositories } = stores();
  const audit = new AuditLogger(repositories.auditEvents);
  const now = new Date().toISOString();
  const correlationId = `control-room-${Date.now()}`;
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try { form = await request.formData(); } catch { return bad("OFFICIAL_UPLOAD_FILE_MISSING", "Seleziona il file ufficiale"); }
    const requested = String(form.get("code") ?? ""); const file = form.get("file");
    if (requested && !UPLOADABLE_DOCUMENTS.includes(requested as OfficialDocumentCode)) return bad("OFFICIAL_UPLOAD_NOT_SUPPORTED", "Per questo documento il caricamento non è previsto: segui le istruzioni dell'archivio");
    if (!(file instanceof File) || file.size === 0) return bad("OFFICIAL_UPLOAD_FILE_MISSING", "Seleziona il file scaricato dalla fonte ufficiale");
    const bytes = new Uint8Array(await file.arrayBuffer());
    // No document chosen: type and period come from the file content (never from its name), or the producer is asked to choose.
    let detected: DetectedUpload | null = null;
    if (!requested) {
      try { detected = detectOfficialUpload(bytes, { openAlerts: (await monitor.alerts.list("tenant_piattaforma")).map((item) => item.payload as OfficialAlert), now }); }
      catch (error) { const reason = error instanceof Error ? error.message : "OFFICIAL_UPLOAD_TYPE_UNKNOWN"; return bad(reason.startsWith("OFFICIAL_UPLOAD_") ? reason : "OFFICIAL_UPLOAD_TYPE_UNKNOWN", DETECT_MESSAGES[reason] ?? DETECT_MESSAGES.OFFICIAL_UPLOAD_TYPE_UNKNOWN, 422); }
    }
    const code = (detected?.code ?? requested) as OfficialDocumentCode; const period = detected?.period ?? String(form.get("period") ?? "");
    try {
      const { record, duplicate } = await validateOfficialDocument(monitor, { code, period, originalName: file.name, bytes, uploadedBy: principal.userId, now, fetchOfficial });
      if (!duplicate) await audit.record({ principal, action: "official-document.validate", resourceType: "official-document", resourceId: record.documentId, outcome: record.status === "VALIDATED" ? "ALLOWED" : "FAILED", correlationId, timestamp: now, metadata: { code, period, version: record.version, sha256: record.sha256, status: record.status, provenance: record.provenance.level, provenanceComparison: record.provenance.comparison ?? "NONE", officialSha256: record.provenance.officialSha256 ?? "NONE", detected: detected ? "CONTENT" : "CHOSEN" } });
      // A rejected file is a processed validation: the answer carries every failed check, and the alert says "rifiutato".
      return Response.json({ document: documentPreview(record), duplicate, detected }, { headers });
    } catch (error) {
      return bad("OFFICIAL_UPLOAD_REJECTED", error instanceof Error ? error.message : "Validazione non riuscita", 422);
    }
  }
  const body = await request.json().catch(() => ({})) as { readonly action?: unknown; readonly code?: unknown; readonly period?: unknown; readonly note?: unknown; readonly documentId?: unknown; readonly confirmSha256?: unknown; readonly acknowledgeDeclaredProvenance?: unknown };
  if (body.action === "publish") {
    if (typeof body.documentId !== "string" || typeof body.confirmSha256 !== "string") return bad("OFFICIAL_PUBLISH_REQUEST_INVALID", "Indica il documento e conferma la sua impronta SHA-256");
    try {
      const publication = await publishOfficialDocument(monitor, { documentId: body.documentId, confirmSha256: body.confirmSha256, acknowledgeDeclaredProvenance: body.acknowledgeDeclaredProvenance === true, publishedBy: principal.userId, now });
      await audit.record({ principal, action: "official-document.publish", resourceType: "official-document", resourceId: publication.documentId, outcome: "ALLOWED", correlationId, timestamp: now, metadata: { code: publication.code, period: publication.period, version: publication.version, sha256: publication.sha256, provenance: publication.provenanceLevel } });
      return Response.json({ publication }, { headers });
    } catch (error) {
      const code = error instanceof Error ? error.message : "OFFICIAL_PUBLISH_FAILED";
      await audit.record({ principal, action: "official-document.publish", resourceType: "official-document", resourceId: body.documentId.slice(0, 120), outcome: "FAILED", correlationId, timestamp: now, metadata: { reason: code.slice(0, 80) } }).catch(() => undefined);
      return bad(code.startsWith("OFFICIAL_PUBLISH_") ? code : "OFFICIAL_PUBLISH_FAILED", MESSAGES[code] ?? "Pubblicazione non riuscita", code === "OFFICIAL_PUBLISH_DOCUMENT_NOT_FOUND" ? 404 : 409);
    }
  }
  if (body.action === "run") {
    const checks = await runOfficialMonitor({ repositories: monitor, probes: liveProbes(repositories), now });
    await audit.record({ principal, action: "official-monitor.run", resourceType: "official-monitor", outcome: "ALLOWED", correlationId, timestamp: now, metadata: { checks: checks.length, failed: checks.filter((check) => check.outcome === "FAILED").length } });
    return Response.json({ checks }, { headers });
  }
  if (body.action === "confirm" && typeof body.code === "string" && typeof body.period === "string" && typeof body.note === "string") {
    try {
      const alert = await confirmManualVerification(monitor, { code: body.code as OfficialDocumentCode, period: body.period, note: body.note, confirmedBy: principal.userId, now });
      if (!alert) return bad("OFFICIAL_ALERT_NOT_FOUND", "Alert non trovato", 404);
      await audit.record({ principal, action: "official-document.confirm", resourceType: "official-alert", resourceId: alert.alertId, outcome: "ALLOWED", correlationId, timestamp: now, metadata: { code: body.code, period: body.period } });
      return Response.json({ alert }, { headers });
    } catch (error) { return bad("OFFICIAL_CONFIRMATION_REJECTED", error instanceof Error ? error.message : "Conferma non valida"); }
  }
  return bad("CONTROL_ROOM_REQUEST_INVALID", "Richiesta non prevista");
}
