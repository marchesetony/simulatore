import { jsonBody, localTenant } from "../../../../lib/archive/api";
import { exportResponse, proposalError } from "../../../../lib/proposal/api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { const tenantId = localTenant(request); return exportResponse(await jsonBody(request), tenantId, "HTML"); }
  catch (error) { return proposalError(error); }
}
