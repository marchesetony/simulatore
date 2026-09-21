import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approveDocumentVersion, createManualCorrection, ingestBill, LocalBillRepository, LocalDocumentStorage, transitionBillLifecycle } from "../app/lib/foundation/real-bill.ts";
import { runBillRetention } from "../app/lib/foundation/bill-retention.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "bill-retention-smoke-"));
const tenant = "tenant_bill-retention";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill retention", "latin1"));
const events = [];
const audit = { async record(event) { events.push(event); } };
const seed = async (repository, storage, at = "2026-10-01T00:00:00.000Z") => {
  let document = await ingestBill({ tenantId: tenant, fileName: "retention.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, extractor: { async extract() { return { text: "Supplier: Aurora; POD: IT001E12345678; Customer: Cliente; Periodo: 01/01/2025 - 31/01/2025; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20", pages: 1 }; } } });
  for (const [field, item] of Object.entries(document.versions.at(-1).fields)) document = createManualCorrection({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, field, value: `${item.value} verified`, at });
  document = approveDocumentVersion({ document, tenantId: tenant, versionId: document.currentVersionId, at, actorId: "reviewer" });
  return transitionBillLifecycle({ document, tenantId: tenant, expectedLifecycleVersion: 1, toState: "ARCHIVED", at, actorId: "reviewer", reason: "RETENTION_START" });
};

try {
  const repository = new LocalBillRepository(root);
  const storage = new LocalDocumentStorage(root);
  const archived = await seed(repository, storage);
  await repository.save(archived);
  const first = await runBillRetention({ tenantId: tenant, repositories: { bills: repository, storage, audit }, now: "2028-01-01T00:00:00.000Z" });
  assert.equal(first.scheduled, 1);
  assert.equal(first.deleted, 1);
  assert.equal((await repository.get(tenant, archived.id)).lifecycleState, "DELETED");
  await assert.rejects(() => storage.read(tenant, archived.id));
  const eventCount = events.length;
  const second = await runBillRetention({ tenantId: tenant, repositories: { bills: repository, storage, audit }, now: "2028-01-01T00:00:00.000Z" });
  assert.equal(second.deleted, 0);
  assert.equal(events.length, eventCount);

  const failingStorage = { ...storage, async remove() { throw new Error("STORAGE_DELETE_FAILED"); } };
  const failure = await seed(repository, storage, "2026-10-02T00:00:00.000Z");
  await repository.save(failure);
  const failed = await runBillRetention({ tenantId: tenant, repositories: { bills: repository, storage: failingStorage, audit }, now: "2028-01-02T00:00:00.000Z" });
  assert.equal(failed.failed, 1);
  assert.equal((await repository.get(tenant, failure.id)).lifecycleState, "SCHEDULED_DELETION");
  assert.equal((await storage.read(tenant, failure.id)).length > 0, true);
  const other = await runBillRetention({ tenantId: "tenant_other", repositories: { bills: repository, storage, audit }, now: "2028-01-02T00:00:00.000Z" });
  assert.equal(other.scanned, 0);
  console.log("bill-retention.smoke: PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
