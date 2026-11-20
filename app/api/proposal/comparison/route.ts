import { loadHierarchyAccess } from "../../../lib/hierarchy/service";
import { jsonBody } from "../../../lib/archive/api";
import { requestPrincipal } from "../../../lib/auth/request";
import { proposalError } from "../../../lib/proposal/api";
import { generateProposal } from "../../../lib/proposal/service";
import { resolveAuthoritativeProposalInput } from "../../../lib/proposal/server";
import { assertProposalInScope } from "../../../lib/proposal/scope";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";
import { recordForcedOffer } from "../../../lib/eligibility/forcing";
import { specialConditionLines } from "../../../lib/eligibility/special-conditions";
import { assertCommerciallyActive } from "../../../lib/calculation/engine";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "OPERATE"); const tenantId = principal.tenantId; const body = await jsonBody(request); const repositories = runtimeRepositories(); const hierarchy = await loadHierarchyAccess(principal, repositories); const trustedInput = await resolveAuthoritativeProposalInput(repositories, body, tenantId, "COMPARISON", hierarchy); const proposal = generateProposal(trustedInput, tenantId, "COMPARISON"); await assertProposalInScope(principal, repositories, proposal); await assertCommerciallyActive(repositories.cteArchiveRepository, tenantId, proposal.cte.archiveId, proposal.cte.versionId); /* Tony (20/11/2026): an offer produced with a forced CTE is traced before it is stored. */ const forcing = await recordForcedOffer(principal, repositories, proposal, { userId: hierarchy.actor.userId, canonicalRole: hierarchy.actor.role }); await repositories.proposals.put({ tenantId, recordId: proposal.proposalId, payload: { proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, proposal }, idempotencyKey: proposal.proposalFingerprint }); await recordRuntimeAudit({ principal, action: "PROPOSAL_GENERATION", resourceType: "PROPOSAL", resourceId: proposal.proposalId, outcome: "ALLOWED", correlationId: "commercial-proposal-v1", metadata: { proposalFingerprint: proposal.proposalFingerprint } }); return Response.json({ proposal, specialConditions: specialConditionLines(forcing?.specialConditions.map((item) => item.code)) }); }
  catch (error) { return proposalError(error); }
}
