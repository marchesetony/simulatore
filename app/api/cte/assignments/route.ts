import { jsonBody } from "../../../lib/archive/api";
import { requireRequestAccess } from "../../../lib/auth/request";
import { cteAssignmentsResponse, hierarchyError, saveCteAssignmentResponse } from "../../../lib/hierarchy/api";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { return await cteAssignmentsResponse(await requireRequestAccess(request, "READ")); }
  catch (error) { return hierarchyError(error); }
}

export async function PUT(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); return await saveCteAssignmentResponse(principal, await jsonBody(request)); }
  catch (error) { return hierarchyError(error); }
}
