import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteIngestion, retryCteIngestion, toPublicCteIngestion } from "../app/lib/cte/ingestion.ts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const records = new Map();
const repository = {
  async get(tenantId, recordId) { const value = records.get(`${tenantId}:${recordId}`); return value ? structuredClone(value) : null; },
  async list(tenantId) { return [...records.values()].filter((value) => value.tenantId === tenantId).map((value) => structuredClone(value)); },
  async append(input) { const key = `${input.tenantId}:${input.recordId}`; const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: input.now, updatedAt: input.now, payload: structuredClone(input.payload) }; records.set(key, record); return structuredClone(record); },
  async put(input) { const key = `${input.tenantId}:${input.recordId}`; const current = records.get(key); if (!current || current.version !== input.expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT"); const record = { ...current, version: current.version + 1, updatedAt: input.now, payload: structuredClone(input.payload) }; records.set(key, record); return structuredClone(record); },
};
let stores = 0;
let reads = 0;
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 archived CTE"));
const storage = { async store() { stores += 1; return "internal/tenant_cte/retry/original.pdf"; }, async read() { reads += 1; return pdf; } };
const field = (path, value, confidence = 0.94) => ({ path, value, confidence, sourcePage: 3, sourceText: `Pagina sorgente ${path}`, status: "CONFIRMED" });
const failedProvider = { async extract() { throw new Error("CTE_OCR_OUTPUT_TRUNCATED"); } };
const candidate = structuredClone(syntheticElectricityCte); candidate.tenantId = "tenant_retry"; candidate.approval = { status: "DRAFT", reason: "CTE_OCR_REVIEW_REQUIRED" };
const successfulProvider = { async extract() { return { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("pricing.reference", "PUN"), field("supplier.name", "Fornitore reale")], contractCandidate: candidate }; } };

const initial = await createCteIngestion({ tenantId: "tenant_retry", fileName: "original.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, provider: failedProvider });
assert.equal(initial.payload.status, "FAILED");
assert.equal(initial.payload.attempts.length, 1);
const retried = await retryCteIngestion({ tenantId: "tenant_retry", ingestionId: initial.recordId, repository, storage, provider: successfulProvider });
assert.equal(retried.recordId, initial.recordId);
assert.equal(retried.version, 2);
assert.equal(retried.payload.status, "REVIEW_REQUIRED");
assert.equal(retried.payload.documentType, "CTE");
assert.equal(retried.payload.vector, "EE");
assert.equal(retried.payload.attempts.length, 2);
assert.equal(retried.payload.attempts[0].outcome, "FAILED");
assert.equal(retried.payload.attempts[1].outcome, "SUCCEEDED");
assert.equal(retried.payload.approvedArchiveId, null);
assert.equal(retried.payload.fields.find((item) => item.path === "supplier.name")?.sourcePage, 3);
assert.equal(retried.payload.fields.find((item) => item.path === "supplier.name")?.sourceText, "Pagina sorgente supplier.name");
assert.equal(stores, 1);
assert.equal(reads, 1);
assert.equal("objectKey" in toPublicCteIngestion(retried), false);
assert.equal(JSON.stringify(toPublicCteIngestion(retried)).includes("internal/"), false);
await assert.rejects(() => retryCteIngestion({ tenantId: "other_tenant", ingestionId: initial.recordId, repository, storage, provider: successfulProvider }), /CTE_INGESTION_NOT_FOUND/);
await assert.rejects(() => retryCteIngestion({ tenantId: "tenant_retry", ingestionId: initial.recordId, repository, storage, provider: successfulProvider }), /CTE_RETRY_STATE_INVALID/);

const unavailableStorage = { async store() { return "internal/unavailable"; }, async read() { throw new Error("READ_FAILED"); } };
const unavailable = await createCteIngestion({ tenantId: "tenant_retry", fileName: "unavailable.pdf", contentType: "application/pdf", bytes: pdf, repository, storage: unavailableStorage, provider: failedProvider });
const unavailableRetry = await retryCteIngestion({ tenantId: "tenant_retry", ingestionId: unavailable.recordId, repository, storage: unavailableStorage, provider: successfulProvider });
assert.equal(unavailableRetry.payload.status, "FAILED");
assert.equal(unavailableRetry.payload.errorCode, "CTE_ORIGINAL_DOCUMENT_UNAVAILABLE");

let release;
const waitProvider = { async extract() { await new Promise((resolve) => { release = resolve; }); return { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("pricing.reference", "PUN")] }; } };
const concurrent = await createCteIngestion({ tenantId: "tenant_retry", fileName: "concurrent.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, provider: failedProvider });
const first = retryCteIngestion({ tenantId: "tenant_retry", ingestionId: concurrent.recordId, repository, storage, provider: waitProvider });
await new Promise((resolve) => setTimeout(resolve, 5));
await assert.rejects(() => retryCteIngestion({ tenantId: "tenant_retry", ingestionId: concurrent.recordId, repository, storage, provider: waitProvider }), /CTE_OCR_RETRY_IN_PROGRESS/);
release();
await first;

const ui = await readFile(path.join(root, "app/components/CteIngestionPanel.tsx"), "utf8");
const route = await readFile(path.join(root, "app/api/cte/ingestion/[id]/retry/route.ts"), "utf8");
assert.match(ui, /Riprova analisi/);
assert.match(ui, /cte:retry/);
assert.match(ui, /\/api\/cte\/ingestion\/.*retry/);
assert.match(route, /requestPrincipal/);
assert.match(route, /retryCteIngestion/);
assert.doesNotMatch(ui, /objectKey|FOUNDATION_DOCUMENTS_ROOT|process\.env/);
assert.doesNotMatch(route, /console\.log|ANTHROPIC_API_KEY=|process\.env|objectKey/);
console.log("cte OCR retry smoke: ok (existing document, tenant scope, retry lock, versioned review persistence)");
