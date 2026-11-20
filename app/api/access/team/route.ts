import { jsonBody } from "../../../lib/archive/api";
import { requireRequestAccess } from "../../../lib/auth/request";
import { accessError, accountStatusResponse, createAccountResponse, teamResponse } from "../../../lib/access/api";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); return await teamResponse(principal, new URL(request.url).searchParams.get("tenantId")); }
  catch (error) { return accessError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); return await createAccountResponse(principal, await jsonBody(request)); }
  catch (error) { return accessError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); return await accountStatusResponse(principal, await jsonBody(request)); }
  catch (error) { return accessError(error); }
}
