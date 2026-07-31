import { archiveError, localTenant } from "../../../../lib/archive/api";
import { LocalMarketArchiveRepository } from "../../../../lib/market/repository";

export const runtime = "nodejs";
const repository = new LocalMarketArchiveRepository();
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> { try { const tenantId = localTenant(request); const { id } = await context.params; const record = await repository.get(tenantId, id); if (!record) throw new Error("MARKET_ARCHIVE_NOT_FOUND"); return Response.json({ record }); } catch (error) { return archiveError(error); } }
