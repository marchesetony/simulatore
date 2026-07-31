import { archiveError, localTenant } from "../../../../lib/archive/api";
import { LocalCteArchiveRepository } from "../../../../lib/cte/archive/repository";

export const runtime = "nodejs";
const repository = new LocalCteArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try { const tenantId = localTenant(request); const { id } = await context.params; const record = await repository.get(tenantId, id); if (!record) throw new Error("CTE_ARCHIVE_NOT_FOUND"); return Response.json({ record }); } catch (error) { return archiveError(error); }
}
