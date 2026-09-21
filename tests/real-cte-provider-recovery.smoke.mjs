import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenant = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenant });
const id = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
const recordPath = `var/phase6/cte-archives/${tenant}/${id}.json`;
const pdfPath = `var/qa-bill-hierarchy/foundation-documents/${tenant}/${id}.pdf`;
const diagnosticStem = `var/cte-diagnostics/${tenant}/${id}-attempt-3`;
const [record, pdf, raw, normalized, validation] = await Promise.all([
  readFile(recordPath, "utf8").then(JSON.parse),
  readFile(pdfPath),
  readFile(`${diagnosticStem}.raw.json`, "utf8").then(JSON.parse),
  readFile(`${diagnosticStem}.normalized.json`, "utf8").then(JSON.parse),
  readFile(`${diagnosticStem}.validation.json`, "utf8").then(JSON.parse),
]);

assert.equal(record.tenantId, tenant);
assert.ok(record.payload.attempts.length >= 3);
const attempt3 = record.payload.attempts[2];
assert.equal(attempt3.toStatus, "FAILED");
assert.equal(attempt3.outcome, "FAILED");
assert.equal(attempt3.errorCode, "CTE_EXTRACTION_SCHEMA_INVALID");
assert.equal(record.payload.status, "REVIEW_REQUIRED");
assert.equal(record.payload.approvedArchiveId, null);
assert.equal(createHash("sha256").update(pdf).digest("hex").toUpperCase(), "99EB1AE44925D0EBE3E1476AAF0F69B28F6EE7948C542CD0BB5619EBBE9E8503");
assert.equal(raw.tenantId, tenant);
assert.equal(raw.responseStatus, 200);
assert.equal(normalized.normalizedProviderPayload, null);
assert.equal(validation.schemaValidation.status, "FAIL");
assert.deepEqual(validation.schemaValidation.issuePaths, ["fields[0].valuePayload"]);
assert.deepEqual(validation.schemaValidation.issueCodes, ["JSON_PARSE"]);
assert.equal(/authorization|apiKey|accessToken|refreshToken|password|cookie/i.test(JSON.stringify(raw)), false);
const fields = raw.rawProviderPayload.content[0].input.fields;
for (const path of ["commercialTerms.fixedFees", "commercialTerms.variableFees", "commercialTerms.oneOffFees", "commercialTerms.commercialDiscounts", "commercialTerms.imbalance"]) assert.equal(fields.some((field) => field.path === path), true);
assert.notEqual(fields.find((field) => field.path === "offer.code")?.valuePayload, "BSMART0724");
await access(`${diagnosticStem}.raw.json`);
await access(`${diagnosticStem}.normalized.json`);
await access(`${diagnosticStem}.validation.json`);

console.log("REAL_CTE_PROVIDER_RECOVERY_SMOKE=PASS");
console.log("HISTORICAL_ATTEMPT_3_FAILURE=PASS");
console.log("FINAL_CTE_STATE=REVIEW_REQUIRED");
