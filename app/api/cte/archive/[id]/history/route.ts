import { archiveError, localTenant } from "../../../../../lib/archive/api";
import { getCteArchiveHistory } from "../../../../../lib/cte/archive/service";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> { try { const tenantId = await localTenant(request); const repository = runtimeRepositories().cteArchiveRepository; const { id } = await context.params; return Response.json({ history: await getCteArchiveHistory(repository, tenantId, id) }); } catch (error) { return archiveError(error); } }
