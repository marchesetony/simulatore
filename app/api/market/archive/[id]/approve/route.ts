import { archiveError, jsonBody, localTenant } from "../../../../../lib/archive/api";
import { approveMarketArchive } from "../../../../../lib/market/service";
import { LocalMarketArchiveRepository } from "../../../../../lib/market/repository";

export const runtime = "nodejs";
const repository = new LocalMarketArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function POST(request: Request, context: Context): Promise<Response> { try { const tenantId = localTenant(request); const { id } = await context.params; const body = await jsonBody(request); if (typeof body.decisionId !== "string") throw new Error("APPROVAL_METADATA_INVALID"); return Response.json({ record: await approveMarketArchive(repository, tenantId, id, request.headers.get("x-foundation-actor") ?? "LOCAL_REVIEWER", body.decisionId, typeof body.at === "string" ? body.at : undefined) }); } catch (error) { return archiveError(error); } }
