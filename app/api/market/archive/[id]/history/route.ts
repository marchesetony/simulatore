import { archiveError, localTenant } from "../../../../../lib/archive/api";
import { getMarketArchiveHistory } from "../../../../../lib/market/service";
import { LocalMarketArchiveRepository } from "../../../../../lib/market/repository";

export const runtime = "nodejs";
const repository = new LocalMarketArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> { try { const tenantId = localTenant(request); const { id } = await context.params; return Response.json({ history: await getMarketArchiveHistory(repository, tenantId, id) }); } catch (error) { return archiveError(error); } }
