import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { rejectCteArchive } from "../../../../../lib/cte/archive/service";
import { LocalCteArchiveRepository } from "../../../../../lib/cte/archive/repository";

export const runtime = "nodejs";
const repository = new LocalCteArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try { const tenantId = localTenant(request); const { id } = await context.params; const body = await jsonBody(request); if (typeof body.versionId !== "string" || typeof body.reason !== "string") throw new Error("REJECTION_REASON_REQUIRED"); const record = await rejectCteArchive(repository, tenantId, id, body.versionId, request.headers.get("x-foundation-actor") ?? "LOCAL_REVIEWER", body.reason, typeof body.at === "string" ? body.at : undefined); return Response.json({ record }); } catch (error) { return archiveError(error); }
}
