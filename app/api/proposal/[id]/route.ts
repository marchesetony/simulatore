import { requestPrincipal } from "../../../lib/auth/request";
import { proposalError, readCanonicalProposal } from "../../../lib/proposal/api";
import { assertProposalInScope } from "../../../lib/proposal/scope";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const { id } = await context.params;
    const readback = await readCanonicalProposal(principal.tenantId, id);
    await assertProposalInScope(principal, runtimeRepositories(), readback.proposal);
    return Response.json({ record: { ...readback.record, payload: { proposalId: readback.proposal.proposalId, proposalFingerprint: readback.proposal.proposalFingerprint, proposal: readback.proposal } } }, { headers: { "cache-control": "no-store, private" } });
  } catch (error) { return proposalError(error); }
}

// Tony (1/11): "bisogna aggiungere tasto per eliminare la simulazione". Whoever may see the proposal deletes it for good,
// with the scontrino saved for its PDF.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const { id } = await context.params;
    const repositories = runtimeRepositories();
    const readback = await readCanonicalProposal(principal.tenantId, id);
    await assertProposalInScope(principal, repositories, readback.proposal);
    const removable = (repository: unknown) => repository as { readonly delete?: (input: { readonly tenantId: string; readonly recordId: string; readonly expectedVersion?: number }) => Promise<void> };
    const proposals = removable(repositories.proposals);
    if (!proposals.delete || !readback.record) throw new Error("PROPOSAL_DELETE_UNAVAILABLE");
    await proposals.delete({ tenantId: principal.tenantId, recordId: id, expectedVersion: readback.record.version });
    const presentation = await repositories.proposalPresentations.get(principal.tenantId, id).catch(() => null);
    if (presentation) await removable(repositories.proposalPresentations).delete?.({ tenantId: principal.tenantId, recordId: id, expectedVersion: presentation.version }).catch(() => undefined);
    await recordRuntimeAudit({ principal, action: "PROPOSAL_DELETION", resourceType: "PROPOSAL", resourceId: id, outcome: "ALLOWED", correlationId: "commercial-proposal-v1", metadata: { proposalFingerprint: readback.proposal.proposalFingerprint } }).catch(() => undefined);
    return Response.json({ deleted: id }, { headers: { "cache-control": "no-store, private" } });
  } catch (error) { return proposalError(error); }
}
