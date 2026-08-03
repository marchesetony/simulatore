import { jsonBody, localTenant } from "../../lib/archive/api";
import { proposalError } from "../../lib/proposal/api";
import { generateProposal } from "../../lib/proposal/service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { const tenantId = localTenant(request); const body = await jsonBody(request); return Response.json({ proposal: generateProposal(body, tenantId, "CALCULATION") }); }
  catch (error) { return proposalError(error); }
}
