import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { createCteCorrection } from "../../../../../lib/cte/archive/service";
import { LocalCteArchiveRepository } from "../../../../../lib/cte/archive/repository";

export const runtime = "nodejs";
const repository = new LocalCteArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try { const tenantId = localTenant(request); const { id } = await context.params; const body = await jsonBody(request); if (typeof body.expectedVersionId !== "string") throw new Error("CTE_VERSION_REQUIRED"); const contract = (body.contract ?? body) as never; const record = await createCteCorrection(repository, { tenantId, archiveId: id, expectedVersionId: body.expectedVersionId, contract, actor: request.headers.get("x-foundation-actor") ?? undefined, reason: typeof body.reason === "string" ? body.reason : undefined, now: typeof body.now === "string" ? body.now : undefined }); return Response.json({ record }, { status: 201 }); } catch (error) { return archiveError(error); }
}
