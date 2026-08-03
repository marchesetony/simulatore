import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { createCteCorrection } from "../../../../../lib/cte/archive/service";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { requestPrincipal } from "../../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try { const tenantId = await localTenant(request); const principal = await requestPrincipal(request, "WRITE"); const repository = runtimeRepositories().cteArchiveRepository; const { id } = await context.params; const body = await jsonBody(request); if (typeof body.expectedVersionId !== "string") throw new Error("CTE_VERSION_REQUIRED"); const contract = (body.contract ?? body) as never; const record = await createCteCorrection(repository, { tenantId, archiveId: id, expectedVersionId: body.expectedVersionId, contract, actor: principal.userId, reason: typeof body.reason === "string" ? body.reason : undefined, now: typeof body.now === "string" ? body.now : undefined }); await recordRuntimeAudit({ tenantId, principal, action: "CTE_VERSION_CREATION", resourceType: "CTE_ARCHIVE", resourceId: id, outcome: "ALLOWED", correlationId: "cte-market-archive-v1" }); return Response.json({ record }, { status: 201 }); } catch (error) { return archiveError(error); }
}
