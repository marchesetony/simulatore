import {
  approveDocumentVersion,
  createManualCorrection,
  toPublicApprovedDocument,
  parseBillOperation,
  toPublicDocument,
} from "../../../lib/foundation/real-bill";
import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";
import { attachOfficialPun } from "../../../lib/market/pun-reference";

const CORRELATION_ID = "foundation-bills";
const NO_STORE_HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
function deny(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message, correlationId: CORRELATION_ID } }, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const tenantId = (await requestPrincipal(request, "READ")).tenantId;
    const repositories = runtimeRepositories();
    const document = await repositories.billRepository.get(tenantId, id);
    const approvedView = new URL(request.url).searchParams.get("view") === "approved";
    const publicDocument = document ? (approvedView ? toPublicApprovedDocument(document) : toPublicDocument(document)) : null;
    return publicDocument ? Response.json({ document: await attachOfficialPun(publicDocument, repositories.marketArchiveRepository) }, { headers: NO_STORE_HEADERS }) : deny("DOCUMENT_NOT_FOUND", "Bill document not found", 404);
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
    const principal = await requestPrincipal(request, "WRITE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const repository = repositories.billRepository;
    const audit = { async record(event: { readonly type: string; readonly tenantId: string; readonly documentId: string; readonly outcome: string }) { await recordRuntimeAudit({ principal, action: `BILL_${event.type}`, resourceType: "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "DENIED", correlationId: CORRELATION_ID }); } };
    const document = await repository.get(tenantId, id);
    if (!document) return deny("DOCUMENT_NOT_FOUND", "Bill document not found", 404);
    const now = new Date().toISOString();
    const operation = parseBillOperation(body);
    if (operation?.operation === "approve") {
      const approved = approveDocumentVersion({ document, tenantId, versionId: operation.versionId, at: now });
      await repository.save(approved);
      await audit.record({ type: "APPROVAL", tenantId, documentId: id, outcome: "ALLOWED" });
      return Response.json({ document: await attachOfficialPun(toPublicDocument(approved), repositories.marketArchiveRepository) }, { headers: NO_STORE_HEADERS });
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
      await repository.save(corrected);
      await audit.record({ type: "MANUAL_REVIEW", tenantId, documentId: id, outcome: "ALLOWED" });
      await audit.record({ type: "CORRECTION", tenantId, documentId: id, outcome: "ALLOWED" });
      return Response.json({ document: await attachOfficialPun(toPublicDocument(corrected), repositories.marketArchiveRepository) }, { headers: NO_STORE_HEADERS });
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
    const document = await repositories.billRepository.get(principal.tenantId, id);
    if (!document) return Response.json({ deleted: true }, { headers: NO_STORE_HEADERS });
    if (document.currentApprovedVersionId !== null) return deny("BILL_APPROVED_DELETE_FORBIDDEN", "Approved bills cannot be deleted", 409);
    if (typeof repositories.billRepository.delete !== "function") return deny("BILL_DELETE_UNAVAILABLE", "Bill deletion is not available", 503);
    await repositories.documentStorage.remove(document.objectKey);
    await repositories.billRepository.delete(principal.tenantId, id);
    await recordRuntimeAudit({ principal, action: "BILL_DELETE", resourceType: "BILL", resourceId: id, outcome: "ALLOWED", correlationId: CORRELATION_ID });
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
  METADATA_INVALID: "METADATA_INVALID",
  CORRECTION_INVALID: "CORRECTION_INVALID",
  TENANT_ACCESS_DENIED: "TENANT_ACCESS_DENIED",
  BILL_OPERATION_INVALID: "BILL_OPERATION_INVALID",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  BILL_APPROVED_DELETE_FORBIDDEN: "BILL_APPROVED_DELETE_FORBIDDEN",
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
  if (["DOCUMENT_NOT_FOUND"].includes(code)) return 404;
  if (["BILL_APPROVED_DELETE_FORBIDDEN"].includes(code)) return 409;
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
    default:
      return "Bill operation failed";
  }
}
