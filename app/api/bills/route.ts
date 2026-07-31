import { assertLocalBillAccess, toPublicDocument } from "../../lib/foundation/real-bill";
import { ingestEnergyBill } from "../../lib/ingestion";

const CORRELATION_ID = "foundation-bills";
const DOCUMENTS_ROOT = process.env.FOUNDATION_DOCUMENTS_ROOT;
const audit = {
  async record(event: { readonly type: string; readonly tenantId: string; readonly documentId: string; readonly outcome: string }) {
    console.info("foundation-audit", { ...event });
  },
};

function deny(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message, correlationId: CORRELATION_ID } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let tenantId: string;
  try {
    tenantId = assertLocalBillAccess(request.headers.get("x-foundation-tenant-id"), process.env.FOUNDATION_LOCAL_DEV);
  } catch {
    return deny("TENANT_ACCESS_DENIED", "Local bill ingestion is disabled", 403);
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return deny("PDF_REQUIRED", "A PDF file is required", 400);
    const result = await ingestEnergyBill({
      tenantId,
      fileName: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      maxBytes: Number(process.env.FOUNDATION_MAX_PDF_BYTES ?? 10_000_000),
      documentsRoot: DOCUMENTS_ROOT,
      localDev: process.env.FOUNDATION_LOCAL_DEV,
      audit,
    });
    if (result.errorCode) {
      const status = result.errorCode === "OCR_PROVIDER_REQUIRED" ? 422 : 400;
      return deny(result.errorCode, messageFor(result.errorCode), status);
    }
    return Response.json({ document: toPublicDocument(result.document), energyBill: result.contract }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INGESTION_FAILED";
    return deny(code, messageFor(code), code === "TENANT_ACCESS_DENIED" ? 403 : 400);
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
