import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { approveCteArchive } from "../../../../../lib/cte/archive/service";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { requestPrincipal } from "../../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try { const tenantId = await localTenant(request); const principal = await requestPrincipal(request, "WRITE"); const repository = runtimeRepositories().cteArchiveRepository; const { id } = await context.params; const body = await jsonBody(request); if (typeof body.versionId !== "string" || typeof body.decisionId !== "string") throw new Error("APPROVAL_METADATA_INVALID"); const record = await approveCteArchive(repository, tenantId, id, body.versionId, principal.userId, body.decisionId, typeof body.at === "string" ? body.at : undefined); await recordRuntimeAudit({ tenantId, principal, action: "CTE_STATUS_CHANGE", resourceType: "CTE_ARCHIVE", resourceId: id, outcome: "ALLOWED", correlationId: "cte-market-archive-v1", metadata: { status: "APPROVED" } }); return Response.json({ record }); } catch (error) { return archiveError(error); }
}
