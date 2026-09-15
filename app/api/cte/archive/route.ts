import { archiveError, localTenant } from "../../../lib/archive/api";
import { toPublicCteApprovedArchiveSummary } from "../../../lib/cte/archive/service";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { requestPrincipal } from "../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    const tenantId = await localTenant(request, "READ");
    const repository = runtimeRepositories().cteArchiveRepository;
    const records = await repository.list(tenantId);
    if (new URL(request.url).searchParams.get("view") === "approved") return Response.json({ records: records.map(toPublicCteApprovedArchiveSummary).filter((record): record is NonNullable<typeof record> => record !== null) }, { headers: { "cache-control": "no-store, private" } });
    return Response.json({ records });
  } catch (error) { return archiveError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const tenantId = await localTenant(request, "WRITE");
    const principal = await requestPrincipal(request, "WRITE");
    await recordRuntimeAudit({ tenantId, principal, action: "CTE_ARCHIVE_DIRECT_DENIAL", resourceType: "CTE_ARCHIVE", outcome: "DENIED", correlationId: "cte-market-archive-v1", metadata: { reason: "APPROVAL_WORKFLOW_REQUIRED" } });
    throw new Error("CTE_DIRECT_ARCHIVE_FORBIDDEN");
  } catch (error) { return archiveError(error); }
}
