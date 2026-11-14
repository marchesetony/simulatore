import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { rejectMarketArchive } from "../../../../../lib/market/service";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { requestPrincipal } from "../../../../../lib/auth/request";
import { isPlatformOwner } from "../../../../../lib/access/service";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function POST(request: Request, context: Context): Promise<Response> { try { const tenantId = await localTenant(request); const principal = await requestPrincipal(request, "WRITE"); if (!isPlatformOwner(principal)) throw new Error("MARKET_OFFICIAL_DATA_READ_ONLY"); const repository = runtimeRepositories().marketArchiveRepository; const { id } = await context.params; const body = await jsonBody(request); if (typeof body.reason !== "string") throw new Error("REJECTION_REASON_REQUIRED"); const record = await rejectMarketArchive(repository, tenantId, id, principal.userId, body.reason, typeof body.at === "string" ? body.at : undefined); await recordRuntimeAudit({ tenantId, principal, action: "MARKET_STATUS_CHANGE", resourceType: "MARKET_ARCHIVE", resourceId: id, outcome: "ALLOWED", correlationId: "cte-market-archive-v1", metadata: { status: "REJECTED" } }); return Response.json({ record }); } catch (error) { return archiveError(error); } }
