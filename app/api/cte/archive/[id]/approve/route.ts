import { archiveError, localTenant } from "../../../../../lib/archive/api";
import { requestPrincipal } from "../../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const tenantId = await localTenant(request, "WRITE");
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    await recordRuntimeAudit({ tenantId, principal, action: "CTE_ARCHIVE_DIRECT_DENIAL", resourceType: "CTE_ARCHIVE", resourceId: id, outcome: "DENIED", correlationId: "cte-market-archive-v1", metadata: { reason: "INGESTION_APPROVAL_WORKFLOW_REQUIRED" } });
    throw new Error("CTE_DIRECT_ARCHIVE_FORBIDDEN");
  } catch (error) { return archiveError(error); }
}
