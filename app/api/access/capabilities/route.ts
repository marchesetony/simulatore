import { requireRequestAccess } from "../../../lib/auth/request";
import { accessCapabilitiesResponse, accessError } from "../../../lib/access/api";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try { return await accessCapabilitiesResponse(await requireRequestAccess(request, "READ")); }
  catch (error) { return accessError(error); }
}
