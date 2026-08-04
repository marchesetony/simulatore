import { toPublicDocument } from "../../lib/foundation/real-bill";
import { ingestEnergyBill } from "../../lib/ingestion";
import { requestPrincipal } from "../../lib/auth/request";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";
import { AuthenticationError } from "../../lib/auth/errors";

const CORRELATION_ID = "foundation-bills";
const LIST_CORRELATION_ID = "foundation-bill-list";
const MAX_BILL_LIST_RESULTS = 100;
const noStoreHeaders = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const INTERNAL_TO_PUBLIC_CODE: Readonly<Record<string, string>> = {
  AUTH_CONFIGURATION_INVALID: "AUTH_CONFIGURATION_INVALID",
  AUTH_ADAPTER_UNAVAILABLE: "AUTH_ADAPTER_UNAVAILABLE",
  AUTH_AUDIT_UNAVAILABLE: "AUTH_AUDIT_UNAVAILABLE",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  AUTHENTICATION_EXPIRED: "AUTHENTICATION_EXPIRED",
  AUTHENTICATION_INVALID: "AUTHENTICATION_INVALID",
  AUTHORIZATION_DENIED: "AUTHORIZATION_DENIED",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  ROLE_INSUFFICIENT: "ROLE_INSUFFICIENT",
  BILL_LIST_TOO_LARGE: "BILL_LIST_TOO_LARGE",
  METADATA_INVALID: "METADATA_INVALID",
  BILL_VECTOR_UNKNOWN: "BILL_VECTOR_UNKNOWN",
  OCR_PROVIDER_REQUIRED: "OCR_PROVIDER_REQUIRED",
  PDF_REQUIRED: "PDF_REQUIRED",
  PDF_MIME_INVALID: "PDF_MIME_INVALID",
  PDF_SIGNATURE_INVALID: "PDF_SIGNATURE_INVALID",
  PDF_TOO_LARGE: "PDF_TOO_LARGE",
  EXTRACTION_REQUIRED_FIELD_MISSING: "EXTRACTION_REQUIRED_FIELD_MISSING",
  EXTRACTION_VALUE_INVALID: "EXTRACTION_VALUE_INVALID",
  TENANT_ACCESS_DENIED: "TENANT_ACCESS_DENIED",
  BILL_LIST_UNAVAILABLE: "BILL_LIST_UNAVAILABLE",
  INGESTION_FAILED: "INGESTION_FAILED",
  BILL_OPERATION_FAILED: "BILL_OPERATION_FAILED",
};

function boundedPublicCode(internalCode: unknown, fallback: string): string {
  return typeof internalCode === "string" && Object.prototype.hasOwnProperty.call(INTERNAL_TO_PUBLIC_CODE, internalCode) ? INTERNAL_TO_PUBLIC_CODE[internalCode] : fallback;
}

function publicCode(error: unknown, fallback: string): string {
  const internalCode = error instanceof AuthenticationError ? error.code : error instanceof Error ? error.message : null;
  return boundedPublicCode(internalCode, fallback);
}

function publicStatus(code: string): number {
  if (["AUTH_CONFIGURATION_INVALID", "AUTH_ADAPTER_UNAVAILABLE", "AUTH_AUDIT_UNAVAILABLE", "BILL_LIST_TOO_LARGE", "METADATA_INVALID"].includes(code)) return 503;
  if (["AUTHENTICATION_REQUIRED", "AUTHENTICATION_EXPIRED", "AUTHENTICATION_INVALID"].includes(code)) return 401;
  if (["AUTHORIZATION_DENIED", "TENANT_MISMATCH", "ROLE_INSUFFICIENT", "TENANT_ACCESS_DENIED"].includes(code)) return 403;
  if (code === "OCR_PROVIDER_REQUIRED") return 422;
  return 400;
}

function deny(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message, correlationId: CORRELATION_ID } }, { status, headers: noStoreHeaders });
}

function listError(error: unknown): Response {
  const code = publicCode(error, "BILL_LIST_UNAVAILABLE");
  return Response.json({ error: { code, message: "Elenco bollette non disponibile", correlationId: LIST_CORRELATION_ID } }, { status: publicStatus(code), headers: noStoreHeaders });
}

export async function GET(request: Request): Promise<Response> {
  void request;
  try {
    const principal = await requestPrincipal(request, "READ");
    const documents = await runtimeRepositories().billRepository.list(principal.tenantId);
    if (documents.length > MAX_BILL_LIST_RESULTS) throw new Error("BILL_LIST_TOO_LARGE");
    const publicDocuments = documents
      .map(toPublicDocument)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return Response.json({ documents: publicDocuments }, { headers: noStoreHeaders });
  } catch (error) {
    return listError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const audit = { async record(event: { readonly type: string; readonly tenantId: string; readonly documentId: string; readonly outcome: string }) { await recordRuntimeAudit({ principal, action: `BILL_${event.type}`, resourceType: "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "DENIED", correlationId: CORRELATION_ID }); } };
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return deny("PDF_REQUIRED", "A PDF file is required", 400);
    const result = await ingestEnergyBill({
      tenantId,
      fileName: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      maxBytes: Number(process.env.FOUNDATION_MAX_PDF_BYTES ?? 10_000_000),
      storage: repositories.documentStorage,
      repository: repositories.billRepository,
      authenticated: true,
      localDev: process.env.FOUNDATION_LOCAL_DEV,
      audit,
    });
    if (result.errorCode) {
      const code = boundedPublicCode(result.errorCode, "BILL_OPERATION_FAILED");
      return deny(code, messageFor(code), publicStatus(code));
    }
    return Response.json({ document: toPublicDocument(result.document), energyBill: result.contract }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    const code = publicCode(error, "INGESTION_FAILED");
    return deny(code, messageFor(code), publicStatus(code));
  }
}

function messageFor(code: string): string {
  switch (code) {
    case "BILL_VECTOR_UNKNOWN": return "Bill vector could not be classified";
    case "OCR_PROVIDER_REQUIRED": return "OCR provider is required for this PDF";
    case "PDF_MIME_INVALID": return "PDF media type is invalid";
    case "PDF_SIGNATURE_INVALID": return "PDF signature is invalid";
    case "PDF_TOO_LARGE": return "PDF exceeds the configured size limit";
    case "EXTRACTION_REQUIRED_FIELD_MISSING": return "Required bill data is missing";
    case "EXTRACTION_VALUE_INVALID": return "Bill data could not be validated";
    case "TENANT_ACCESS_DENIED": return "Tenant access denied";
    default: return "Bill ingestion failed";
  }
}
