// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertInputSize, proposalFail } from "./integrity.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { exportCsv, exportHtml, exportJson } from "../export/serialization.ts";
import type { ProposalExportDocument } from "../export/types";
import type { ProposalExportFormat } from "./types";

export const PROPOSAL_CORRELATION_ID = "commercial-proposal-export-v1";

export function proposalError(error: unknown, fallback = "PROPOSAL_REQUEST_INVALID"): Response {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : fallback;
  const status = code === "TENANT_ACCESS_DENIED" ? 403 : code.endsWith("NOT_FOUND") ? 404 : code.includes("MISMATCH") || code.includes("EXCLUDED") ? 409 : 400;
  return Response.json({ error: { code, message: "Proposal request denied", correlationId: PROPOSAL_CORRELATION_ID } }, { status });
}

export function exportResponse(body: Record<string, unknown>, tenantId: string, format: ProposalExportFormat): Response {
  assertInputSize(body);
  if (body.proposal === undefined) proposalFail("PROPOSAL_REQUIRED");
  const document: ProposalExportDocument = format === "JSON" ? exportJson(body.proposal as never, tenantId) : format === "CSV" ? exportCsv(body.proposal as never, tenantId) : exportHtml(body.proposal as never, tenantId);
  return new Response(document.body, { status: 200, headers: { "content-type": document.contentType, "content-disposition": `attachment; filename="${document.filename}"`, "cache-control": "no-store" } });
}
