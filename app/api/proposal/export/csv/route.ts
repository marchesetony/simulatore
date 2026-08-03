import { jsonBody } from "../../../../lib/archive/api";
import { requestPrincipal } from "../../../../lib/auth/request";
import { exportResponse, proposalError } from "../../../../lib/proposal/api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "WRITE"); return await exportResponse(await jsonBody(request), principal.tenantId, "CSV", principal); }
  catch (error) { return proposalError(error); }
}
