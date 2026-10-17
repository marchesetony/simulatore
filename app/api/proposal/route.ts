import { loadHierarchyAccess } from "../../lib/hierarchy/service";
import { jsonBody } from "../../lib/archive/api";
import { requestPrincipal } from "../../lib/auth/request";
import { proposalError, readCanonicalProposal } from "../../lib/proposal/api";
import { generateProposal } from "../../lib/proposal/service";
import { resolveAuthoritativeProposalInput } from "../../lib/proposal/server";
import { assertProposalInScope, proposalInScope, proposalScope } from "../../lib/proposal/scope";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";
import { assertCommerciallyActive } from "../../lib/calculation/engine";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const repositories = runtimeRepositories();
    const [records, access] = await Promise.all([repositories.proposals.list(principal.tenantId), proposalScope(principal, repositories)]);
    const readback = await Promise.all(records.filter((record) => proposalInScope(access, record.payload.proposal as { readonly sourceBill?: { readonly billId: string } })).map(async (record) => ({ ...record, payload: { proposalId: record.payload.proposalId, proposalFingerprint: record.payload.proposalFingerprint, proposal: (await readCanonicalProposal(principal.tenantId, record.recordId)).proposal } })));
    return Response.json({ records: readback }, { headers: { "cache-control": "no-store, private" } });
  } catch (error) { return proposalError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "OPERATE"); const tenantId = principal.tenantId; const body = await jsonBody(request); const repositories = runtimeRepositories(); const trustedInput = await resolveAuthoritativeProposalInput(repositories, body, tenantId, "CALCULATION", await loadHierarchyAccess(principal, repositories)); const proposal = generateProposal(trustedInput, tenantId, "CALCULATION"); await assertProposalInScope(principal, repositories, proposal); await assertCommerciallyActive(repositories.cteArchiveRepository, tenantId, proposal.cte.archiveId, proposal.cte.versionId); await repositories.proposals.put({ tenantId, recordId: proposal.proposalId, payload: { proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, proposal }, idempotencyKey: proposal.proposalFingerprint }); await recordRuntimeAudit({ principal, action: "PROPOSAL_GENERATION", resourceType: "PROPOSAL", resourceId: proposal.proposalId, outcome: "ALLOWED", correlationId: "commercial-proposal-v1", metadata: { proposalFingerprint: proposal.proposalFingerprint } }); return Response.json({ proposal }); }
  catch (error) { return proposalError(error); }
}
