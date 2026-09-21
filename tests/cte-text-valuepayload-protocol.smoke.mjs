import assert from "node:assert/strict";
import { normalizeTextValuePayload, parseAnthropicCteResponse } from "../app/lib/cte/anthropic.ts";

const textCases = ["CTE", "EE", "BPower Energia S.p.A.", "", "null", "con \"virgolette\"", "EUR/kWh", "€ /mese", "linea 1\nlinea 2"];
for (const value of textCases) {
  const encoded = normalizeTextValuePayload(value);
  assert.equal(JSON.parse(encoded), value);
  assert.equal(normalizeTextValuePayload(encoded), encoded);
}
assert.equal(normalizeTextValuePayload("null"), JSON.stringify("null"));
assert.equal(normalizeTextValuePayload("123"), JSON.stringify("123"));

const field = (path, value, valueKind, valuePayload = value) => ({ path, valueKind, valuePayload, confidence: 0.95, sourcePage: 1, sourceText: "real-document-evidence", status: "CONFIRMED" });
const response = (fields) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "extract_cte", input: { schemaVersion: 1, documentType: "CTE", vector: "EE", fields, extractionNotes: [] } }] });
const passThrough = { componentId: "dispatching", kind: "DISPATCHING", declarationState: "NOT_DECLARED", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" };
const parsed = parseAnthropicCteResponse(response([
  field("documentType", "CTE", "TEXT", "CTE"),
  field("vector", "EE", "TEXT", "EE"),
  field("supplier.name", "BPower Energia S.p.A.", "TEXT", JSON.stringify("BPower Energia S.p.A.")),
  field("pricing.spread.amount", 0.01, "NUMBER", "0.01"),
  field("commercialTerms.passThroughComponents", [passThrough], "JSON", JSON.stringify([passThrough])),
]));
assert.equal(parsed.fields.find((item) => item.path === "documentType")?.value, "CTE");
assert.equal(parsed.fields.find((item) => item.path === "vector")?.value, "EE");
assert.equal(parsed.fields.find((item) => item.path === "pricing.spread.amount")?.value, 0.01);
assert.deepEqual(parsed.fields.find((item) => item.path === "commercialTerms.passThroughComponents")?.value, [passThrough]);

const legacy = parseAnthropicCteResponse(response([
  { path: "commercialTerms.fixedFees", value: ["15 €/mese"], confidence: 0.95, sourcePage: 1, sourceText: "15 €/mese", status: "CONFIRMED" },
]));
assert.deepEqual(legacy.fields[0].value, ["15 €/mese"]);

console.log("cte TEXT valuePayload protocol smoke: ok (plain/encoded TEXT normalized; JSON/NUMBER unchanged; special characters preserved)");
