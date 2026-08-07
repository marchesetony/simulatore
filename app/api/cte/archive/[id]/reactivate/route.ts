import { archiveError, localTenant } from "../../../../../lib/archive/api";
import { reactivateCteArchive } from "../../../../../lib/cte/archive/service";
import { requestPrincipal } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const tenantId = await localTenant(request, "WRITE");
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    const record = await reactivateCteArchive(runtimeRepositories().cteArchiveRepository, tenantId, id, principal.userId);
    await recordRuntimeAudit({ tenantId, principal, action: "CTE_COMMERCIAL_REACTIVATE", resourceType: "CTE_ARCHIVE", resourceId: id, outcome: "ALLOWED", correlationId: "cte-commercial-lifecycle-v1", metadata: { commercialStatus: record.commercialStatus ?? "ACTIVE" } });
    return Response.json({ record });
  } catch (error) { return archiveError(error); }
}
