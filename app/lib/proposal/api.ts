// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertInputSize, proposalFail } from "./integrity.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertProposalSnapshot } from "./service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { exportCsv, exportHtml, exportJson } from "../export/serialization.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { renderReceiptProposal } from "../export/receipt-pdf.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { parseProposalPresentation, presentationMatches, fallbackPresentation, type ProposalPresentation } from "./presentation.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { COMPANY_PROFILE_RECORD_ID } from "../company/profile.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { safeProposalFilename, assertProposalOutputSize } from "../export/serialization.ts";
import type { ProposalExportDocument } from "../export/types";
import type { ProposalExportFormat } from "./types";
import type { AuthenticatedPrincipal } from "../auth/types";
import { createHash } from "node:crypto";
import { runtimeRepositories } from "../persistence/adapter";
import { recordRuntimeAudit } from "../persistence/audit";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertCommerciallyActive } from "../calculation/engine.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertProposalInScope } from "./scope.ts";

export const PROPOSAL_CORRELATION_ID = "commercial-proposal-export-v1";

/** The special conditions of a forced offer, from its trace; none for any other offer. A trace that cannot be read stops the
 *  export rather than producing a forced offer's PDF without its conditions. */
export async function specialConditionCodesOf(repositories: Pick<ReturnType<typeof runtimeRepositories>, "cteForcingRecords">, tenantId: string, proposalId: string): Promise<readonly string[]> {
  const trace = await repositories.cteForcingRecords.get(tenantId, proposalId);
  if (!trace) return [];
  if (trace.payload.proposalId !== proposalId || trace.payload.tenantId !== tenantId) throw new Error("PROPOSAL_FORCING_TRACE_INVALID");
  return trace.payload.specialConditions.map((item) => item.code);
}

export async function readCanonicalProposal(tenantId: string, proposalId: string): Promise<{ readonly record: Awaited<ReturnType<ReturnType<typeof runtimeRepositories>["proposals"]["get"]>>; readonly proposal: ReturnType<typeof assertProposalSnapshot> }> {
  const record = await runtimeRepositories().proposals.get(tenantId, proposalId);
  if (!record) throw new Error("PROPOSAL_NOT_FOUND");
  if (record.recordId !== proposalId || record.payload.proposalId !== proposalId || record.payload.proposalFingerprint !== (record.payload.proposal as { readonly proposalFingerprint?: unknown }).proposalFingerprint) proposalFail("PROPOSAL_RECORD_INVALID");
  const proposal = assertProposalSnapshot(record.payload.proposal, tenantId);
  if (proposal.proposalId !== proposalId || proposal.proposalFingerprint !== record.payload.proposalFingerprint) proposalFail("PROPOSAL_RECORD_INVALID");
  return { record, proposal };
}

async function canonicalProposal(body: Record<string, unknown>, tenantId: string): Promise<ReturnType<typeof assertProposalSnapshot>> {
  const proposalId = body.proposalId;
  if (typeof proposalId !== "string" || !proposalId.trim()) throw new Error("PROPOSAL_ID_REQUIRED");
  return (await readCanonicalProposal(tenantId, proposalId)).proposal;
}

export function proposalError(error: unknown, fallback = "PROPOSAL_REQUEST_INVALID"): Response {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : fallback;
  const status = code === "TENANT_ACCESS_DENIED" ? 403 : code.endsWith("NOT_FOUND") ? 404 : code.includes("MISMATCH") || code.includes("EXCLUDED") || code.startsWith("CTE_COMMERCIAL_") || code.startsWith("SOURCE_BILL_") ? 409 : 400;
  return Response.json({ error: { code, message: "Proposal request denied", correlationId: PROPOSAL_CORRELATION_ID } }, { status });
}

/**
 * Tony (31/10): the proposal PDF is laid out like a bill (scontrino), in Italian, with the company's logo and data. The
 * screen's figures come with the request; they are kept so the PDF can be downloaded again later.
 */
async function receiptPdf(proposal: Awaited<ReturnType<typeof canonicalProposal>>, tenantId: string, raw: unknown, repositories: ReturnType<typeof runtimeRepositories>): Promise<ProposalExportDocument> {
  let presentation: ProposalPresentation | null = parseProposalPresentation(raw);
  if (presentation && !presentationMatches(presentation, proposal)) throw new Error("PROPOSAL_PRESENTATION_MISMATCH");
  const stored = await repositories.proposalPresentations.get(tenantId, proposal.proposalId).catch(() => null);
  if (presentation) await repositories.proposalPresentations.put({ tenantId, recordId: proposal.proposalId, payload: presentation, ...(stored ? { expectedVersion: stored.version } : {}) }).catch(() => undefined);
  else presentation = stored?.payload ?? fallbackPresentation(proposal);
  const profile = (await repositories.companyProfiles.get(tenantId, COMPANY_PROFILE_RECORD_ID).catch(() => null))?.payload ?? null;
  // Tony (20/11/2026): a forced offer's PDF states the conditions applied, read from its trace (never from the request).
  const body = renderReceiptProposal(proposal, presentation, profile, await specialConditionCodesOf(repositories, tenantId, proposal.proposalId));
  assertProposalOutputSize(body);
  return { format: "PDF", contentType: "application/pdf", filename: safeProposalFilename(proposal, "PDF"), body };
}

export async function exportResponse(body: Record<string, unknown>, tenantId: string, format: ProposalExportFormat, principal?: AuthenticatedPrincipal): Promise<Response> {
  assertInputSize(body);
  const proposal = await canonicalProposal(body, tenantId);
  if (principal) await assertProposalInScope(principal, runtimeRepositories(), proposal);
  const repositories = runtimeRepositories();
  const document: ProposalExportDocument = format === "JSON" ? exportJson(proposal, tenantId) : format === "CSV" ? exportCsv(proposal, tenantId) : format === "HTML" ? exportHtml(proposal, tenantId) : await receiptPdf(proposal, tenantId, body.presentation, repositories);
  await assertCommerciallyActive(repositories.cteArchiveRepository, tenantId, proposal.cte.archiveId, proposal.cte.versionId);
  const contentFingerprint = createHash("sha256").update(document.body).digest("hex");
  await repositories.exports.put({ tenantId, recordId: `export_${contentFingerprint.slice(0, 32)}`, payload: { exportId: `export_${contentFingerprint.slice(0, 32)}`, proposalId: proposal.proposalId, format, contentFingerprint }, idempotencyKey: contentFingerprint });
  await recordRuntimeAudit({ tenantId, principal, action: "EXPORT_GENERATION", resourceType: "PROPOSAL_EXPORT", resourceId: `export_${contentFingerprint.slice(0, 32)}`, outcome: "ALLOWED", correlationId: PROPOSAL_CORRELATION_ID, metadata: { format, contentFingerprint } });
  const responseBody: BodyInit = typeof document.body === "string" ? document.body : document.body as unknown as ArrayBuffer;
  return new Response(responseBody, { status: 200, headers: { "content-type": document.contentType, "content-disposition": `attachment; filename="${document.filename}"`, "cache-control": "no-store" } });
}
