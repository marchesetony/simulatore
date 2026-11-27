import { jsonBody } from "../../../lib/archive/api";
import { requireRequestAccess } from "../../../lib/auth/request";
import { accessError, accountLevelResponse, accountStatusResponse, createAccountResponse, teamResponse } from "../../../lib/access/api";

export const runtime = "nodejs";

// Tony (24/11/2026, "RIPRISTINO GESTIONE GERARCHICA"): every signed-in role reaches these routes; what each may see and do is
// decided by teamAuthority (access/service.ts): the administrator the whole company, a responsabile only their own branch.

export async function GET(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "OPERATE"); return await teamResponse(principal, new URL(request.url).searchParams.get("tenantId")); }
  catch (error) { return accessError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "OPERATE"); return await createAccountResponse(principal, await jsonBody(request)); }
  catch (error) { return accessError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  // Tony (24/11/2026): the same request changes either the status (sospendi/riattiva) or the role and responsabile.
  try { const principal = await requireRequestAccess(request, "OPERATE"); const body = await jsonBody(request); return await ("level" in body ? accountLevelResponse(principal, body) : accountStatusResponse(principal, body)); }
  catch (error) { return accessError(error); }
}
