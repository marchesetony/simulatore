import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { changeCteExpiry, toPublicCteApprovedArchiveSummary } from "../../../../../lib/cte/archive/service";
import { requestPrincipal } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

/** Company administrators may change only the expiry date of an approved CTE; it is saved as a new approved version. */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const tenantId = await localTenant(request, "ADMIN");
    const principal = await requestPrincipal(request, "ADMIN");
    const body = await jsonBody(request);
    const { id } = await context.params;
    if (typeof body.date !== "string") throw new Error("CTE_EXPIRY_DATE_INVALID");
    const record = await changeCteExpiry(runtimeRepositories().cteArchiveRepository, {
      tenantId, archiveId: id, date: body.date, actor: principal.userId,
      audit: async (event) => { await recordRuntimeAudit({ tenantId: event.tenantId, principal, action: "CTE_STATUS_CHANGE", resourceType: "CTE_ARCHIVE", resourceId: event.archiveId, outcome: "ALLOWED", correlationId: "cte-expiry-change-v1", metadata: { cteId: event.cteId, versionId: event.versionId, previousState: event.previousState, newState: event.newState, actor: event.actor, timestamp: event.timestamp, expiry: body.date } }); },
    });
    return Response.json({ record: toPublicCteApprovedArchiveSummary(record) });
  } catch (error) { return archiveError(error); }
}
