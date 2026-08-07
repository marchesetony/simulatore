import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { approveCteIngestion } from "../app/lib/cte/ingestion.ts";

const tenantId = "tenant_cte-approval-smoke";
const candidate = structuredClone(syntheticElectricityCte);
candidate.tenantId = tenantId;
candidate.approval = { status: "DRAFT", reason: "CTE_OCR_REVIEW_REQUIRED" };
const field = (path, value) => ({ path, value, confidence: 0.99, sourcePage: 1, sourceText: `Evidenza ${path}`, status: "CONFIRMED" });
const fields = [
  field("supplier.name", candidate.supplier.name),
  field("supplier.supplierId", candidate.supplier.supplierId),
  field("offer.name", candidate.offer.name),
  field("offer.code", candidate.offer.code),
  field("validity.periodStart", candidate.validity.periodStart),
  field("validity.periodEnd", candidate.validity.periodEnd),
  field("eligibility.customerTypes", "NON_RESIDENTIAL"),
  field("eligibility.voltageLevels", "LV, MV"),
  field("pricing.mode", "INDEXED"),
  field("pricing.reference", "PUN"),
  field("pricing.spread.amount", candidate.pricing.spread.amount),
  field("taxTreatment", candidate.taxTreatment),
];
const payload = {
  schemaVersion: 1,
  ingestionId: "cte-ingestion-approval-smoke",
  documentId: "cte-ingestion-approval-smoke",
  objectKey: "cte-ingestion-approval-smoke/original.pdf",
  fileName: "approval-smoke.pdf",
  contentType: "application/pdf",
  size: 128,
  status: "REVIEW_REQUIRED",
  documentType: "CTE",
  vector: "EE",
  fields,
  extractionNotes: [],
  candidate,
  reviewedCandidate: candidate,
  corrections: [],
  errorCode: null,
  providerDiagnostics: null,
  attempts: [],
  approvedArchiveId: null,
};
let current = { schemaVersion: 1, recordId: payload.ingestionId, tenantId, version: 1, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z", payload };
let putCount = 0;
let archiveCreateCount = 0;
let archiveApproveCount = 0;
const repository = {
  async get(requestTenantId, recordId) {
    assert.equal(requestTenantId, tenantId);
    assert.equal(recordId, payload.ingestionId);
    return structuredClone(current);
  },
  async put(input) {
    assert.equal(input.expectedVersion, current.version);
    putCount += 1;
    current = { ...current, version: current.version + 1, updatedAt: "2026-08-07T00:00:01.000Z", payload: structuredClone(input.payload) };
    return structuredClone(current);
  },
};
const archive = {
  async create() {
    archiveCreateCount += 1;
    return { archiveId: candidate.cteId, currentWorkingVersionId: "archive-version-1" };
  },
  async approve() {
    archiveApproveCount += 1;
  },
};

const [first, second] = await Promise.all([
  approveCteIngestion({ tenantId, ingestionId: payload.ingestionId, actor: "reviewer", repository, archive }),
  approveCteIngestion({ tenantId, ingestionId: payload.ingestionId, actor: "reviewer", repository, archive }),
]);
assert.equal(first.record.payload.status, "APPROVED");
assert.equal(first.alreadyApproved, false);
assert.equal(second.record.payload.status, "APPROVED");
assert.equal(second.alreadyApproved, true);
assert.equal(putCount, 1, "a repeated approval must not write a new ingestion version");
assert.equal(archiveCreateCount, 1, "a repeated approval must not create a second archive");
assert.equal(archiveApproveCount, 1, "a repeated approval must not approve the archive twice");
assert.equal(second.record.version, first.record.version);
assert.equal(second.record.updatedAt, first.record.updatedAt);

const ui = await readFile(new URL("../app/components/CteIngestionPanel.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/cte/ingestion/[id]/approve/route.ts", import.meta.url), "utf8");
assert.match(ui, /status === "APPROVED"/);
assert.match(ui, /CTE approvata/);
assert.match(ui, /Approvata/);
assert.match(ui, /await load\(selectedId\)/);
assert.match(ui, /pendingRef\.current\.has\("cte:approve"\)/);
assert.match(route, /alreadyApproved/);
assert.match(route, /already-approved/);
console.log("cte approval single action smoke: ok (server idempotency, one archive approval, stable version and authoritative UI resync)");
