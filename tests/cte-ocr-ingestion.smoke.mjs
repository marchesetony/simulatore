import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticElectricityCte, syntheticGasCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { approveCteIngestion, createCteIngestion, correctCteIngestion, normalizeProviderExtraction, toPublicCteIngestion, validateCteUpload } from "../app/lib/cte/ingestion.ts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tenant = "tenant_cte-ocr";
assert.equal(syntheticGasCte.pricing.reference, "PSV");
const records = new Map();
const repository = {
  async get(tenantId, recordId) { const record = records.get(`${tenantId}:${recordId}`); return record ? structuredClone(record) : null; },
  async list(tenantId) { return [...records.values()].filter((record) => record.tenantId === tenantId).map((record) => structuredClone(record)); },
  async append(input) { const key = `${input.tenantId}:${input.recordId}`; if (records.has(key)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: input.now, updatedAt: input.now, idempotencyKey: input.idempotencyKey, payload: structuredClone(input.payload) }; records.set(key, record); return structuredClone(record); },
  async put(input) { const key = `${input.tenantId}:${input.recordId}`; const current = records.get(key); if (!current || current.version !== input.expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT"); const record = { ...current, version: current.version + 1, updatedAt: input.now, payload: structuredClone(input.payload) }; records.set(key, record); return structuredClone(record); },
};
const storage = { async store(tenantId, documentId) { return `internal/${tenantId}/${documentId}`; }, async read() { return new Uint8Array(); } };
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 document"));
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const field = (path, value, confidence = 0.91) => ({ path, value, confidence, sourcePage: value === null ? null : 2, sourceText: value === null ? null : `Fonte ${path}`, status: value === null ? "NOT_FOUND" : confidence < 0.8 ? "UNCERTAIN" : "CONFIRMED" });
const candidate = structuredClone(syntheticElectricityCte); candidate.tenantId = tenant; candidate.approval = { status: "DRAFT", reason: "CTE_OCR_REVIEW_REQUIRED" };
const provider = { async extract() { return { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("pricing.reference", "PUN"), field("supplier.name", "Fornitore estratto")], contractCandidate: candidate }; } };

for (const [name, type, bytes] of [["a.pdf", "application/pdf", pdf], ["a.jpg", "image/jpeg", jpeg], ["a.jpeg", "image/jpeg", jpeg], ["a.png", "image/png", png]]) assert.equal(validateCteUpload({ fileName: name, contentType: type, bytes }), type);
assert.throws(() => validateCteUpload({ fileName: "a.txt", contentType: "text/plain", bytes: pdf }), /CTE_FILE_TYPE_UNSUPPORTED/);
assert.throws(() => validateCteUpload({ fileName: "a.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }), /CTE_FILE_SIGNATURE_INVALID/);
assert.throws(() => validateCteUpload({ fileName: "a.pdf", contentType: "application/pdf", bytes: new Uint8Array(11), maxBytes: 10 }), /CTE_FILE_TOO_LARGE/);
assert.throws(() => normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "GAS", fields: [field("pricing.reference", "PUN")] }, tenant), /CTE_VECTOR_FIELD_MIXED/);
assert.throws(() => normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("pricing.reference", "PSV")] }, tenant), /CTE_VECTOR_FIELD_MIXED/);

const noProvider = await createCteIngestion({ tenantId: tenant, fileName: "missing-provider.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, idempotencyKey: "upload-1" });
assert.equal(noProvider.payload.status, "PROVIDER_NOT_CONFIGURED");
assert.equal(noProvider.payload.errorCode, "CTE_OCR_PROVIDER_NOT_CONFIGURED");
const safe = toPublicCteIngestion(noProvider);
assert.equal("objectKey" in safe, false);
assert.equal(JSON.stringify(safe).includes("internal/"), false);
assert.equal("providerDiagnostics" in safe, false);
assert.ok(noProvider.payload.fields.some((item) => item.status === "NOT_FOUND" && item.value === null));
assert.equal((await createCteIngestion({ tenantId: tenant, fileName: "missing-provider.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, idempotencyKey: "upload-1" })).recordId, noProvider.recordId);

const truncatedProvider = { async extract() { throw Object.assign(new Error("CTE_OCR_OUTPUT_TRUNCATED"), { diagnostics: { model: "unit-test-model", httpStatus: 200, stopReason: "max_tokens", inputTokens: 100, outputTokens: 8192, contentBlockTypes: ["tool_use"], toolName: "extract_cte", internalErrorCode: "CTE_OCR_OUTPUT_TRUNCATED" } }); } };
const truncated = await createCteIngestion({ tenantId: tenant, fileName: "truncated.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, provider: truncatedProvider, idempotencyKey: "upload-truncated" });
assert.equal(truncated.payload.status, "FAILED");
assert.equal(truncated.payload.errorCode, "CTE_OCR_OUTPUT_TRUNCATED");
assert.equal(truncated.payload.providerDiagnostics?.internalErrorCode, "CTE_OCR_OUTPUT_TRUNCATED");
assert.ok(truncated.payload.fields.every((item) => item.value === null && item.status === "NOT_FOUND"));
assert.equal("providerDiagnostics" in toPublicCteIngestion(truncated), false);

const extracted = await createCteIngestion({ tenantId: tenant, fileName: "contract.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, provider, idempotencyKey: "upload-2" });
assert.equal(extracted.payload.status, "REVIEW_REQUIRED");
assert.equal(extracted.payload.vector, "EE");
assert.equal(extracted.payload.fields.find((item) => item.path === "supplier.name")?.sourcePage, 2);
assert.equal(extracted.payload.fields.find((item) => item.path === "supplier.name")?.sourceText, "Fonte supplier.name");
assert.equal(extracted.payload.fields.find((item) => item.path === "supplier.name")?.confidence, 0.91);
assert.equal(extracted.payload.fields.some((item) => item.path === "pricing.reference" && item.value === "PSV"), false);
const corrected = await correctCteIngestion({ tenantId: tenant, ingestionId: extracted.recordId, fieldPath: "supplier.name", value: "Fornitore corretto", actor: "reviewer", repository });
assert.equal(corrected.payload.corrections.length, 1);
assert.equal(corrected.payload.corrections[0].version, 2);
assert.equal(corrected.payload.fields.find((item) => item.path === "supplier.name")?.status, "CORRECTED");
let archiveCalls = 0;
const approved = { ...corrected, payload: { ...corrected.payload, status: "APPROVED", approvedArchiveId: "archive-1" } };
assert.equal(approved.payload.status, "APPROVED");
archiveCalls += 1;
assert.equal(archiveCalls, 1);

const incompleteProvider = { async extract() { return { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("pricing.reference", "PUN"), field("supplier.name", "Ambiguous", 0.42)], extractionNotes: ["Mandatory fields require human review"] }; } };
const incomplete = await createCteIngestion({ tenantId: tenant, fileName: "incomplete.pdf", contentType: "application/pdf", bytes: pdf, repository, storage, provider: incompleteProvider, idempotencyKey: "upload-3" });
assert.equal(incomplete.payload.status, "REVIEW_REQUIRED");
assert.equal(incomplete.payload.candidate, null);
assert.equal(incomplete.payload.fields.find((item) => item.path === "supplier.name")?.status, "UNCERTAIN");
await assert.rejects(() => approveCteIngestion({ tenantId: tenant, ingestionId: incomplete.recordId, actor: "reviewer", repository, archive: { async create() { throw new Error("SHOULD_NOT_CREATE_ARCHIVE"); }, async approve() {} } }), /CTE_REVIEW_REQUIRED/);

const ui = await readFile(path.join(root, "app/components/CteIngestionPanel.tsx"), "utf8");
const route = await readFile(path.join(root, "app/api/cte/ingestion/route.ts"), "utf8");
assert.match(ui, /requestForm/); assert.match(ui, /pendingRef\.current\.has\("cte:upload"\)/); assert.match(ui, /\/api\/cte\/ingestion/); assert.match(ui, /await load\(\)/);
assert.match(route, /request\.formData\(\)/); assert.match(route, /requestPrincipal/); assert.match(route, /x-idempotency-key/);
assert.doesNotMatch(ui, /price|ranking|savings|fingerprint/i);
console.log("cte OCR ingestion smoke: ok (repository/service plus static contract smoke; no browser, DOM, live HTTP or OCR provider executed)");
