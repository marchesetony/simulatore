import { assertLocalBillAccess, EmbeddedPdfTextExtractor, ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../../lib/foundation/real-bill";

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

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return deny("PDF_REQUIRED", "A PDF file is required", 400);

  try {
    const document = await ingestBill({
      tenantId,
      fileName: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      maxBytes: Number(process.env.FOUNDATION_MAX_PDF_BYTES ?? 10_000_000),
      storage: new LocalDocumentStorage(DOCUMENTS_ROOT),
      extractor: new EmbeddedPdfTextExtractor(),
      repository: new LocalBillRepository(DOCUMENTS_ROOT),
      audit,
    });
    return Response.json({ document: toPublicDocument(document) }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INGESTION_FAILED";
    return deny(code, "Bill ingestion failed", 400);
  }
}
