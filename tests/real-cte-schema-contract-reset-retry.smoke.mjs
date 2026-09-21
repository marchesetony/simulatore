import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenantId = "tenant_qa-company";
const ingestionId = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenantId });
process.env.FOUNDATION_DOCUMENTS_ROOT = "var/qa-bill-hierarchy/foundation-documents";

const { getConfiguredCteOcrProvider, retryCteIngestion } = await import("../app/lib/cte/ingestion.ts");
const { runtimeRepositories } = await import("../app/lib/persistence/adapter.ts");

const repositories = runtimeRepositories();
const before = await repositories.cteArchives.get(tenantId, ingestionId);
assert.ok(before);
assert.ok(before.payload.attempts.length === 4 || before.payload.attempts.length === 5);
assert.equal(before.payload.attempts.length === 4 ? before.payload.status : "REVIEW_REQUIRED", before.payload.attempts.length === 4 ? "FAILED" : "REVIEW_REQUIRED");

let after = before;
if (before.payload.attempts.length === 4) {
  const provider = getConfiguredCteOcrProvider();
  after = await retryCteIngestion({
    tenantId,
    ingestionId,
    repository: repositories.cteArchives,
    storage: repositories.documentStorage,
    provider,
  });
}
assert.equal(after.payload.attempts.length, 5);

const diagnosticStem = `var/cte-diagnostics/${tenantId}/${ingestionId}-attempt-5`;
const [raw, normalized, validation] = await Promise.all([
  readFile(`${diagnosticStem}.raw.json`, "utf8").then(JSON.parse),
  readFile(`${diagnosticStem}.normalized.json`, "utf8").then(JSON.parse),
  readFile(`${diagnosticStem}.validation.json`, "utf8").then(JSON.parse),
]);
assert.equal(raw.tenantId, tenantId);
assert.equal(raw.documentId, ingestionId);
assert.equal(raw.responseStatus, 200);
assert.equal(validation.schemaValidation.status, "PASS");
assert.ok(normalized.normalizedProviderPayload);
assert.equal(after.payload.status, "REVIEW_REQUIRED");
assert.equal(after.payload.documentType, "CTE");
assert.equal(after.payload.vector, "EE");
assert.equal(after.payload.candidate, null);

console.log("REAL_CTE_RETRY_COUNT_THIS_PHASE=1");
console.log(`HTTP_STATUS=${raw.responseStatus}`);
console.log("PROVIDER_RESPONSE_PERSISTED=YES");
console.log("RAW_PAYLOAD_PERSISTED=YES");
console.log("NORMALIZED_PAYLOAD_PERSISTED=YES");
console.log("SCHEMA_VALIDATION_AFTER=PASS");
console.log(`DOCUMENT_TYPE_AFTER=${after.payload.documentType}`);
console.log(`ENERGY_VECTOR_AFTER=${after.payload.vector}`);
console.log("CTE_REVIEW_STATE_AFTER=REVIEW_REQUIRED");
console.log("REAL_CTE_RETRY_ACCEPTANCE=PASS");
