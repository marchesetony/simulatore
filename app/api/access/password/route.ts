import { jsonBody } from "../../../lib/archive/api";
import { requireRequestAccess } from "../../../lib/auth/request";
import { accessError, changePasswordResponse } from "../../../lib/access/api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "OPERATE"); return await changePasswordResponse(principal, await jsonBody(request)); }
  catch (error) { return accessError(error); }
}
