import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";

const tenant = "tenant_alpha";
const bytes = new Uint8Array(Buffer.from("%PDF-1.7\nempty-store-test\n%%EOF", "latin1"));
const audit = { async record() {} };
const extractor = { async extract() { return { text: "Supplier: Test; POD: IT001E12345678; Customer: Demo; Periodo: 2026-07-01 - 2026-07-31; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20", pages: 1 }; } };

const root = await mkdtemp(path.join(tmpdir(), "bill-empty-store-"));
const repository = new LocalBillRepository(root);
const storage = new LocalDocumentStorage(root);
try {
  await writeFile(path.join(root, "metadata.json"), Buffer.from("\uFEFF{\"schemaVersion\":1,\"documents\":[]}", "utf8"));
  assert.deepEqual(await repository.list(tenant), []);

  const first = await ingestBill({ tenantId: tenant, fileName: "first.pdf", contentType: "application/pdf", bytes, maxBytes: 1_000_000, storage, extractor, repository, audit });
  assert.equal((await repository.list(tenant)).length, 1);
  assert.deepEqual((await repository.list("tenant_empty")), []);

  const unrelated = path.join(root, "non-bill-sentinel.json");
  await writeFile(unrelated, "non-bill-data", "utf8");
  await repository.delete(tenant, first.id);
  await storage.remove(first.objectKey);
  assert.deepEqual(await repository.list(tenant), []);
  assert.equal(await readFile(unrelated, "utf8"), "non-bill-data");

  const legacy = {
    id: "legacy-bill", tenantId: tenant, fileName: "legacy.pdf", objectKey: path.join(root, "tenant_alpha", "legacy-bill.pdf"), size: 1,
    status: "REVIEW_REQUIRED", fields: { supplier: { value: "Test", confidence: 0.5, source: "embedded-text", confirmed: false }, pod: { value: "IT001E12345678", confidence: 0.5, source: "embedded-text", confirmed: false }, customerName: { value: null, confidence: 0, source: "unavailable", confirmed: false }, billingPeriod: { value: null, confidence: 0, source: "unavailable", confirmed: false }, annualConsumption: { value: null, confidence: 0, source: "unavailable", confirmed: false }, billedConsumption: { value: null, confidence: 0, source: "unavailable", confirmed: false }, totalAmount: { value: null, confidence: 0, source: "unavailable", confirmed: false } },
    createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
  };
  await writeFile(path.join(root, "metadata.json"), JSON.stringify([legacy], null, 2), "utf8");
  assert.equal((await repository.list(tenant)).length, 1);
  assert.equal((await repository.list(tenant))[0].id, "legacy-bill");
  console.log("bill empty store smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
