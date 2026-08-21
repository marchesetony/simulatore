import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { retryEnergyBill } from "../app/lib/ingestion/service.ts";
import { billOcrPublicError, billPublicError } from "../app/lib/ingestion/errors.ts";
import { requestJson } from "../app/lib/ui/client.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "bill-post-ocr-diagnostics-"));
const tenant = "tenant_post-ocr-diagnostics";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 fixture", "latin1"));
const audit = { async record() {} };
const repository = new LocalBillRepository(root);
const storage = new LocalDocumentStorage(root);

async function seedFailed() {
  return ingestBill({
    tenantId: tenant,
    fileName: "offline.pdf",
    contentType: "application/pdf",
    bytes: pdf,
    maxBytes: 100_000,
    storage,
    repository,
    audit,
    extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } },
  });
}

async function retryWith(text, provider = { async extract() { return { text, pages: 1 }; } }) {
  const document = await seedFailed();
  return retryEnergyBill({ tenantId: tenant, document, storage, repository, authenticated: true, ocrProvider: provider, audit });
}

const unknown = await retryWith("energia elettrica e gas");
const unknownVersion = unknown.document.versions.at(-1);
assert.equal(unknown.status, "FAILED");
assert.equal(unknown.errorCode, "BILL_VECTOR_UNKNOWN");
assert.equal(unknownVersion.errorCode, "BILL_VECTOR_UNKNOWN");
assert.equal(billPublicError(unknownVersion.errorCode).status, 422);

const required = await retryWith("POD: IT123E12345678; kWh: 10");
assert.equal(required.status, "FAILED");
assert.equal(required.errorCode, "BILL_EXTRACTION_REQUIRED_FIELD_MISSING");
assert.equal(required.document.versions.at(-1).errorCode, required.errorCode);

const fullEe = "POD: IT123E12345678; Voltage Level: LV; F1: 100; F2: 50; F3: 25; Customer ID: C-EE-1; Customer: Cliente EE; Customer Type: business; VAT Number: IT12345678901; Supply ID: S-EE-1; Meter ID: M-EE-1; Billing Period: 2026-01-01 - 2026-02-01; Supplier: Fornitore EE; Offer Name: Offerta EE; Consumption Basis: measured; Consumo annuo: 2000; Consumo fatturato: 176; Totale da pagare: 80";
const validation = await retryWith(fullEe);
assert.equal(validation.status, "FAILED");
assert.equal(validation.errorCode, "BILL_CONTRACT_VALIDATION_FAILED");
assert.equal(validation.document.versions.at(-1).errorCode, validation.errorCode);

const success = await retryWith(fullEe.replace("Consumo fatturato: 176", "Consumo fatturato: 175"));
assert.equal(success.status, "EXTRACTED");
assert.equal(success.errorCode, null);
assert.equal(success.document.versions.at(-1).energyContract.vector, "EE");

const ocrFailure = await retryWith("ignored", { async extract() { throw new Error("BILL_OCR_NETWORK_ERROR"); } });
assert.equal(ocrFailure.status, "FAILED");
assert.equal(ocrFailure.errorCode, "BILL_OCR_NETWORK_ERROR");
assert.equal(ocrFailure.document.versions.at(-1).errorCode, ocrFailure.errorCode);
assert.equal(billOcrPublicError(ocrFailure.errorCode).code, ocrFailure.errorCode);

const retryRoute = await readFile(new URL("../app/api/bills/[id]/retry/route.ts", import.meta.url), "utf8");
const uploadRoute = await readFile(new URL("../app/api/bills/route.ts", import.meta.url), "utf8");
assert.match(retryRoute, /result\.status === "FAILED"/);
assert.match(retryRoute, /status: publicError\.status/);
assert.match(retryRoute, /document: await attachOfficialPun\(toPublicDocument\(result\.document\)/);
assert.match(uploadRoute, /errorCode: code/);
assert.match(uploadRoute, /status: result\.status/);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "BILL_VECTOR_UNKNOWN", message: "bounded" } }), { status: 422, headers: { "content-type": "application/json" } });
try {
  await assert.rejects(() => requestJson("/offline-bill"), (error) => error.code === "BILL_VECTOR_UNKNOWN");
} finally {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
}

console.log("bill post-OCR diagnostics smoke: ok (bounded codes, persisted failures, 422 route semantics, UI coherence and OCR regression)");
