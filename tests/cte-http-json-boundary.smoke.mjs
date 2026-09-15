import assert from "node:assert/strict";

import { getConfiguredCteOcrProvider, normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";
import { decodeCteProviderPayload, parseAnthropicCteResponse } from "../app/lib/cte/anthropic.ts";

const component = {
  componentId: "CDISPD",
  kind: "DISPATCHING",
  declarationState: "NOT_DECLARED",
  effectiveFrom: "2026-04-01",
  effectiveTo: "2026-12-31",
  documentPresence: "DOCUMENT_STATED",
  amountStatus: "NOT_DECLARED",
  sourceText: "CDISPD secondo il documento",
};
const field = (path, value) => ({
  path,
  valueKind: value === null ? "NULL" : Array.isArray(value) || value !== null && typeof value === "object" ? "JSON" : typeof value === "number" ? "NUMBER" : "TEXT",
  valuePayload: JSON.stringify(value),
  confidence: value === null ? 0 : 0.98,
  sourcePage: value === null ? 0 : 1,
  sourceText: value === null ? "" : "document evidence",
  status: value === null ? "NOT_FOUND" : "CONFIRMED",
});
const payload = (fields = [
  field("supplier.name", "BPower Energia S.p.A."),
  field("commercialTerms.passThroughComponents", [component]),
  field("commercialTerms.economicDuration", { value: 12, unit: "MONTHS", sourceText: "12 mesi" }),
  field("commercialTerms.lossSemantics", { present: true, rawText: "0,03 EUR/kWh lordo delle perdite di rete", appliesTo: "SPREAD", provenance: "document" }),
  field("commercialTerms.exitFee", { amount: 69, currency: "EUR", condition: "EARLY_EXIT_BEFORE_DURATION", durationReference: { value: 12, unit: "MONTHS", sourceText: "12 mesi" }, sourceText: "69 EUR prima dei 12 mesi" }),
]) => ({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields, extractionNotes: [] });
const toolResponse = (input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "extract_cte", input }] });
const env = { CTE_OCR_PROVIDER: "http-json", CTE_OCR_ENDPOINT: "https://synthetic.invalid/cte", CTE_OCR_API_KEY: "synthetic-only" };
const pdf = { bytes: new Uint8Array([37, 80, 68, 70, 45]), contentType: "application/pdf", fileName: "synthetic.pdf" };
const providerFor = (response) => getConfiguredCteOcrProvider(env, async () => response);
const httpExtraction = await providerFor(Response.json(payload())).extract(pdf);
const toolExtraction = parseAnthropicCteResponse(toolResponse(payload()));
assert.deepEqual(normalizeProviderExtraction(httpExtraction, "tenant_boundary"), normalizeProviderExtraction(toolExtraction, "tenant_boundary"));

const rejects = async (response, code = /CTE_/) => assert.rejects(() => providerFor(response).extract(pdf), code);
await rejects(new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }));
await rejects(Response.json(payload([field("unknown.path", "x")])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json(payload([{ ...field("supplier.name", "x"), valueKind: "INVALID" }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json(payload([field("commercialTerms.passThroughComponents", "scalar")])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json(payload([field("commercialTerms.economicDuration", { value: 12, unit: "YEARS", sourceText: "bad" })])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json(payload([field("commercialTerms.lossSemantics", { present: false, rawText: "bad", appliesTo: "SPREAD", provenance: "document" })])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json(payload([field("commercialTerms.passThroughComponents", [{ ...component, documentPresence: "DOCUMENT_STATED", amountStatus: "INVENTED" }])])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json(payload([field("commercialTerms.exitFee", { amount: 69, currency: "EUR", condition: "ANYTIME", durationReference: { value: 12, unit: "MONTHS", sourceText: "12 mesi" }, sourceText: "bad" })])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json({ ...payload(), unknownTopLevel: true }), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json(payload([field("supplier.name", "x"), { path: "offer.name", value: "legacy-mixed", confidence: 0.98, sourcePage: 1, sourceText: "legacy", status: "CONFIRMED" }])), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [{ path: "supplier.name", value: "legacy", confidence: 0.98, sourcePage: 1, sourceText: "legacy", status: "CONFIRMED" }], extractionNotes: [] }), /CTE_EXTRACTION_SCHEMA_INVALID/);
await rejects(Response.json({ ...payload(), contractCandidate: { vector: "EE" } }), /CTE_EXTRACTION_FINAL_DOMAIN_EARLY/);
assert.throws(() => decodeCteProviderPayload({ ...payload(), fields: "not-array" }), /CTE_EXTRACTION_SCHEMA_INVALID/);

console.log("HTTP_JSON_VALID_ENVELOPE=PASS");
console.log("TOOL_HTTP_JSON_NORMALIZATION_PARITY=PASS");
console.log("HTTP_JSON_FAIL_CLOSED_CASES=PASS");
console.log("DIRECT_DOMAIN_BYPASS_PREVENTED=PASS");
