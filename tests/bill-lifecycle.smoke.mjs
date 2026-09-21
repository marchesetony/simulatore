import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LocalBillRepository,
  LocalDocumentStorage,
  approveDocumentVersion,
  createManualCorrection,
  ingestBill,
  transitionBillLifecycle,
  validateStoredDocument,
} from "../app/lib/foundation/real-bill.ts";

const root = await mkdtemp(path.join(tmpdir(), "bill-lifecycle-smoke-"));
const tenant = "tenant_bill-lifecycle";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill lifecycle smoke", "latin1"));
const audit = { async record() {} };
const repository = new LocalBillRepository(root);
const storage = new LocalDocumentStorage(root);

try {
  const failed = await ingestBill({
    tenantId: tenant,
    fileName: "failed.pdf",
    contentType: "application/pdf",
    bytes: pdf,
    maxBytes: 100_000,
    storage,
    repository,
    audit,
    extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } },
  });
  assert.equal(failed.lifecycleState, "UPLOADED");
  assert.equal(failed.retention.retentionClass, "FISCAL_DOCUMENT");
  assert.equal(failed.lifecycleHistory.length, 1);
  const active = transitionBillLifecycle({ document: failed, tenantId: tenant, expectedLifecycleVersion: 1, toState: "ACTIVE", at: "2026-08-01T00:00:00.000Z", reason: "RETRY_READY" });
  assert.equal(active.lifecycleState, "ACTIVE");
  assert.throws(() => transitionBillLifecycle({ document: active, tenantId: tenant, expectedLifecycleVersion: 1, toState: "ARCHIVED", at: "2026-08-01T00:00:00.000Z", reason: "ARCHIVE" }), /BILL_LIFECYCLE_STALE|BILL_ARCHIVE_APPROVAL_REQUIRED/);

  let working = await ingestBill({
    tenantId: tenant,
    fileName: "bill.pdf",
    contentType: "application/pdf",
    bytes: pdf,
    maxBytes: 100_000,
    storage,
    repository,
    audit,
    extractor: { async extract() { return { text: "Supplier: Aurora; POD: IT001E12345678; Customer: Cliente; Periodo: 01/01/2026 - 31/01/2026; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20", pages: 1 }; } },
  });
  for (const [field, item] of Object.entries(working.versions.at(-1).fields)) {
    working = createManualCorrection({ document: working, tenantId: tenant, sourceVersionId: working.currentVersionId, field, value: `${item.value} verified`, at: "2026-08-01T00:01:00.000Z" });
  }
  const approved = approveDocumentVersion({ document: working, tenantId: tenant, versionId: working.currentVersionId, at: "2026-08-01T00:02:00.000Z", actorId: "reviewer-1" });
  assert.equal(approved.approvals[0].actorId, "reviewer-1");
  assert.equal(approved.approvals[0].auditEventId, approved.provenance.find((event) => event.type === "APPROVAL").auditEventId);

  const archived = transitionBillLifecycle({ document: approved, tenantId: tenant, expectedLifecycleVersion: 1, toState: "ARCHIVED", at: "2030-01-01T00:03:00.000Z", actorId: "reviewer-1", reason: "RETENTION_START" });
  assert.equal(archived.lifecycleState, "ARCHIVED");
  assert.equal(archived.retention.archivedAt, "2030-01-01T00:03:00.000Z");
  assert.equal(archived.retention.deletionDueAt, "2031-04-01T00:03:00.000Z");
  assert.throws(() => transitionBillLifecycle({ document: archived, tenantId: tenant, expectedLifecycleVersion: 2, toState: "SCHEDULED_DELETION", at: "2031-03-31T00:00:00.000Z", reason: "RETENTION_DUE" }), /BILL_RETENTION_NOT_DUE/);
  assert.throws(() => transitionBillLifecycle({ document: archived, tenantId: "tenant_other", expectedLifecycleVersion: 2, toState: "SCHEDULED_DELETION", at: "2031-04-01T00:03:00.000Z", reason: "RETENTION_DUE" }), /TENANT_ACCESS_DENIED/);
  const scheduled = transitionBillLifecycle({ document: archived, tenantId: tenant, expectedLifecycleVersion: 2, toState: "SCHEDULED_DELETION", at: "2031-04-01T00:03:00.000Z", reason: "RETENTION_DUE" });
  assert.equal(scheduled.lifecycleVersion, 3);
  const deleted = transitionBillLifecycle({ document: scheduled, tenantId: tenant, expectedLifecycleVersion: 3, toState: "DELETED", at: "2031-04-01T00:03:01.000Z", reason: "RETENTION_EXECUTED" });
  assert.equal(deleted.lifecycleState, "DELETED");
  assert.equal(deleted.retention.deletedAt, "2031-04-01T00:03:01.000Z");
  assert.throws(() => transitionBillLifecycle({ document: deleted, tenantId: tenant, expectedLifecycleVersion: 4, toState: "ACTIVE", at: "2026-10-01T00:00:00.000Z", reason: "RESTORE" }), /BILL_LIFECYCLE_TRANSITION_INVALID|BILL_LIFECYCLE_STALE/);

  const roundTrip = validateStoredDocument(JSON.parse(JSON.stringify(deleted)));
  assert.deepEqual(roundTrip.retention, deleted.retention);
  assert.deepEqual(roundTrip.lifecycleHistory, deleted.lifecycleHistory);
  await repository.save(deleted);
  const readback = await repository.get(tenant, deleted.id);
  assert.deepEqual(readback?.retention, deleted.retention);
  assert.deepEqual(readback?.lifecycleHistory, deleted.lifecycleHistory);
  console.log("bill lifecycle smoke: ok (formal states, approval audit linkage, retention due date, tenant/stale guards, persistence roundtrip)");
} finally {
  await rm(root, { recursive: true, force: true });
}
