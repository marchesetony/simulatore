import { NextResponse } from "next/server";
import { EmbeddedPdfTextExtractor, ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "@/app/lib/foundation/real-bill";

const audit = { async record(event: { readonly type: string; readonly tenantId: string; readonly documentId: string; readonly outcome: string }) { console.info("foundation-audit", { ...event }); } };
export async function POST(request: Request): Promise<Response> {
  const tenantId = request.headers.get("x-foundation-tenant-id");
  if (!tenantId || process.env.FOUNDATION_LOCAL_DEV !== "true") return NextResponse.json({ error: "TENANT_ACCESS_DENIED" }, { status: 403 });
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "PDF_REQUIRED" }, { status: 400 });
  try { const document = await ingestBill({ tenantId, fileName: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), maxBytes: Number(process.env.FOUNDATION_MAX_PDF_BYTES ?? 10_000_000), storage: new LocalDocumentStorage(), extractor: new EmbeddedPdfTextExtractor(), repository: new LocalBillRepository(), audit }); return NextResponse.json({ document: toPublicDocument(document) }, { status: 201 }); } catch (error) { const code = error instanceof Error ? error.message : "INGESTION_FAILED"; return NextResponse.json({ error: code }, { status: 400 }); }
}
