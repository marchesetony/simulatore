import { requestPrincipal } from "../../../lib/auth/request";
import { proposalError, readCanonicalProposal } from "../../../lib/proposal/api";
import { assertProposalInScope } from "../../../lib/proposal/scope";
import { runtimeRepositories } from "../../../lib/persistence/adapter";

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
