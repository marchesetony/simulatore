import { jsonBody } from "../../lib/archive/api";
import { requireRequestAccess } from "../../lib/auth/request";
import { hierarchyError, hierarchyResponse, removeOrgNodeResponse, saveOrgNodeResponse } from "../../lib/hierarchy/api";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { return await hierarchyResponse(await requireRequestAccess(request, "READ")); }
  catch (error) { return hierarchyError(error); }
}

export async function PUT(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "WRITE"); return await saveOrgNodeResponse(principal, await jsonBody(request)); }
  catch (error) { return hierarchyError(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "WRITE"); return await removeOrgNodeResponse(principal, await jsonBody(request)); }
  catch (error) { return hierarchyError(error); }
}
