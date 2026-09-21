import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";
import { normalizeCteReview, tryBuildAuthoritativeCteContract } from "../app/lib/cte/review.ts";
import { parseAnthropicCteResponse } from "../app/lib/cte/anthropic.ts";

const tenantId = "tenant_qa-company";
const documentId = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
const rawPath = `var/cte-diagnostics/${tenantId}/${documentId}-attempt-4.raw.json`;
const persisted = JSON.parse(await readFile(rawPath, "utf8"));
const providerPayload = persisted.rawProviderPayload;
const decoded = parseAnthropicCteResponse(providerPayload);
assert.equal(decoded.documentType, "CTE");
assert.equal(decoded.vector, "EE");
assert.equal(decoded.fields.length, 26);

const passThrough = decoded.fields.find((field) => field.path === "commercialTerms.passThroughComponents");
assert.ok(passThrough && Array.isArray(passThrough.value));
assert.equal(passThrough.value.length, 3);
assert.ok(passThrough.value.every((component) => component.declarationState === "NOT_DECLARED"));
assert.ok(passThrough.value.every((component) => component.effectiveFrom === "2025-11-06" && component.effectiveTo === "2026-12-31"));

const lossSemantics = decoded.fields.find((field) => field.path === "commercialTerms.lossSemantics");
assert.equal(typeof lossSemantics?.value, "object");
assert.equal(lossSemantics?.value?.appliesTo, "UNSPECIFIED");

const passThroughSource = passThrough.sourceText;
assert.equal(typeof passThroughSource, "string");
assert.equal(passThroughSource.length, 753);

const extraction = normalizeProviderExtraction(decoded, tenantId);
assert.equal(extraction.documentType, "CTE");
assert.equal(extraction.vector, "EE");
assert.equal(extraction.fields.find((field) => field.path === "offer.code")?.value, "003888ESVFL04XXXXXXXXXBSMART1125");
assert.equal(extraction.fields.find((field) => field.path === "validity.periodStart")?.value, "06/11/2025");
assert.equal(extraction.fields.find((field) => field.path === "validity.periodEnd")?.value, "31/12/2026");

const review = normalizeCteReview(extraction);
const consumption = review.commercialFields.find((field) => field.fieldKey === "eligibility.consumptionRange");
assert.equal(consumption?.normalizedValue, "> 40.000 kWh/anno");
const voltage = review.commercialFields.find((field) => field.fieldKey === "eligibility.voltageLevels");
assert.equal(voltage?.normalizedValue, "BT / MT");
assert.equal(review.currency, "EUR");
assert.equal(review.approvalGate.blockers.length, 0);

const build = tryBuildAuthoritativeCteContract({
  ingestionId: documentId,
  documentId,
  tenantId,
  fields: extraction.fields,
  vector: extraction.vector,
  documentType: extraction.documentType,
});
assert.ok(build.contract, `${build.errorCode ?? "promotion dry-run failed"}: ${build.validationPaths.join(",")}`);
assert.equal(build.contract.approval.status, "NEEDS_REVIEW");
assert.deepEqual(build.contract.eligibility.voltageLevels, ["LV", "MV"]);
assert.equal(build.contract.currency, "EUR");
assert.equal(build.contract.pricing.mode, "INDEXED");
assert.equal(build.contract.pricing.reference, "PUN");

console.log("REAL_RAW_PAYLOAD_NORMALIZATION=PASS");
console.log("FULL_SCHEMA_VALIDATION_OFFLINE=PASS");
console.log("PROMOTION_DRY_RUN=PASS");
console.log("SCHEMA_CONTRACT_RESET_OFFLINE=PASS");
