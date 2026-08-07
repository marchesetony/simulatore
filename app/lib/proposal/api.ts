// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertInputSize, proposalFail } from "./integrity.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { exportCsv, exportHtml, exportJson } from "../export/serialization.ts";
import type { ProposalExportDocument } from "../export/types";
import type { ProposalExportFormat } from "./types";
import type { AuthenticatedPrincipal } from "../auth/types";
import { createHash } from "node:crypto";
import { runtimeRepositories } from "../persistence/adapter";
import { recordRuntimeAudit } from "../persistence/audit";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertCommerciallyActive } from "../calculation/engine.ts";

export const PROPOSAL_CORRELATION_ID = "commercial-proposal-export-v1";

export function proposalError(error: unknown, fallback = "PROPOSAL_REQUEST_INVALID"): Response {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : fallback;
  const status = code === "TENANT_ACCESS_DENIED" ? 403 : code.endsWith("NOT_FOUND") ? 404 : code.includes("MISMATCH") || code.includes("EXCLUDED") || code.startsWith("CTE_COMMERCIAL_") ? 409 : 400;
  return Response.json({ error: { code, message: "Proposal request denied", correlationId: PROPOSAL_CORRELATION_ID } }, { status });
}

export async function exportResponse(body: Record<string, unknown>, tenantId: string, format: ProposalExportFormat, principal?: AuthenticatedPrincipal): Promise<Response> {
  assertInputSize(body);
  if (body.proposal === undefined) proposalFail("PROPOSAL_REQUIRED");
  const document: ProposalExportDocument = format === "JSON" ? exportJson(body.proposal as never, tenantId) : format === "CSV" ? exportCsv(body.proposal as never, tenantId) : exportHtml(body.proposal as never, tenantId);
  const proposal = body.proposal as { readonly proposalId: string; readonly proposalFingerprint: string; readonly cte: { readonly archiveId: string; readonly versionId: string } };
  const repositories = runtimeRepositories();
  await assertCommerciallyActive(repositories.cteArchiveRepository, tenantId, proposal.cte.archiveId, proposal.cte.versionId);
  const contentFingerprint = createHash("sha256").update(document.body, "utf8").digest("hex");
  await repositories.exports.put({ tenantId, recordId: `export_${contentFingerprint.slice(0, 32)}`, payload: { exportId: `export_${contentFingerprint.slice(0, 32)}`, proposalId: proposal.proposalId, format, contentFingerprint }, idempotencyKey: contentFingerprint });
  await recordRuntimeAudit({ tenantId, principal, action: "EXPORT_GENERATION", resourceType: "PROPOSAL_EXPORT", resourceId: `export_${contentFingerprint.slice(0, 32)}`, outcome: "ALLOWED", correlationId: PROPOSAL_CORRELATION_ID, metadata: { format, contentFingerprint } });
  return new Response(document.body, { status: 200, headers: { "content-type": document.contentType, "content-disposition": `attachment; filename="${document.filename}"`, "cache-control": "no-store" } });
}
