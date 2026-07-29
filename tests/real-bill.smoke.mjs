import assert from "node:assert/strict";
import { documentStatus, extractBillFields, ingestBill, toPublicDocument, validatePdf } from "../app/lib/foundation/real-bill.ts";

const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n(Supplier: Aurora) Tj (POD: IT001) Tj\n%%EOF", "latin1"));
const repo = () => ({ value: undefined, async save(document) { this.value = document; }, async get(tenantId, id) { return this.value?.tenantId === tenantId && this.value.id === id ? this.value : null; } });
const storage = { async store(tenant, id) { return `private/${tenant}/${id}.pdf`; }, async read() { return pdf; } };
const audit = { async record() {} };

assert.equal(validatePdf("bill.pdf", "application/pdf", pdf, 1000), "bill.pdf");
assert.throws(() => validatePdf("bill.txt", "text/plain", pdf, 1000), /PDF_MIME_INVALID/);
assert.throws(() => validatePdf("bill.pdf", "application/pdf", pdf, 2), /PDF_TOO_LARGE/);
assert.throws(() => validatePdf("../bill.pdf", "application/pdf", pdf, 1000), /PDF_FILENAME_INVALID/);
const repository = repo();
const document = await ingestBill({ tenantId: "tenant_alpha", fileName: "bill.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 1000, storage, extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } }, repository, audit });
assert.equal(document.status, "OCR_PROVIDER_REQUIRED");
assert.equal("objectKey" in toPublicDocument(document), false);
assert.equal(await repository.get("tenant_beta", document.id), null);
const missing = extractBillFields("Supplier: Aurora");
assert.equal(missing.pod.value, null);
assert.equal(documentStatus(missing), "REVIEW_REQUIRED");
const complete = extractBillFields("Supplier: A; POD: IT001; Customer: C; Periodo: Jan; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20");
assert.equal(documentStatus(complete), "EXTRACTED");
console.log("real-bill smoke tests passed");
