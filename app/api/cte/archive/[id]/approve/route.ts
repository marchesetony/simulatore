import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { approveCteArchive } from "../../../../../lib/cte/archive/service";
import { LocalCteArchiveRepository } from "../../../../../lib/cte/archive/repository";

export const runtime = "nodejs";
const repository = new LocalCteArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try { const tenantId = localTenant(request); const { id } = await context.params; const body = await jsonBody(request); if (typeof body.versionId !== "string" || typeof body.decisionId !== "string") throw new Error("APPROVAL_METADATA_INVALID"); const record = await approveCteArchive(repository, tenantId, id, body.versionId, request.headers.get("x-foundation-actor") ?? "LOCAL_REVIEWER", body.decisionId, typeof body.at === "string" ? body.at : undefined); return Response.json({ record }); } catch (error) { return archiveError(error); }
}
