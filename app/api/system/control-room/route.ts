import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { AuditLogger } from "../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { OFFICIAL_CATALOG, dueChecks, type OfficialDocumentCode } from "../../../lib/official-monitor/catalog";
import { archiveOverview, documentPreview } from "../../../lib/official-monitor/archives";
import { UPLOADABLE_DOCUMENTS, confirmManualVerification, publishOfficialDocument, validateOfficialDocument, type OfficialDocumentRecord } from "../../../lib/official-monitor/documents";
import { runOfficialMonitor } from "../../../lib/official-monitor/monitor";
import { liveProbes } from "../../../lib/official-monitor/probes";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Control Room Produttore → Archivi ufficiali (Tony, 17/11/2026). Solo il produttore della piattaforma (ADMIN di
 * tenant_piattaforma), verificato qui sul server dalla sessione: il tenant o il ruolo indicati dal browser non sono mai letti.
 * Direttori, amministratori, agenti e subagenti delle aziende clienti ricevono 403 su lettura, validazione e pubblicazione.
 * Operazioni distinte: "validate" (multipart) conserva e controlla il file; "publish" (JSON) lo pubblica nell'archivio
 * globale solo dopo la validazione completa e la conferma esplicita dell'impronta.
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

export async function GET(request: Request): Promise<Response> {
  if (!(await producer(request))) return denied();
  const { monitor } = stores();
  const now = new Date().toISOString();
  const documents = (await monitor.documents.list("tenant_piattaforma")).map((record) => documentPreview(record.payload as OfficialDocumentRecord)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return Response.json({
    archives: await archiveOverview(monitor), documents,
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

const MESSAGES: Readonly<Record<string, string>> = {
  OFFICIAL_PUBLISH_DOCUMENT_NOT_FOUND: "Documento non trovato",
  OFFICIAL_PUBLISH_NOT_VALIDATED: "Si pubblica solo un documento con tutti i controlli superati",
  OFFICIAL_PUBLISH_CONFIRMATION_MISMATCH: "L'impronta SHA-256 di conferma non corrisponde al documento validato",
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
    const code = String(form.get("code") ?? "") as OfficialDocumentCode; const period = String(form.get("period") ?? ""); const file = form.get("file");
    if (!UPLOADABLE_DOCUMENTS.includes(code)) return bad("OFFICIAL_UPLOAD_NOT_SUPPORTED", "Per questo documento il caricamento non è previsto: segui le istruzioni dell'archivio");
    if (!(file instanceof File) || file.size === 0) return bad("OFFICIAL_UPLOAD_FILE_MISSING", "Seleziona il file scaricato dalla fonte ufficiale");
    try {
      const { record, duplicate } = await validateOfficialDocument(monitor, { code, period, originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), uploadedBy: principal.userId, now, fetchOfficial });
      if (!duplicate) await audit.record({ principal, action: "official-document.validate", resourceType: "official-document", resourceId: record.documentId, outcome: record.status === "VALIDATED" ? "ALLOWED" : "FAILED", correlationId, timestamp: now, metadata: { code, period, version: record.version, sha256: record.sha256, status: record.status, provenance: record.provenance.level, provenanceComparison: record.provenance.comparison ?? "NONE", officialSha256: record.provenance.officialSha256 ?? "NONE" } });
      // A rejected file is a processed validation: the answer carries every failed check, and the alert says "rifiutato".
      return Response.json({ document: documentPreview(record), duplicate }, { headers });
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
