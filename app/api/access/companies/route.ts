import { jsonBody } from "../../../lib/archive/api";
import { requireRequestAccess } from "../../../lib/auth/request";
import { accessError, companiesResponse, createCompanyResponse } from "../../../lib/access/api";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { return await companiesResponse(await requireRequestAccess(request, "ADMIN")); }
  catch (error) { return accessError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); return await createCompanyResponse(principal, await jsonBody(request)); }
  catch (error) { return accessError(error); }
}
