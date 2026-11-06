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

// Tony (1/11): "le proposte solo in pdf, bisogna mettere il nome del cliente e la cte proposta". The archive names each
// proposal by its customer and its CTE, read from the scontrino saved with it, else from the proposal itself.
async function proposalLabel(tenantId: string, proposalId: string, proposal: unknown): Promise<{ readonly customerName: string; readonly offerName: string; readonly offerSupplier: string; readonly savings: number | null }> {
  const stored = await runtimeRepositories().proposalPresentations.get(tenantId, proposalId).catch(() => null);
  const item = (typeof proposal === "object" && proposal !== null ? proposal : {}) as { readonly customer?: { readonly displayName?: string | null; readonly customerId?: string | null }; readonly selectedOffer?: { readonly supplier?: string; readonly offerCode?: string } };
  const shown = stored?.payload;
  return {
    customerName: shown?.customerName || item.customer?.displayName || item.customer?.customerId || "",
    offerName: shown?.offerName || item.selectedOffer?.offerCode || "",
    offerSupplier: shown?.offerSupplier || item.selectedOffer?.supplier || "",
    savings: typeof shown?.savings === "number" ? shown.savings : null,
  };
}

// Tony (2/11, "e whatsapp non si attiva"): a proposal whose CTE was deleted, blocked or replaced in the archive cannot be sent
// (the export refuses it with CTE_COMMERCIAL_DELETED). The archive says so on the row instead of failing on the click.
async function cteIssueOf(tenantId: string, proposal: unknown): Promise<string | null> {
  const cte = (typeof proposal === "object" && proposal !== null ? (proposal as { readonly cte?: { readonly archiveId?: string; readonly versionId?: string } }).cte : undefined);
  if (!cte?.archiveId || !cte.versionId) return null;
  try { await assertCommerciallyActive(runtimeRepositories().cteArchiveRepository, tenantId, cte.archiveId, cte.versionId); return null; }
  catch (error) { const code = error instanceof Error ? error.message : ""; return /^CTE_(COMMERCIAL_DELETED|NOT_FOUND|COMMERCIAL_BLOCKED|NOT_APPROVED)$/.test(code) ? code : null; }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const repositories = runtimeRepositories();
    const [records, access] = await Promise.all([repositories.proposals.list(principal.tenantId), proposalScope(principal, repositories)]);
    const readback = await Promise.all(records.filter((record) => proposalInScope(access, record.payload.proposal as { readonly sourceBill?: { readonly billId: string } })).map(async (record) => ({ ...record, payload: { proposalId: record.payload.proposalId, proposalFingerprint: record.payload.proposalFingerprint, proposal: (await readCanonicalProposal(principal.tenantId, record.recordId)).proposal, label: await proposalLabel(principal.tenantId, record.recordId, record.payload.proposal), cteIssue: await cteIssueOf(principal.tenantId, record.payload.proposal) } })));
    return Response.json({ records: readback }, { headers: { "cache-control": "no-store, private" } });
  } catch (error) { return proposalError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { const principal = await requestPrincipal(request, "OPERATE"); const tenantId = principal.tenantId; const body = await jsonBody(request); const repositories = runtimeRepositories(); const trustedInput = await resolveAuthoritativeProposalInput(repositories, body, tenantId, "CALCULATION", await loadHierarchyAccess(principal, repositories)); const proposal = generateProposal(trustedInput, tenantId, "CALCULATION"); await assertProposalInScope(principal, repositories, proposal); await assertCommerciallyActive(repositories.cteArchiveRepository, tenantId, proposal.cte.archiveId, proposal.cte.versionId); await repositories.proposals.put({ tenantId, recordId: proposal.proposalId, payload: { proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, proposal }, idempotencyKey: proposal.proposalFingerprint }); await recordRuntimeAudit({ principal, action: "PROPOSAL_GENERATION", resourceType: "PROPOSAL", resourceId: proposal.proposalId, outcome: "ALLOWED", correlationId: "commercial-proposal-v1", metadata: { proposalFingerprint: proposal.proposalFingerprint } }); return Response.json({ proposal }); }
  catch (error) { return proposalError(error); }
}
