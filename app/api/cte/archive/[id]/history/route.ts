import { archiveError, localTenant } from "../../../../../lib/archive/api";
import { getCteArchiveHistory } from "../../../../../lib/cte/archive/service";
import { LocalCteArchiveRepository } from "../../../../../lib/cte/archive/repository";

export const runtime = "nodejs";
const repository = new LocalCteArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> { try { const tenantId = localTenant(request); const { id } = await context.params; return Response.json({ history: await getCteArchiveHistory(repository, tenantId, id) }); } catch (error) { return archiveError(error); } }
