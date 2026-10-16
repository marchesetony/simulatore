import { jsonBody } from "../../../../lib/archive/api";
import { requestPrincipal } from "../../../../lib/auth/request";
import { pdfExportResponse, proposalError } from "../../../../lib/proposal/api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "WRITE"); return await pdfExportResponse(await jsonBody(request), principal.tenantId, principal); }
  catch (error) { return proposalError(error); }
}
