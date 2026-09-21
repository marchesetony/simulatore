import assert from "node:assert/strict";
import { ANTHROPIC_CTE_TOOL, CTE_ARRAY_PATHS_ALLOWED_BY_TOOL, CTE_ARRAY_PATHS_ALLOWED_BY_VALIDATOR, parseAnthropicCteResponse } from "../app/lib/cte/anthropic.ts";

const component = { componentId: "losses", kind: "OTHER_CONTRACTUAL_PASS_THROUGH", declarationState: "NOT_DECLARED", effectiveFrom: "2026-04-01", effectiveTo: "2026-12-31" };
const field = (path, value) => ({ path, value, confidence: 0.95, sourcePage: 1, sourceText: "synthetic", status: value === null ? "NOT_FOUND" : "CONFIRMED" });
const envelopeField = (path, value) => ({ path, valueKind: value === null ? "NULL" : Array.isArray(value) || (value && typeof value === "object") ? "JSON" : typeof value === "number" ? "NUMBER" : "TEXT", valuePayload: JSON.stringify(value), confidence: value === null ? 0 : 0.95, sourcePage: value === null ? 0 : 1, sourceText: value === null ? "" : "synthetic", status: value === null ? "NOT_FOUND" : "CONFIRMED" });
const response = (fields) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "extract_cte", input: { schemaVersion: 1, documentType: "CTE", vector: "EE", fields, extractionNotes: [] } }] });

assert.deepEqual(CTE_ARRAY_PATHS_ALLOWED_BY_TOOL, ["commercialTerms.passThroughComponents"]);
assert.deepEqual(CTE_ARRAY_PATHS_ALLOWED_BY_VALIDATOR, [
  "commercialTerms.passThroughComponents",
  "commercialTerms.fixedFees",
  "commercialTerms.variableFees",
  "commercialTerms.oneOffFees",
  "commercialTerms.commercialDiscounts",
  "commercialTerms.imbalance",
]);
const fieldSchema = ANTHROPIC_CTE_TOOL.input_schema.properties.fields.items;
assert.equal(fieldSchema.type, "object");
assert.equal("anyOf" in fieldSchema, false);
assert.deepEqual(fieldSchema.required, ["path", "valueKind", "valuePayload", "confidence", "sourcePage", "sourceText", "status"]);
assert.deepEqual(fieldSchema.properties.valueKind.enum, ["NULL", "TEXT", "NUMBER", "JSON"]);
assert.equal(fieldSchema.properties.valuePayload.type, "string");

assert.doesNotThrow(() => parseAnthropicCteResponse(response([field("commercialTerms.passThroughComponents", [component])])))
const envelopeParsed = parseAnthropicCteResponse(response([envelopeField("commercialTerms.passThroughComponents", [component]), envelopeField("commercialTerms.economicDuration", { value: 12, unit: "MONTHS", sourceText: "12 mesi" })]));
assert.deepEqual(envelopeParsed.fields[0].value, [component]);
assert.deepEqual(envelopeParsed.fields[1].value, { value: 12, unit: "MONTHS", sourceText: "12 mesi" });
assert.equal(envelopeParsed.fields[0].sourcePage, 1);
assert.equal(parseAnthropicCteResponse(response([envelopeField("offer.name", null)])).fields[0].sourcePage, null);
assert.throws(() => parseAnthropicCteResponse(response([{ ...envelopeField("commercialTerms.passThroughComponents", "scalar-bypass"), valueKind: "TEXT" }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([{ ...envelopeField("pricing.reference", ["PUN"]), valueKind: "JSON" }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([{ ...envelopeField("offer.name", null), status: "CONFIRMED" }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([{ ...envelopeField("offer.name", null), status: "UNCERTAIN" }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([{ ...envelopeField("offer.name", null), sourcePage: 1 }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([{ ...envelopeField("offer.name", null), sourceText: "evidence" }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([field("commercialTerms.passThroughComponents", "scalar-bypass")])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([field("pricing.reference", ["PUN"])])), (error) => error.code === "CTE_EXTRACTION_SCHEMA_INVALID" && error.issuePaths.includes("fields[0].value"));
assert.doesNotThrow(() => parseAnthropicCteResponse(response([field("commercialTerms.fixedFees", [component])])));
assert.throws(() => parseAnthropicCteResponse(response([field("pricing.reference", [])])), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.throws(() => parseAnthropicCteResponse(response([field("unknown.path", [component])])), /CTE_EXTRACTION_SCHEMA_INVALID/);

console.log("cte path-aware schema smoke: ok (pass-through and legacy commercial arrays are path-scoped; scalar, empty and unknown arrays fail closed)");
