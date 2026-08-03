import { archiveError, localTenant } from "../../../../lib/archive/api";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> { try { const tenantId = await localTenant(request); const repository = runtimeRepositories().marketArchiveRepository; const { id } = await context.params; const record = await repository.get(tenantId, id); if (!record) throw new Error("MARKET_ARCHIVE_NOT_FOUND"); return Response.json({ record }); } catch (error) { return archiveError(error); } }
