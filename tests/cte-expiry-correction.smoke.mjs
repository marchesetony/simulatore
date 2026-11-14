import assert from "node:assert/strict";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteIngestion, correctCteIngestion, toPublicCteIngestion } from "../app/lib/cte/ingestion.ts";

// An expired CTE is explained before approval and can be unblocked by correcting the expiry in dd/mm/yyyy, as shown on screen.
const tenant = "tenant_cte-expiry";
const records = new Map();
const repository = {
  async get(tenantId, recordId) { const record = records.get(`${tenantId}:${recordId}`); return record ? structuredClone(record) : null; },
  async list(tenantId) { return [...records.values()].filter((record) => record.tenantId === tenantId).map((record) => structuredClone(record)); },
  async append(input) { const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: input.now, updatedAt: input.now, idempotencyKey: input.idempotencyKey, payload: structuredClone(input.payload) }; records.set(`${input.tenantId}:${input.recordId}`, record); return structuredClone(record); },
  async put(input) { const key = `${input.tenantId}:${input.recordId}`; const current = records.get(key); if (!current || current.version !== input.expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT"); const record = { ...current, version: current.version + 1, updatedAt: input.now, payload: structuredClone(input.payload) }; records.set(key, record); return structuredClone(record); },
};
const storage = { async store(tenantId, documentId) { return `internal/${tenantId}/${documentId}`; }, async read() { return new Uint8Array(); } };
const today = new Date().toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));
const candidate = structuredClone(syntheticElectricityCte);
candidate.tenantId = tenant;
candidate.approval = { status: "DRAFT", reason: "CTE_OCR_REVIEW_REQUIRED" };
candidate.validity = { periodStart: `${year - 1}-01-01`, periodEnd: `${year + 1}-12-31` };
candidate.expiry = { status: "EXPIRES_ON", date: `${year - 1}-06-30` };
const field = (path, value) => ({ path, value, confidence: 0.95, sourcePage: 1, sourceText: `Fonte ${path}`, status: "CONFIRMED" });
const provider = { async extract() { return { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("supplier.name", "Fornitore"), field("pricing.reference", "PUN")], contractCandidate: candidate }; } };
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 document"));

const extracted = await createCteIngestion({ tenantId: tenant, fileName: "expired.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, provider, idempotencyKey: "expired-1" });
const blocked = toPublicCteIngestion(extracted).approvalGate;
assert.equal(blocked.approvalReady, false);
assert.ok(blocked.blockers.some((blocker) => blocker.code === "CTE_EXPIRED" && blocker.label.startsWith(`CTE scaduta il 30/06/${year - 1}`)), JSON.stringify(blocked.blockers));

const corrected = await correctCteIngestion({ tenantId: tenant, ingestionId: extracted.recordId, fieldPath: "expiry.date", value: `31/12/${year + 1}`, actor: "reviewer", repository });
assert.deepEqual(corrected.payload.reviewedCandidate.expiry, { status: "EXPIRES_ON", date: `${year + 1}-12-31` });
const unblocked = toPublicCteIngestion(corrected).approvalGate;
assert.equal(unblocked.blockers.some((blocker) => blocker.code === "CTE_EXPIRED"), false, JSON.stringify(unblocked.blockers));

await assert.rejects(correctCteIngestion({ tenantId: tenant, ingestionId: extracted.recordId, fieldPath: "expiry.date", value: "31/02/2027", actor: "reviewer", repository }), /CTE_CORRECTION_VALUE_INVALID/);
console.log("cte expiry correction smoke: ok");
