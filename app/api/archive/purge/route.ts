import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";
import { purgeCompanyArchive } from "../../../lib/foundation/company-archive-purge";
import type { CteIngestionRepository } from "../../../lib/cte/ingestion";

export const runtime = "nodejs";
export const maxDuration = 300;
const HEADERS = { "cache-control": "no-store, private" };

/** "Svuota archivio": a company administrator removes every bill and CTE of their own company (see company-archive-purge.ts). */
export async function POST(request: Request): Promise<Response> {
  let principal;
  try { principal = await requestPrincipal(request, "ADMIN"); } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo gli amministratori dell'azienda" } }, { status: 403, headers: HEADERS });
  }
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { body = {}; }
  const repositories = runtimeRepositories();
  const audit = { async record(event: { readonly type: string; readonly documentId: string; readonly outcome: string }) { await recordRuntimeAudit({ principal, action: event.type === "CTE_DOCUMENT_PURGED" || event.type === "CTE_ARCHIVE_PURGED" ? event.type : "BILL_DELETED_ARCHIVE_PURGE", resourceType: event.type.startsWith("CTE") ? "CTE" : "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "DENIED", correlationId: "company-archive-purge" }); } };
  try {
    const result = await purgeCompanyArchive({ tenantId: principal.tenantId, confirmation: typeof body.confirmation === "string" ? body.confirmation : "", repositories: { bills: repositories.billRepository, ctes: repositories.cteArchiveRepository, cteIngestions: repositories.cteArchives as CteIngestionRepository, storage: repositories.documentStorage, audit } });
    return Response.json(result, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof Error && /^ARCHIVE_PURGE_[A-Z_]+$/.test(error.message) ? error.message : "ARCHIVE_PURGE_FAILED";
    return Response.json({ error: { code, message: code === "ARCHIVE_PURGE_CONFIRMATION_REQUIRED" ? "Scrivi SVUOTA per confermare" : "Svuotamento non riuscito" } }, { status: code === "ARCHIVE_PURGE_CONFIRMATION_REQUIRED" ? 422 : 500, headers: HEADERS });
  }
}
