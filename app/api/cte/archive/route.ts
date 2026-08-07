import { archiveError, jsonBody, localTenant } from "../../../lib/archive/api";
import { createCteArchive, toPublicCteApprovedArchiveSummary } from "../../../lib/cte/archive/service";
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
  try { const tenantId = await localTenant(request); const principal = await requestPrincipal(request, "WRITE"); const repository = runtimeRepositories().cteArchiveRepository; const body = await jsonBody(request); const contract = (body.contract ?? body) as never; const record = await createCteArchive(repository, { tenantId, contract, actor: principal.userId, now: typeof body.now === "string" ? body.now : undefined, archiveId: typeof body.archiveId === "string" ? body.archiveId : undefined }); await recordRuntimeAudit({ tenantId, principal, action: "CTE_CREATION", resourceType: "CTE_ARCHIVE", resourceId: record.archiveId, outcome: "ALLOWED", correlationId: "cte-market-archive-v1" }); return Response.json({ record }, { status: 201 }); } catch (error) { return archiveError(error); }
}
