import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  approvalValidation,
  approveDocumentVersion,
  confirmBillFields,
  ingestBill,
  LocalBillRepository,
  LocalDocumentStorage,
  parseBillOperation,
  requiredFieldNames,
} from "../app/lib/foundation/real-bill.ts";

const tenant = "tenant_confirmation-test";
const root = await mkdtemp(path.join(os.tmpdir(), "simulatore-bill-confirmation-"));
try {
  const route = await readFile(new URL("../app/api/bills/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /requestPrincipal\(request, "WRITE"\)/);
  assert.match(route, /operation === "confirm-fields"/);
  assert.match(route, /confirmBillFields/);
  assert.match(route, /BILL_FIELD_CONFIRMATION/);
  assert.doesNotMatch(route, /tenantId: body|approved: body|status: body/);
  const legacyReview = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(legacyReview, /operation: 'confirm-fields'/);
  assert.match(legacyReview, /unchanged/);
  const operationalPanel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
  assert.match(operationalPanel, /operation: "confirm-fields"/);
  const repository = new LocalBillRepository(root);
  const document = await ingestBill({
    tenantId: tenant,
    fileName: "synthetic-bill.pdf",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("%PDF-synthetic"),
    maxBytes: 1000,
    storage: new LocalDocumentStorage(root),
    extractor: { async extract() { return { pages: 1, text: "Fornitore: Aurora S.p.A.\nPOD: IT001E00000000\nCliente: Mario Rossi\nPeriodo: 2026-07-01 - 2026-08-31\nConsumo annuo: 1779,70 kWh\nConsumo fatturato: 477,32 kWh\nTotale da pagare: 120,00" }; } },
    repository,
    audit: { async record() {} },
  });

  assert.deepEqual(approvalValidation(document, document.currentVersionId).missingFields, []);
  assert.equal(approvalValidation(document, document.currentVersionId).unconfirmedFields.length, requiredFieldNames.length);
  assert.deepEqual(parseBillOperation({ operation: "confirm-fields", versionId: document.currentVersionId, fields: ["pod", "billingPeriod"] }), { operation: "confirm-fields", versionId: document.currentVersionId, fields: ["pod", "billingPeriod"] });
  assert.equal(parseBillOperation({ operation: "confirm-fields", versionId: document.currentVersionId, fields: ["pod"], tenantId: tenant }), null);
  assert.equal(parseBillOperation({ operation: "confirm-fields", versionId: document.currentVersionId, fields: ["pod"], value: "forbidden" }), null);
  assert.equal(parseBillOperation({ operation: "confirm-fields", versionId: document.currentVersionId, fields: ["unknown"] }), null);

  const confirmedOne = confirmBillFields({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: ["pod"], at: "2026-09-11T12:00:00.000Z" });
  assert.equal(confirmedOne.currentVersionId, document.currentVersionId);
  assert.equal(confirmedOne.versions[0].fields.pod.confirmed, true);
  assert.equal(confirmedOne.versions[0].fields.pod.value, document.versions[0].fields.pod.value);
  assert.equal(confirmedOne.versions[0].fields.pod.confidence, document.versions[0].fields.pod.confidence);
  assert.equal(approvalValidation(confirmedOne, confirmedOne.currentVersionId).unconfirmedFields.length, requiredFieldNames.length - 1);
  const concurrentA = confirmBillFields({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: ["pod"], at: "2026-09-11T12:00:00.000Z" });
  const concurrentB = confirmBillFields({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: ["supplier"], at: "2026-09-11T12:00:00.000Z" });
  await repository.saveIfCurrentVersion(concurrentA, document.currentVersionId, document.versions[0]);
  await assert.rejects(() => repository.saveIfCurrentVersion(concurrentB, document.currentVersionId, document.versions[0]), /DOCUMENT_VERSION_STALE/);

  const unavailable = { ...document, versions: document.versions.map((version) => ({ ...version, fields: { ...version.fields, pod: { value: null, confidence: 0, source: "unavailable", confirmed: false } } })) };
  assert.throws(() => confirmBillFields({ document: unavailable, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: ["pod"], at: "2026-09-11T12:00:00.000Z" }), /FIELD_CONFIRMATION_INVALID/);
  for (const sentinel of ["UNKNOWN", "NOT_FOUND", "Non disponibile"]) {
    const sentinelDocument = { ...document, versions: document.versions.map((version) => ({ ...version, fields: { ...version.fields, pod: { ...version.fields.pod, value: sentinel } } })) };
    assert.throws(() => confirmBillFields({ document: sentinelDocument, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: ["pod"], at: "2026-09-11T12:00:00.000Z" }), /FIELD_CONFIRMATION_INVALID/);
  }
  assert.throws(() => confirmBillFields({ document, tenantId: tenant, sourceVersionId: "wrong-version", fields: ["pod"], at: "2026-09-11T12:00:00.000Z" }), /DOCUMENT_VERSION_STALE/);
  assert.throws(() => confirmBillFields({ document, tenantId: "tenant_other", sourceVersionId: document.currentVersionId, fields: ["pod"], at: "2026-09-11T12:00:00.000Z" }), /TENANT_ACCESS_DENIED/);
  assert.throws(() => confirmBillFields({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: ["not-a-field"], at: "2026-09-11T12:00:00.000Z" }), /FIELD_CONFIRMATION_INVALID/);

  const fullyConfirmed = confirmBillFields({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: requiredFieldNames, at: "2026-09-11T12:00:00.000Z" });
  assert.deepEqual(approvalValidation(fullyConfirmed, fullyConfirmed.currentVersionId), { missingFields: [], unconfirmedFields: [] });
  const approved = approveDocumentVersion({ document: fullyConfirmed, tenantId: tenant, versionId: fullyConfirmed.currentVersionId, at: "2026-09-11T12:01:00.000Z" });
  assert.equal(approved.currentApprovedVersionId, approved.currentVersionId);
  assert.throws(() => confirmBillFields({ document: approved, tenantId: tenant, sourceVersionId: approved.currentVersionId, fields: ["pod"], at: "2026-09-11T12:02:00.000Z" }), /DOCUMENT_VERSION_ALREADY_APPROVED/);
  await repository.save(approved);
  const readback = await repository.get(tenant, document.id);
  assert.equal(readback?.currentApprovedVersionId, readback?.currentVersionId);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("bill-field-confirmation smoke: ok");
