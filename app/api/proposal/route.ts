import { jsonBody } from "../../lib/archive/api";
import { requestPrincipal } from "../../lib/auth/request";
import { proposalError } from "../../lib/proposal/api";
import { generateProposal } from "../../lib/proposal/service";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";
import { assertCommerciallyActive } from "../../lib/calculation/engine";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "WRITE"); const tenantId = principal.tenantId; const body = await jsonBody(request); const repositories = runtimeRepositories(); const proposal = generateProposal(body, tenantId, "CALCULATION"); await assertCommerciallyActive(repositories.cteArchiveRepository, tenantId, proposal.cte.archiveId, proposal.cte.versionId); await repositories.proposals.put({ tenantId, recordId: proposal.proposalId, payload: { proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, proposal }, idempotencyKey: proposal.proposalFingerprint }); await recordRuntimeAudit({ principal, action: "PROPOSAL_GENERATION", resourceType: "PROPOSAL", resourceId: proposal.proposalId, outcome: "ALLOWED", correlationId: "commercial-proposal-v1", metadata: { proposalFingerprint: proposal.proposalFingerprint } }); return Response.json({ proposal }); }
  catch (error) { return proposalError(error); }
}
