import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { setCteCommercialAdjustment } from "../../../../../lib/cte/archive/service";
import { requestPrincipal } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

/** Company administrators set the correttivi applied to every quote built on this CTE. */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const tenantId = await localTenant(request, "ADMIN");
    const principal = await requestPrincipal(request, "ADMIN");
    const body = await jsonBody(request);
    const { id } = await context.params;
    const record = await setCteCommercialAdjustment(runtimeRepositories().cteArchiveRepository, tenantId, id, principal.userId, body);
    await recordRuntimeAudit({ tenantId, principal, action: "CTE_COMMERCIAL_ADJUSTMENT", resourceType: "CTE_ARCHIVE", resourceId: id, outcome: "ALLOWED", correlationId: "cte-commercial-lifecycle-v1", metadata: { energyPriceDelta: record.commercialAdjustment?.energyPriceDelta ?? 0, monthlyFeeDelta: record.commercialAdjustment?.monthlyFeeDelta ?? 0 } });
    return Response.json({ commercialAdjustment: record.commercialAdjustment ?? null });
  } catch (error) { return archiveError(error); }
}
