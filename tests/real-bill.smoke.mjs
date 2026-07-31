import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LocalBillRepository,
  LocalDocumentStorage,
  assertLocalBillAccess,
  approveDocumentVersion,
  approvalValidation,
  createManualCorrection,
  documentStatus,
  extractBillFields,
  ingestBill,
  parseBillOperation,
  reviewStateFor,
  toPublicDocument,
  validatePdf,
} from "../app/lib/foundation/real-bill.ts";

const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n(Supplier: Aurora) Tj (POD: IT001) Tj\n%%EOF", "latin1"));
const fullText = "Supplier: Aurora; POD: IT001; Customer: Cliente Demo; Periodo: Jan 2027; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20";
const auditEvents = [];
const audit = { async record(event) { auditEvents.push(event); } };
const testBaseTime = Date.now();
const testTime = (offsetMs) => new Date(testBaseTime + offsetMs).toISOString();

function createExtractor(text = fullText) {
  return { async extract() { return { text, pages: 1 }; } };
}

async function createSandbox(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  return {
    root,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function fieldValues(document) {
  return Object.fromEntries(Object.entries(toPublicDocument(document).fields).map(([name, field]) => [name, field.value]));
}

function storedField(value, confirmed = true) {
  return { value, confidence: 1, source: "manual", confirmed };
}

function storedFields(overrides = {}) {
  return {
    supplier: storedField("Aurora"),
    pod: storedField("IT001"),
    customerName: storedField("Cliente Demo"),
    billingPeriod: storedField("Jan 2027"),
    annualConsumption: storedField("100"),
    billedConsumption: storedField("10"),
    totalAmount: storedField("20"),
    ...overrides,
  };
}

function storedVersion(overrides = {}) {
  return {
    versionId: "version-1",
    versionNumber: 1,
    supersedesVersionId: null,
    status: "EXTRACTED",
    fields: storedFields(),
    createdAt: "2026-07-30T00:00:00.000Z",
    origin: "INGESTION",
    ...overrides,
  };
}

function storedApproval(overrides = {}) {
  return {
    approvalId: "approval-1",
    tenantId: "tenant_alpha",
    documentId: "doc-1",
    versionId: "version-1",
    versionNumber: 1,
    approvedAt: "2026-07-30T00:00:10.000Z",
    origin: "LOCAL_APPROVAL",
    supersedesApprovalId: null,
    ...overrides,
  };
}

function storedIngestionEvent(overrides = {}) {
  return {
    eventId: "event-ingestion-1",
    type: "INGESTION",
    origin: "INGESTION",
    tenantId: "tenant_alpha",
    documentId: "doc-1",
    sourceVersionId: null,
    resultVersionId: "version-1",
    field: null,
    previousValue: null,
    nextValue: null,
    at: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

function storedCorrectionEvent(overrides = {}) {
  return {
    eventId: "event-correction-2",
    type: "MANUAL_REVIEW",
    origin: "MANUAL_REVIEW",
    tenantId: "tenant_alpha",
    documentId: "doc-1",
    sourceVersionId: "version-1",
    resultVersionId: "version-2",
    field: "supplier",
    previousValue: "Aurora",
    nextValue: "Aurora Corretta",
    at: "2026-07-30T00:00:01.000Z",
    ...overrides,
  };
}

function storedApprovalEvent(overrides = {}) {
  return {
    eventId: "event-approval-1",
    type: "APPROVAL",
    origin: "LOCAL_APPROVAL",
    tenantId: "tenant_alpha",
    documentId: "doc-1",
    sourceVersionId: "version-1",
    resultVersionId: "version-1",
    field: null,
    previousValue: null,
    nextValue: null,
    at: "2026-07-30T00:00:10.000Z",
    ...overrides,
  };
}

function storedDocument(overrides = {}) {
  return {
    id: "doc-1",
    tenantId: "tenant_alpha",
    fileName: "bill.pdf",
    objectKey: "private/tenant_alpha/doc-1.pdf",
    size: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    currentVersionId: "version-1",
    currentApprovedVersionId: null,
    versions: [storedVersion()],
    provenance: [storedIngestionEvent()],
    approvals: [],
    ...overrides,
  };
}

function storedTwoVersionDocument(overrides = {}) {
  const first = storedVersion();
  const second = storedVersion({
    versionId: "version-2",
    versionNumber: 2,
    supersedesVersionId: "version-1",
    fields: storedFields({ supplier: storedField("Aurora Corretta") }),
    createdAt: "2026-07-30T00:00:01.000Z",
    origin: "MANUAL_REVIEW",
  });
  return storedDocument({
    currentVersionId: "version-2",
    versions: [first, second],
    provenance: [storedIngestionEvent(), storedCorrectionEvent()],
    ...overrides,
  });
}

function storedMultiFieldDocument() {
  const first = storedVersion();
  const second = storedVersion({
    versionId: "version-2",
    versionNumber: 2,
    supersedesVersionId: "version-1",
    fields: storedFields({
      supplier: storedField("Aurora Corretta"),
      pod: storedField("IT002"),
    }),
    createdAt: "2026-07-30T00:00:01.000Z",
    origin: "MANUAL_REVIEW",
  });
  return storedDocument({
    currentVersionId: "version-2",
    versions: [first, second],
    provenance: [
      storedIngestionEvent(),
      storedCorrectionEvent(),
      storedCorrectionEvent({
        eventId: "event-correction-pod-2",
        field: "pod",
        previousValue: "IT001",
        nextValue: "IT002",
      }),
    ],
  });
}

async function expectMetadataInvalidStoredValue(value, { raw = false } = {}) {
  const sandbox = await createSandbox("real-bill-invalid-metadata-");
  try {
    const file = path.join(sandbox.root, "metadata.json");
    const serialized = raw ? value : JSON.stringify(value, null, 2);
    await writeFile(file, serialized, "utf8");
    const beforeStat = await stat(file);
    const repository = new LocalBillRepository(sandbox.root);
    await assert.rejects(() => repository.get("tenant_alpha", "doc-1"), /METADATA_INVALID/);
    assert.equal(await readFile(file, "utf8"), serialized);
    assert.equal((await stat(file)).size, beforeStat.size);
    assert.equal((await stat(file)).mtimeMs, beforeStat.mtimeMs);
    await assert.rejects(() => repository.save(storedDocument()), /METADATA_INVALID/);
    assert.equal(await readFile(file, "utf8"), serialized);
    assert.equal((await stat(file)).size, beforeStat.size);
    assert.equal((await stat(file)).mtimeMs, beforeStat.mtimeMs);
  } finally {
    await sandbox.cleanup();
  }
}

async function confirmAllFields(document, tenantId) {
  let current = document;
  for (const [field, value] of Object.entries(fieldValues(document))) {
    if (current.versions.at(-1).fields[field].confirmed) continue;
    current = createManualCorrection({
      document: current,
      tenantId,
      sourceVersionId: current.currentVersionId,
      field,
      value: `${value} (verified)`,
      at: testTime(current.versions.length * 1000),
    });
  }
  return current;
}

assert.equal(validatePdf("bill.pdf", "application/pdf", pdf, 1000), "bill.pdf");
assert.throws(() => validatePdf("bill.txt", "text/plain", pdf, 1000), /PDF_MIME_INVALID/);
assert.throws(() => validatePdf("bill.pdf", "application/pdf", pdf, 2), /PDF_TOO_LARGE/);
assert.throws(() => validatePdf("../bill.pdf", "application/pdf", pdf, 1000), /PDF_FILENAME_INVALID/);

const missing = extractBillFields("Supplier: Aurora");
assert.equal(missing.pod.value, null);
assert.equal(documentStatus(missing), "REVIEW_REQUIRED");
const complete = extractBillFields(fullText);
assert.equal(documentStatus(complete), "EXTRACTED");

await expectMetadataInvalidStoredValue("{", { raw: true });
await expectMetadataInvalidStoredValue(null);
await expectMetadataInvalidStoredValue([storedDocument()]);
await expectMetadataInvalidStoredValue(42);
await expectMetadataInvalidStoredValue("not-an-object");
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: {} });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ versions: {} })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ versions: [storedVersion(), storedVersion()] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ approvals: [storedApproval(), storedApproval()] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ currentVersionId: "missing-version" })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ currentApprovedVersionId: "version-1" })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ versions: [storedVersion({ tenantId: "tenant_beta" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ versions: [storedVersion({ versionNumber: 0 })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ tenantId: "tenant_beta" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ documentId: "doc-2" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ sourceVersionId: "missing-version" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ resultVersionId: "missing-version" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ sourceVersionId: "version-1", resultVersionId: "version-1" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ sourceVersionId: "version-2", resultVersionId: "version-1" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ versionNumber: 1 })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ previousValue: "wrong" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ nextValue: "wrong" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ previousValue: "Aurora", nextValue: "Aurora" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ versions: [storedVersion(), storedVersion({ versionId: "version-2", versionNumber: 2, supersedesVersionId: "version-1", fields: storedFields(), origin: "MANUAL_REVIEW" })], provenance: [storedIngestionEvent(), storedCorrectionEvent({ previousValue: "Aurora", nextValue: "Aurora Corretta" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ versions: [storedVersion(), storedVersion({ versionId: "version-2", versionNumber: 2, supersedesVersionId: "version-1", fields: storedFields({ pod: storedField("IT002") }), origin: "MANUAL_REVIEW" })], provenance: [storedIngestionEvent(), storedCorrectionEvent({ field: "supplier", previousValue: "Aurora", nextValue: "Aurora" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent({ field: "unsupported" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent()] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent(), storedCorrectionEvent({ eventId: "event-correction-2" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ provenance: [storedIngestionEvent(), storedCorrectionEvent(), storedCorrectionEvent({ eventId: "event-correction-duplicate", field: "supplier" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ versions: [storedVersion(), storedVersion({ versionId: "version-2", versionNumber: 2, supersedesVersionId: "version-2", origin: "MANUAL_REVIEW" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ currentVersionId: "version-1" })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({ versions: [storedVersion(), storedVersion({ versionId: "version-2", versionNumber: 1, supersedesVersionId: "version-1", origin: "MANUAL_REVIEW" })] })] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedTwoVersionDocument({
  currentVersionId: "version-3",
  versions: [
    storedVersion(),
    storedVersion({ versionId: "version-2", versionNumber: 2, supersedesVersionId: "version-1", origin: "MANUAL_REVIEW" }),
    storedVersion({ versionId: "version-3", versionNumber: 3, supersedesVersionId: "version-1", origin: "MANUAL_REVIEW" }),
  ],
})] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [Object.fromEntries(Object.entries(storedDocument()).filter(([key]) => key !== "currentVersionId"))] });
await expectMetadataInvalidStoredValue({ schemaVersion: 1, documents: [storedDocument({ currentVersionId: "version-2" }), storedDocument({ id: "doc-2", tenantId: "tenant_beta", currentVersionId: "version-2", versions: [storedVersion({ versionId: "version-2" })] })] });

const approvedOlderSandbox = await createSandbox("real-bill-approved-older-");
try {
  const approvedOlderFile = path.join(approvedOlderSandbox.root, "metadata.json");
  const approvedOlderDocument = storedTwoVersionDocument({
    currentApprovedVersionId: "version-1",
    approvals: [storedApproval()],
    provenance: [storedIngestionEvent(), storedCorrectionEvent(), storedApprovalEvent()],
  });
  await writeFile(approvedOlderFile, JSON.stringify({ schemaVersion: 1, documents: [approvedOlderDocument] }, null, 2), "utf8");
  const approvedOlder = await new LocalBillRepository(approvedOlderSandbox.root).get("tenant_alpha", "doc-1");
  assert.equal(approvedOlder.currentVersionId, "version-2");
  assert.equal(approvedOlder.currentApprovedVersionId, "version-1");
} finally {
  await approvedOlderSandbox.cleanup();
}

const rootSandbox = await createSandbox("real-bill-foundation-");
try {
  const repository = new LocalBillRepository(rootSandbox.root);
  const storage = new LocalDocumentStorage(rootSandbox.root);

  const initial = await ingestBill({
    tenantId: "tenant_alpha",
    fileName: "bill.pdf",
    contentType: "application/pdf",
    bytes: pdf,
    maxBytes: 1000,
    storage,
    extractor: createExtractor(),
    repository,
    audit,
  });

  const initialPublic = toPublicDocument(initial);
  assert.equal(initial.versions.length, 1);
  assert.equal(initial.approvals.length, 0);
  assert.equal(initial.currentApprovedVersionId, null);
  assert.equal(initialPublic.reviewState, "WORKING");
  assert.equal(initialPublic.currentVersionNumber, 1);
  assert.equal(initialPublic.approvalReady, false);
  assert.equal("objectKey" in initialPublic, false);
  assert.equal(await repository.get("tenant_beta", initial.id), null);

  const beforeNoOpDocument = JSON.stringify(initial);
  const metadataFile = path.join(rootSandbox.root, "metadata.json");
  const beforeNoOpMetadata = await readFile(metadataFile, "utf8");
  assert.throws(
    () => createManualCorrection({
      document: initial,
      tenantId: "tenant_alpha",
      sourceVersionId: initial.currentVersionId,
      field: "supplier",
      value: initial.versions[0].fields.supplier.value,
      at: testTime(500),
    }),
    /DOCUMENT_NO_CHANGES/,
  );
  assert.equal(JSON.stringify(initial), beforeNoOpDocument);
  assert.equal(await readFile(metadataFile, "utf8"), beforeNoOpMetadata);
  const persistedAfterNoOp = JSON.parse(beforeNoOpMetadata).documents[0];
  assert.equal(persistedAfterNoOp.versions.length, 1);
  assert.equal(persistedAfterNoOp.provenance.length, 1);
  assert.equal(persistedAfterNoOp.approvals.length, 0);
  assert.equal(persistedAfterNoOp.currentVersionId, initial.currentVersionId);
  assert.equal(persistedAfterNoOp.currentApprovedVersionId, null);

  const corrected = createManualCorrection({
    document: initial,
    tenantId: "tenant_alpha",
    sourceVersionId: initial.currentVersionId,
    field: "supplier",
    value: "Aurora Corretta",
    at: testTime(1000),
  });
  assert.equal(corrected.versions.length, 2);
  assert.equal(corrected.currentVersionId !== initial.currentVersionId, true);
  assert.equal(corrected.versions.at(-1).versionNumber, 2);
  assert.equal(corrected.versions[0].fields.supplier.value, "Aurora");
  assert.equal(corrected.versions[1].fields.supplier.value, "Aurora Corretta");
  assert.equal(corrected.provenance.at(-1).field, "supplier");
  assert.equal(corrected.provenance.at(-1).previousValue, "Aurora");
  assert.equal(corrected.provenance.at(-1).nextValue, "Aurora Corretta");
  assert.equal(reviewStateFor(corrected, corrected.currentVersionId), "WORKING");

  const beforeFailedApproval = JSON.stringify(corrected);
  assert.throws(
    () => approveDocumentVersion({
      document: corrected,
      tenantId: "tenant_alpha",
      versionId: corrected.currentVersionId,
      at: testTime(2000),
    }),
    /APPROVAL_FIELDS_UNCONFIRMED/,
  );
  assert.equal(JSON.stringify(corrected), beforeFailedApproval);

  const failedFields = await ingestBill({
    tenantId: "tenant_alpha",
    fileName: "bill-empty.pdf",
    contentType: "application/pdf",
    bytes: pdf,
    maxBytes: 1000,
    storage,
    extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } },
    repository,
    audit,
  });
  assert.equal(failedFields.versions[0].status, "OCR_PROVIDER_REQUIRED");
  assert.throws(
    () => approveDocumentVersion({
      document: failedFields,
      tenantId: "tenant_alpha",
      versionId: failedFields.currentVersionId,
      at: testTime(3000),
    }),
    /APPROVAL_REQUIRED_FIELDS_MISSING/,
  );

  assert.throws(
    () => approveDocumentVersion({
      document: corrected,
      tenantId: "tenant_alpha",
      versionId: initial.currentVersionId,
      at: testTime(4000),
    }),
    /DOCUMENT_VERSION_NOT_CURRENT/,
  );
  assert.throws(
    () => approveDocumentVersion({
      document: corrected,
      tenantId: "tenant_beta",
      versionId: corrected.currentVersionId,
      at: testTime(5000),
    }),
    /TENANT_ACCESS_DENIED/,
  );
  assert.throws(
    () => approveDocumentVersion({
      document: corrected,
      tenantId: "tenant_alpha",
      versionId: "missing-version",
      at: testTime(5500),
    }),
    /DOCUMENT_VERSION_NOT_FOUND/,
  );
  assert.throws(
    () => approveDocumentVersion({
      document: corrected,
      tenantId: "tenant_alpha",
      versionId: "foreign-version",
      at: testTime(5600),
    }),
    /DOCUMENT_VERSION_NOT_FOUND/,
  );

  const fullyReviewed = await confirmAllFields(initial, "tenant_alpha");
  const fullyReviewedPublic = toPublicDocument(fullyReviewed);
  assert.equal(fullyReviewedPublic.approvalReady, true);
  assert.deepEqual(approvalValidation(fullyReviewed, fullyReviewed.currentVersionId), { missingFields: [], unconfirmedFields: [] });

  const approved = approveDocumentVersion({
    document: fullyReviewed,
    tenantId: "tenant_alpha",
    versionId: fullyReviewed.currentVersionId,
    at: testTime(10000),
  });
  assert.equal(approved.approvals.length, 1);
  assert.equal(approved.currentApprovedVersionId, approved.currentVersionId);
  assert.equal(toPublicDocument(approved).reviewState, "APPROVED_CURRENT");
  assert.equal(approved.approvals[0].versionId, approved.currentVersionId);
  assert.equal(approved.provenance.at(-1).type, "APPROVAL");

  const workingAfterApproval = createManualCorrection({
    document: approved,
    tenantId: "tenant_alpha",
    sourceVersionId: approved.currentVersionId,
    field: "totalAmount",
    value: "21",
    at: testTime(11000),
  });
  assert.equal(workingAfterApproval.currentApprovedVersionId, approved.currentApprovedVersionId);
  assert.equal(reviewStateFor(workingAfterApproval, workingAfterApproval.currentVersionId), "WORKING_AFTER_APPROVAL");
  assert.equal(reviewStateFor(workingAfterApproval, approved.currentApprovedVersionId), "APPROVED_CURRENT");

  const reviewedAfterApproval = await confirmAllFields(workingAfterApproval, "tenant_alpha");
  const reapproved = approveDocumentVersion({
    document: reviewedAfterApproval,
    tenantId: "tenant_alpha",
    versionId: reviewedAfterApproval.currentVersionId,
    at: testTime(12000),
  });
  assert.equal(reapproved.approvals.length, 2);
  assert.equal(reapproved.currentApprovedVersionId, reviewedAfterApproval.currentVersionId);
  assert.equal(reviewStateFor(reapproved, approved.currentApprovedVersionId), "APPROVED_SUPERSEDED");
  assert.equal(reviewStateFor(reapproved, reapproved.currentApprovedVersionId), "APPROVED_CURRENT");
  assert.equal(reapproved.approvals[1].supersedesApprovalId, reapproved.approvals[0].approvalId);

  await repository.save(reapproved);
  const storePath = path.join(rootSandbox.root, "metadata.json");
  const persisted = JSON.parse(await readFile(storePath, "utf8"));
  persisted.documents[0].versions.reverse();
  persisted.documents[0].approvals.reverse();
  persisted.documents[0].provenance.reverse();
  await writeFile(storePath, JSON.stringify(persisted, null, 2), "utf8");
  const reordered = await repository.get("tenant_alpha", reapproved.id);
  assert.equal(reordered.currentApprovedVersionId, reapproved.currentApprovedVersionId);
  assert.equal(toPublicDocument(reordered).currentApprovedVersionNumber, toPublicDocument(reapproved).currentApprovedVersionNumber);
  const stateBeforeMissingVersionApproval = await readFile(storePath, "utf8");
  const persistedBeforeMissingVersionApproval = JSON.parse(stateBeforeMissingVersionApproval).documents[0];
  assert.throws(
    () => approveDocumentVersion({
      document: reordered,
      tenantId: "tenant_alpha",
      versionId: "missing-version",
      at: testTime(12500),
    }),
    /DOCUMENT_VERSION_NOT_FOUND/,
  );
  const stateAfterMissingVersionApproval = await readFile(storePath, "utf8");
  const persistedAfterMissingVersionApproval = JSON.parse(stateAfterMissingVersionApproval).documents[0];
  assert.equal(stateAfterMissingVersionApproval, stateBeforeMissingVersionApproval);
  assert.equal(persistedAfterMissingVersionApproval.versions.length, persistedBeforeMissingVersionApproval.versions.length);
  assert.equal(persistedAfterMissingVersionApproval.provenance.length, persistedBeforeMissingVersionApproval.provenance.length);
  assert.equal(persistedAfterMissingVersionApproval.approvals.length, persistedBeforeMissingVersionApproval.approvals.length);
  assert.equal(persistedAfterMissingVersionApproval.currentVersionId, persistedBeforeMissingVersionApproval.currentVersionId);
  assert.equal(persistedAfterMissingVersionApproval.currentApprovedVersionId, persistedBeforeMissingVersionApproval.currentApprovedVersionId);

  const legacySandbox = await createSandbox("real-bill-legacy-");
  try {
    const legacyFile = path.join(legacySandbox.root, "metadata.json");
    const legacyRecord = [{
      id: "legacy-doc",
      tenantId: "tenant_alpha",
      fileName: "legacy.pdf",
      objectKey: "private/tenant_alpha/legacy.pdf",
      size: 12,
      status: "REVIEW_REQUIRED",
      fields: complete,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }];
    await writeFile(legacyFile, JSON.stringify(legacyRecord, null, 2), "utf8");
    const legacyBefore = await readFile(legacyFile, "utf8");
    const legacyRepo = new LocalBillRepository(legacySandbox.root);
    const legacyDocument = await legacyRepo.get("tenant_alpha", "legacy-doc");
    assert.equal(legacyDocument.currentApprovedVersionId, null);
    assert.equal(legacyDocument.versions.length, 1);
    assert.equal(toPublicDocument(legacyDocument).reviewState, "WORKING");
    assert.equal(await readFile(legacyFile, "utf8"), legacyBefore);
  } finally {
    await legacySandbox.cleanup();
  }

  assert.equal(assertLocalBillAccess("tenant_alpha", "true"), "tenant_alpha");
  assert.throws(() => assertLocalBillAccess("tenant_alpha", "false"), /TENANT_ACCESS_DENIED/);
  assert.throws(() => assertLocalBillAccess(null, "true"), /TENANT_ACCESS_DENIED/);
  assert.deepEqual(parseBillOperation({ operation: "correct", field: "supplier", value: "Aurora", versionId: "v1" }), {
    operation: "correct",
    field: "supplier",
    value: "Aurora",
    versionId: "v1",
  });
  assert.equal(parseBillOperation({ operation: "approve" }), null);
  assert.equal(parseBillOperation({ operation: "approve", versionId: "" }), null);
  assert.deepEqual(parseBillOperation({ operation: "approve", versionId: "v2" }), { operation: "approve", versionId: "v2" });
} finally {
  await rootSandbox.cleanup();
}

const multiFieldSandbox = await createSandbox("real-bill-multi-field-");
try {
  const multiFieldFile = path.join(multiFieldSandbox.root, "metadata.json");
  await writeFile(multiFieldFile, JSON.stringify({ schemaVersion: 1, documents: [storedMultiFieldDocument()] }, null, 2), "utf8");
  const multiField = await new LocalBillRepository(multiFieldSandbox.root).get("tenant_alpha", "doc-1");
  assert.equal(multiField.versions.length, 2);
  assert.equal(multiField.provenance.length, 3);
} finally {
  await multiFieldSandbox.cleanup();
}

console.log("real-bill smoke tests passed");
