import { archiveError, jsonBody, localTenant } from "../../../lib/archive/api";
import { createMarketArchive, queryApprovedHistoricalMarketData } from "../../../lib/market/service";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { requestPrincipal } from "../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try { const tenantId = await localTenant(request); const repository = runtimeRepositories().marketArchiveRepository; const params = new URL(request.url).searchParams; const effectiveDate = params.get("effectiveDate"); const vectorValue = params.get("vector"); if (vectorValue !== null && vectorValue !== "EE" && vectorValue !== "GAS") throw new Error("VECTOR_INVALID"); if (effectiveDate) return Response.json({ records: await queryApprovedHistoricalMarketData(repository, tenantId, effectiveDate, vectorValue as "EE" | "GAS" | null ?? undefined) }); return Response.json({ records: await repository.list(tenantId) }); } catch (error) { return archiveError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const tenantId = await localTenant(request); const principal = await requestPrincipal(request, "WRITE"); const repository = runtimeRepositories().marketArchiveRepository; const body = await jsonBody(request); const record = await createMarketArchive(repository, { tenantId, record: (body.record ?? body) as never, actor: principal.userId, now: typeof body.now === "string" ? body.now : undefined, archiveId: typeof body.archiveId === "string" ? body.archiveId : undefined }); await recordRuntimeAudit({ tenantId, principal, action: "MARKET_CREATION", resourceType: "MARKET_ARCHIVE", resourceId: record.archiveId, outcome: "ALLOWED", correlationId: "cte-market-archive-v1" }); return Response.json({ record }, { status: 201 }); } catch (error) { return archiveError(error); }
}
