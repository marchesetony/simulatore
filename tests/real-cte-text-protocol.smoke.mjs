import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenant = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenant });
const id = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
const base = `var/cte-diagnostics/${tenant}/${id}-attempt-4`;
const [raw, normalized, validation, record] = await Promise.all([
  readFile(`${base}.raw.json`, "utf8").then(JSON.parse),
  readFile(`${base}.normalized.json`, "utf8").then(JSON.parse),
  readFile(`${base}.validation.json`, "utf8").then(JSON.parse),
  readFile(`var/phase6/cte-archives/${tenant}/${id}.json`, "utf8").then(JSON.parse),
]);

assert.equal(raw.tenantId, tenant);
assert.equal(raw.responseStatus, 200);
assert.equal(raw.rawProviderPayload.content[0].input.fields[0].valuePayload, "CTE");
assert.equal(raw.rawProviderPayload.content[0].input.fields[0].valueKind, "TEXT");
assert.equal(normalized.normalizedProviderPayload, null);
assert.equal(validation.schemaValidation.status, "FAIL");
assert.deepEqual(validation.schemaValidation.issuePaths, ["fields[22].sourceText"]);
assert.deepEqual(validation.schemaValidation.issueCodes, ["STRING"]);
assert.ok(record.payload.attempts.length >= 4);
const attempt4 = record.payload.attempts[3];
assert.equal(attempt4.toStatus, "FAILED");
assert.equal(attempt4.outcome, "FAILED");
assert.equal(attempt4.errorCode, "CTE_EXTRACTION_SCHEMA_INVALID");
assert.equal(record.payload.status, "REVIEW_REQUIRED");
assert.equal(record.payload.approvedArchiveId, null);
for (const suffix of ["raw.json", "normalized.json", "validation.json"]) await access(`${base}.${suffix}`);

console.log("REAL_CTE_TEXT_PROTOCOL_SMOKE=PASS");
console.log("HISTORICAL_ATTEMPT_4_FAILURE=PASS");
console.log("FINAL_CTE_STATE=REVIEW_REQUIRED");
