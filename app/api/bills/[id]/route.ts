import {
  approveDocumentVersion,
  createManualCorrection,
  parseBillOperation,
  toPublicDocument,
} from "../../../lib/foundation/real-bill";
import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";

const CORRELATION_ID = "foundation-bills";
function deny(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message, correlationId: CORRELATION_ID } }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const tenantId = (await requestPrincipal(request, "READ")).tenantId;
    const document = await runtimeRepositories().billRepository.get(tenantId, id);
    return document ? Response.json({ document: toPublicDocument(document) }) : deny("DOCUMENT_NOT_FOUND", "Bill document not found", 404);
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILL_OPERATION_FAILED";
    return deny(code, messageFor(code), code === "METADATA_INVALID" ? 409 : 400);
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
    const repository = runtimeRepositories().billRepository;
    const audit = { async record(event: { readonly type: string; readonly tenantId: string; readonly documentId: string; readonly outcome: string }) { await recordRuntimeAudit({ principal, action: `BILL_${event.type}`, resourceType: "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "DENIED", correlationId: CORRELATION_ID }); } };
    const document = await repository.get(tenantId, id);
    if (!document) return deny("DOCUMENT_NOT_FOUND", "Bill document not found", 404);
    const now = new Date().toISOString();
    const operation = parseBillOperation(body);
    if (operation?.operation === "approve") {
      const approved = approveDocumentVersion({ document, tenantId, versionId: operation.versionId, at: now });
      await repository.save(approved);
      await audit.record({ type: "APPROVAL", tenantId, documentId: id, outcome: "ALLOWED" });
      return Response.json({ document: toPublicDocument(approved) });
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
      return Response.json({ document: toPublicDocument(corrected) });
    }
    return deny("BILL_OPERATION_INVALID", "Unsupported bill operation", 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILL_OPERATION_FAILED";
    const status = code === "TENANT_ACCESS_DENIED" ? 403
      : code === "DOCUMENT_VERSION_NOT_CURRENT" || code === "DOCUMENT_VERSION_STALE" || code === "DOCUMENT_VERSION_ALREADY_APPROVED" || code === "DOCUMENT_NO_CHANGES" ? 409
      : code === "METADATA_INVALID" ? 409
      : code === "APPROVAL_REQUIRED_FIELDS_MISSING" || code === "APPROVAL_FIELDS_UNCONFIRMED" || code === "CORRECTION_INVALID" || code === "DOCUMENT_VERSION_NOT_FOUND" ? 400
      : 400;
    return deny(code, messageFor(code), status);
  }
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
    default:
      return "Bill operation failed";
  }
}
