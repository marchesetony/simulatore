import { archiveError, jsonBody, localTenant } from "../../../lib/archive/api";
import { createCteArchive } from "../../../lib/cte/archive/service";
import { LocalCteArchiveRepository } from "../../../lib/cte/archive/repository";

export const runtime = "nodejs";
const repository = new LocalCteArchiveRepository();

export async function GET(request: Request): Promise<Response> {
  try { const tenantId = localTenant(request); return Response.json({ records: await repository.list(tenantId) }); } catch (error) { return archiveError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const tenantId = localTenant(request); const body = await jsonBody(request); const contract = (body.contract ?? body) as never; const record = await createCteArchive(repository, { tenantId, contract, actor: request.headers.get("x-foundation-actor") ?? undefined, now: typeof body.now === "string" ? body.now : undefined, archiveId: typeof body.archiveId === "string" ? body.archiveId : undefined }); return Response.json({ record }, { status: 201 }); } catch (error) { return archiveError(error); }
}
