import { jsonBody } from "../../../lib/archive/api";
import { requestPrincipal } from "../../../lib/auth/request";
import { brandingError, brandingResponse, saveBrandingResponse } from "../../../lib/branding/api";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "READ"); return await brandingResponse(principal.tenantId); }
  catch (error) { return brandingError(error); }
}

export async function PUT(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "ADMIN"); return await saveBrandingResponse(await jsonBody(request), principal); }
  catch (error) { return brandingError(error); }
}
