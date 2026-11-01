import {
  approveDocumentVersion,
  confirmBillFields,
  createManualCorrection,
  createAnalystRefreshVersion,
  storedBillContentType,
  toPublicApprovedDocument,
  parseBillOperation,
  toPublicDocument,
} from "../../../lib/foundation/real-bill";
import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";
import { attachOfficialPun, ensureOfficialPunForBill, withDocumentPriceRows } from "../../../lib/market/pun-reference";
import { billPunRefresh } from "../../../lib/market-refresh/bill-pun";
import { deleteBillPermanently } from "../../../lib/foundation/bill-retention";
import { billVisibilityScope, getBillInScope } from "../../../lib/foundation/bill-visibility";
import { isBillFeature, resolveBillFeaturePermissions, sanitizeBillForFeatureAccess, type BillFeature } from "../../../lib/foundation/bill-feature-permissions";
import { createAnthropicTwoStageBillSdkAdapter, printedText } from "../../../lib/ingestion/anthropic-bill-sdk";
import { printedScontrinoLines, readingHasScontrino, scontrinoSource, withPrintedScontrino, withScontrinoTranscript } from "../../../lib/ingestion/printed-scontrino";
import type { AuthenticatedPrincipal } from "../../../lib/auth/types";
import type { RuntimeRepositories } from "../../../lib/persistence/adapter";
import type { PublicBillDocument } from "../../../lib/foundation/real-bill";

const CORRELATION_ID = "foundation-bills";
const NO_STORE_HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
function deny(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message, correlationId: CORRELATION_ID } }, { status, headers: NO_STORE_HEADERS });
}

async function publicDocumentFor(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, document: PublicBillDocument): Promise<PublicBillDocument> {
  const scope = await billVisibilityScope(principal, repositories);
  const access = await resolveBillFeaturePermissions(principal, repositories, scope);
  return sanitizeBillForFeatureAccess(document, access);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const principal = await requestPrincipal(request, "READ");
    const repositories = runtimeRepositories();
    const document = await getBillInScope(principal, repositories, id);
    const approvedView = new URL(request.url).searchParams.get("view") === "approved";
    const scope = await billVisibilityScope(principal, repositories);
    const access = await resolveBillFeaturePermissions(principal, repositories, scope);
    const requestedFeature = new URL(request.url).searchParams.get("feature");
    if (requestedFeature !== null && (!isBillFeature(requestedFeature) || !access.features[requestedFeature as BillFeature])) return deny("BILL_FEATURE_ACCESS_DENIED", "Funzione tecnica non autorizzata", 403);
    const shownDocument = document ? (approvedView ? toPublicApprovedDocument(document) : toPublicDocument(document)) : null;
    const withPrinted = shownDocument && document ? await withDocumentPriceRows(shownDocument, () => repositories.documentStorage.read(document.tenantId, document.id)) : shownDocument;
    // The scontrino printed in the PDF counts as read charge lines.
    const publicDocument = withPrinted && withPrinted.chargeLinesUnread && readingHasScontrino(withPrinted.structuredBill) ? { ...withPrinted, chargeLinesUnread: false } : withPrinted;
    if (publicDocument) await ensureOfficialPunForBill(publicDocument, repositories.marketArchiveRepository, billPunRefresh(repositories, publicDocument.tenantId));
    return publicDocument ? Response.json({ document: sanitizeBillForFeatureAccess(await attachOfficialPun(publicDocument, repositories.marketArchiveRepository), access) }, { headers: NO_STORE_HEADERS }) : deny("DOCUMENT_NOT_FOUND", "Bill document not found", 404);
  } catch (error) {
    const code = publicErrorCode(error);
    return deny(code, messageFor(code), statusFor(code));
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deny("BILL_OPERATION_INVALID", "Malformed request body", 400);
  }

  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const repository = repositories.billRepository;
    const audit = { async record(event: { readonly type: string; readonly tenantId: string; readonly documentId: string; readonly outcome: string }) { await recordRuntimeAudit({ principal, action: `BILL_${event.type}`, resourceType: "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "DENIED", correlationId: CORRELATION_ID }); } };
    const document = await getBillInScope(principal, repositories, id);
    if (!document) return deny("DOCUMENT_NOT_FOUND", "Bill document not found", 404);
    const now = new Date().toISOString();
    const operation = parseBillOperation(body);
    if (operation?.operation === "confirm-fields") {
      const confirmed = confirmBillFields({ document, tenantId, sourceVersionId: operation.versionId, fields: operation.fields, at: now });
      await repository.saveIfCurrentVersion(confirmed, operation.versionId, document.versions.find((version) => version.versionId === operation.versionId)!);
      await recordRuntimeAudit({
        principal,
        action: "BILL_FIELD_CONFIRMATION",
        resourceType: "BILL",
        resourceId: id,
        outcome: "ALLOWED",
        correlationId: CORRELATION_ID,
        metadata: { sourceVersionId: operation.versionId, resultVersionId: confirmed.currentVersionId, fields: operation.fields.join(",") },
      });
      return Response.json({ document: await publicDocumentFor(principal, repositories, await attachOfficialPun(toPublicDocument(confirmed), repositories.marketArchiveRepository)) }, { headers: NO_STORE_HEADERS });
    }
    if (operation?.operation === "approve") {
      const approved = approveDocumentVersion({ document, tenantId, versionId: operation.versionId, at: now });
      await repository.saveIfCurrentVersion(approved, operation.versionId, document.versions.find((version) => version.versionId === operation.versionId)!);
      await audit.record({ type: "APPROVAL", tenantId, documentId: id, outcome: "ALLOWED" });
      return Response.json({ document: await publicDocumentFor(principal, repositories, await attachOfficialPun(toPublicDocument(approved), repositories.marketArchiveRepository)) }, { headers: NO_STORE_HEADERS });
    }
    if (operation?.operation === "correct") {
      const corrected = createManualCorrection({
        document,
        tenantId,
        sourceVersionId: operation.versionId ?? document.currentVersionId,
        field: operation.field,
        value: operation.value,
        at: now,
      });
      const sourceVersionId = operation.versionId ?? document.currentVersionId;
      await repository.saveIfCurrentVersion(corrected, sourceVersionId, document.versions.find((version) => version.versionId === sourceVersionId)!);
      await audit.record({ type: "MANUAL_REVIEW", tenantId, documentId: id, outcome: "ALLOWED" });
      await audit.record({ type: "CORRECTION", tenantId, documentId: id, outcome: "ALLOWED" });
      return Response.json({ document: await publicDocumentFor(principal, repositories, await attachOfficialPun(toPublicDocument(corrected), repositories.marketArchiveRepository)) }, { headers: NO_STORE_HEADERS });
    }
    if (operation?.operation === "reread-analyst") {
      // Tony (1/11, "le bollette non riesci a leggerle"): the charge lines are read again from the stored file.
      const bytes = await repositories.documentStorage.read(tenantId, document.id);
      const contentType = storedBillContentType(bytes);
      if (!contentType) return deny("BILL_OPERATION_INVALID", "Stored file type not recognized", 400);
      // The scontrino printed in the PDF text completes a reading that lacks it (Tony, 1/11); when the second reading fails
      // again, the stored reading is kept and the printed scontrino alone fills the bill side.
      const pdfText = printedText({ bytes, contentType });
      // Tony (1/11): an image or scanned bill gets its scontrino copied row by row and read by the same parser.
      const current = document.versions.find((version) => version.versionId === operation.versionId)?.structuredBill ?? null;
      const adapter = createAnthropicTwoStageBillSdkAdapter();
      const transcript = pdfText && printedScontrinoLines(pdfText).length ? null : current?.scontrinoTranscript ?? await adapter.transcribeScontrino({ bytes, contentType });
      const text = transcript ?? scontrinoSource(current, pdfText);
      let analyst: Awaited<ReturnType<ReturnType<typeof createAnthropicTwoStageBillSdkAdapter>["extractAnalystOnly"]>> | null = null;
      try { analyst = await adapter.extractAnalystOnly({ bytes, contentType }); }
      catch (error) { if (!text || !printedScontrinoLines(text).length) throw error; console.error(`[BILL_ANALYST_REREAD_FAILED] bill=${document.id} using printed scontrino`); }
      const refreshed = createAnalystRefreshVersion({ document, tenantId, sourceVersionId: operation.versionId, analyst, at: now, refine: (extraction) => transcript ? withScontrinoTranscript(extraction, transcript) : withPrintedScontrino(extraction, text) });
      await repository.saveIfCurrentVersion(refreshed, operation.versionId, document.versions.find((version) => version.versionId === operation.versionId)!);
      await audit.record({ type: "INGESTION", tenantId, documentId: id, outcome: "ALLOWED" });
      return Response.json({ document: await publicDocumentFor(principal, repositories, await attachOfficialPun(toPublicDocument(refreshed), repositories.marketArchiveRepository)) }, { headers: NO_STORE_HEADERS });
    }
    return deny("BILL_OPERATION_INVALID", "Unsupported bill operation", 400);
  } catch (error) {
    const code = publicErrorCode(error);
    return deny(code, messageFor(code), statusFor(code));
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const repositories = runtimeRepositories();
    const document = await getBillInScope(principal, repositories, id);
    if (!document) return Response.json({ deleted: true }, { headers: NO_STORE_HEADERS });
    if (document.lifecycleState === "DELETED") return Response.json({ deleted: true }, { headers: NO_STORE_HEADERS });
    // Tony (31/10): "serve un tasto cancella le bollette". Any bill the user can see and edit is removed for good.
    const audit = { async record(event: { readonly type: string; readonly documentId: string; readonly outcome: string }) { await recordRuntimeAudit({ principal, action: "BILL_DELETED_BY_USER", resourceType: "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "DENIED", correlationId: CORRELATION_ID }); } };
    await deleteBillPermanently({ tenantId: principal.tenantId, documentId: document.id, repositories: { bills: repositories.billRepository, storage: repositories.documentStorage, audit } });
    return Response.json({ deleted: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const code = publicErrorCode(error);
    return deny(code, messageFor(code), statusFor(code));
  }
}

const INTERNAL_TO_PUBLIC_CODE: Readonly<Record<string, string>> = {
  APPROVAL_REQUIRED_FIELDS_MISSING: "APPROVAL_REQUIRED_FIELDS_MISSING",
  APPROVAL_FIELDS_UNCONFIRMED: "APPROVAL_FIELDS_UNCONFIRMED",
  DOCUMENT_VERSION_NOT_CURRENT: "DOCUMENT_VERSION_NOT_CURRENT",
  DOCUMENT_VERSION_STALE: "DOCUMENT_VERSION_STALE",
  DOCUMENT_VERSION_ALREADY_APPROVED: "DOCUMENT_VERSION_ALREADY_APPROVED",
  DOCUMENT_VERSION_NOT_FOUND: "DOCUMENT_VERSION_NOT_FOUND",
  DOCUMENT_NO_CHANGES: "DOCUMENT_NO_CHANGES",
  FIELD_CONFIRMATION_INVALID: "FIELD_CONFIRMATION_INVALID",
  BILL_REPOSITORY_CAS_UNAVAILABLE: "BILL_REPOSITORY_CAS_UNAVAILABLE",
  BILL_REPOSITORY_BUSY: "BILL_REPOSITORY_BUSY",
  METADATA_INVALID: "METADATA_INVALID",
  CORRECTION_INVALID: "CORRECTION_INVALID",
  TENANT_ACCESS_DENIED: "TENANT_ACCESS_DENIED",
  BILL_OPERATION_INVALID: "BILL_OPERATION_INVALID",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  BILL_APPROVED_DELETE_FORBIDDEN: "BILL_APPROVED_DELETE_FORBIDDEN",
  BILL_RETENTION_NOT_DUE: "BILL_RETENTION_NOT_DUE",
  BILL_DELETE_UNAVAILABLE: "BILL_DELETE_UNAVAILABLE",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  AUTHENTICATION_INVALID: "AUTHENTICATION_INVALID",
  AUTH_CONFIGURATION_INVALID: "AUTH_CONFIGURATION_INVALID",
  AUTH_ADAPTER_UNAVAILABLE: "AUTH_ADAPTER_UNAVAILABLE",
  AUTH_AUDIT_UNAVAILABLE: "AUTH_AUDIT_UNAVAILABLE",
  AUTHORIZATION_DENIED: "AUTHORIZATION_DENIED",
};

function publicErrorCode(error: unknown): string {
  const internalCode = error instanceof Error ? error.message : "";
  return Object.prototype.hasOwnProperty.call(INTERNAL_TO_PUBLIC_CODE, internalCode) ? INTERNAL_TO_PUBLIC_CODE[internalCode] : "BILL_OPERATION_FAILED";
}

function statusFor(code: string): number {
  if (code === "TENANT_ACCESS_DENIED" || code === "AUTHORIZATION_DENIED") return 403;
  if (code === "AUTHENTICATION_REQUIRED" || code === "AUTHENTICATION_INVALID") return 401;
  if (code === "AUTH_CONFIGURATION_INVALID" || code === "AUTH_ADAPTER_UNAVAILABLE" || code === "AUTH_AUDIT_UNAVAILABLE") return 503;
  if (code === "BILL_REPOSITORY_CAS_UNAVAILABLE" || code === "BILL_REPOSITORY_BUSY") return 503;
  if (["DOCUMENT_NOT_FOUND"].includes(code)) return 404;
  if (["BILL_APPROVED_DELETE_FORBIDDEN", "BILL_RETENTION_NOT_DUE"].includes(code)) return 409;
  if (["DOCUMENT_VERSION_NOT_CURRENT", "DOCUMENT_VERSION_STALE", "DOCUMENT_VERSION_ALREADY_APPROVED", "DOCUMENT_NO_CHANGES", "METADATA_INVALID"].includes(code)) return 409;
  return 400;
}

function messageFor(code: string): string {
  switch (code) {
    case "APPROVAL_REQUIRED_FIELDS_MISSING":
      return "Required bill fields are missing";
    case "APPROVAL_FIELDS_UNCONFIRMED":
      return "Required bill fields must be confirmed";
    case "DOCUMENT_VERSION_NOT_CURRENT":
      return "Only the current working version can be approved";
    case "DOCUMENT_VERSION_STALE":
      return "The requested version is stale";
    case "DOCUMENT_VERSION_ALREADY_APPROVED":
      return "The current version is already approved";
    case "DOCUMENT_VERSION_NOT_FOUND":
      return "The requested version does not exist";
    case "DOCUMENT_NO_CHANGES":
      return "The requested correction changes no fields";
    case "FIELD_CONFIRMATION_INVALID":
      return "Only existing, available bill fields can be confirmed";
    case "METADATA_INVALID":
      return "Bill metadata is invalid";
    case "CORRECTION_INVALID":
      return "The correction payload is invalid";
    case "TENANT_ACCESS_DENIED":
      return "Tenant access denied";
    case "BILL_APPROVED_DELETE_FORBIDDEN":
      return "Approved bills cannot be deleted";
    case "BILL_DELETE_UNAVAILABLE":
      return "Bill deletion is not available";
    case "BILL_RETENTION_NOT_DUE":
      return "Bill deletion is available only after the retention period";
    default:
      return "Bill operation failed";
  }
}

// The charge lines can be read again here (reread-analyst): same time as an upload.
export const maxDuration = 300;
