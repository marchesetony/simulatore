import { toPublicBillSummary, toPublicDocument } from "../../lib/foundation/real-bill";
import { billErrorHttpStatus, billErrorUserMessage, billOcrHttpStatus, billOcrUserMessage, ingestEnergyBill } from "../../lib/ingestion";
import { requestPrincipal } from "../../lib/auth/request";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";
import { AuthenticationError } from "../../lib/auth/errors";
import { createAnthropicTwoStageBillSdkAdapter } from "../../lib/ingestion/anthropic-bill-sdk";
// createAnthropicBillSdkAdapter remains the legacy compatibility adapter; Bill routes use two-stage.
import { attachOfficialPun } from "../../lib/market/pun-reference";

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
  BILL_EXTRACTION_REQUIRED_FIELD_MISSING: "BILL_EXTRACTION_REQUIRED_FIELD_MISSING",
  BILL_EXTRACTION_VALUE_INVALID: "BILL_EXTRACTION_VALUE_INVALID",
  BILL_CONTRACT_VALIDATION_FAILED: "BILL_CONTRACT_VALIDATION_FAILED",
  BILL_METADATA_INVALID: "BILL_METADATA_INVALID",
  BILL_MAPPING_FAILED: "BILL_MAPPING_FAILED",
  BILL_RETRY_FAILED: "BILL_RETRY_FAILED",
  OCR_PROVIDER_REQUIRED: "OCR_PROVIDER_REQUIRED",
  BILL_OCR_PROVIDER_NOT_CONFIGURED: "BILL_OCR_PROVIDER_NOT_CONFIGURED",
  BILL_OCR_PROVIDER_CONFIGURATION_INVALID: "BILL_OCR_PROVIDER_CONFIGURATION_INVALID",
  BILL_OCR_PROVIDER_AUTH_FAILED: "BILL_OCR_PROVIDER_AUTH_FAILED",
  BILL_OCR_REQUEST_INVALID: "BILL_OCR_REQUEST_INVALID",
  BILL_OCR_BILLING_ERROR: "BILL_OCR_BILLING_ERROR",
  BILL_OCR_NOT_FOUND: "BILL_OCR_NOT_FOUND",
  BILL_OCR_REQUEST_TOO_LARGE: "BILL_OCR_REQUEST_TOO_LARGE",
  BILL_OCR_PROVIDER_RATE_LIMITED: "BILL_OCR_PROVIDER_RATE_LIMITED",
  BILL_OCR_PROVIDER_UNAVAILABLE: "BILL_OCR_PROVIDER_UNAVAILABLE",
  BILL_OCR_NETWORK_ERROR: "BILL_OCR_NETWORK_ERROR",
  BILL_OCR_PROVIDER_TIMEOUT: "BILL_OCR_PROVIDER_TIMEOUT",
  BILL_OCR_OUTPUT_TRUNCATED: "BILL_OCR_OUTPUT_TRUNCATED",
  BILL_OCR_PROVIDER_REFUSAL: "BILL_OCR_PROVIDER_REFUSAL",
  BILL_OCR_RESPONSE_INVALID: "BILL_OCR_RESPONSE_INVALID",
  BILL_OCR_PROVIDER_FAILED: "BILL_OCR_PROVIDER_FAILED",
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
  if (code.startsWith("BILL_OCR_")) return billOcrHttpStatus(code);
  if (["BILL_VECTOR_UNKNOWN", "BILL_EXTRACTION_REQUIRED_FIELD_MISSING", "BILL_EXTRACTION_VALUE_INVALID", "BILL_CONTRACT_VALIDATION_FAILED", "BILL_METADATA_INVALID", "BILL_MAPPING_FAILED", "BILL_RETRY_FAILED"].includes(code)) return billErrorHttpStatus(code);
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
  try {
    const principal = await requestPrincipal(request, "READ");
    const documents = await runtimeRepositories().billRepository.list(principal.tenantId);
    if (documents.length > MAX_BILL_LIST_RESULTS) throw new Error("BILL_LIST_TOO_LARGE");
    const approvedView = new URL(request.url).searchParams.get("view") === "approved";
    const publicDocuments = (approvedView ? documents.filter((document) => document.currentApprovedVersionId !== null).map(toPublicBillSummary).filter((document): document is NonNullable<typeof document> => document !== null) : documents.filter((document) => document.currentApprovedVersionId === null).map(toPublicDocument))
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
      structuredProviderFactory: () => createAnthropicTwoStageBillSdkAdapter(),
    });
    if (result.errorCode) {
      const code = boundedPublicCode(result.errorCode, "BILL_OPERATION_FAILED");
      return Response.json({ error: { code, message: messageFor(code), correlationId: CORRELATION_ID }, document: await attachOfficialPun(toPublicDocument(result.document), repositories.marketArchiveRepository), status: result.status, errorCode: code }, { status: publicStatus(code), headers: noStoreHeaders });
    }
    return Response.json({ document: await attachOfficialPun(toPublicDocument(result.document), repositories.marketArchiveRepository), energyBill: result.contract }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    const code = publicCode(error, "INGESTION_FAILED");
    return deny(code, messageFor(code), publicStatus(code));
  }
}

function messageFor(code: string): string {
  if (code.startsWith("BILL_OCR_")) return billOcrUserMessage(code);
  switch (code) {
    case "BILL_VECTOR_UNKNOWN":
    case "BILL_EXTRACTION_REQUIRED_FIELD_MISSING":
    case "BILL_EXTRACTION_VALUE_INVALID":
    case "BILL_CONTRACT_VALIDATION_FAILED":
    case "BILL_METADATA_INVALID":
    case "BILL_MAPPING_FAILED":
    case "BILL_RETRY_FAILED": return billErrorUserMessage(code);
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
