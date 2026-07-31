import { archiveError, jsonBody, localTenant } from "../../../lib/archive/api";
import { createMarketArchive, queryApprovedHistoricalMarketData } from "../../../lib/market/service";
import { LocalMarketArchiveRepository } from "../../../lib/market/repository";

export const runtime = "nodejs";
const repository = new LocalMarketArchiveRepository();

export async function GET(request: Request): Promise<Response> {
  try { const tenantId = localTenant(request); const params = new URL(request.url).searchParams; const effectiveDate = params.get("effectiveDate"); const vectorValue = params.get("vector"); if (vectorValue !== null && vectorValue !== "EE" && vectorValue !== "GAS") throw new Error("VECTOR_INVALID"); if (effectiveDate) return Response.json({ records: await queryApprovedHistoricalMarketData(repository, tenantId, effectiveDate, vectorValue as "EE" | "GAS" | null ?? undefined) }); return Response.json({ records: await repository.list(tenantId) }); } catch (error) { return archiveError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const tenantId = localTenant(request); const body = await jsonBody(request); const record = await createMarketArchive(repository, { tenantId, record: (body.record ?? body) as never, actor: request.headers.get("x-foundation-actor") ?? undefined, now: typeof body.now === "string" ? body.now : undefined, archiveId: typeof body.archiveId === "string" ? body.archiveId : undefined }); return Response.json({ record }, { status: 201 }); } catch (error) { return archiveError(error); }
}
