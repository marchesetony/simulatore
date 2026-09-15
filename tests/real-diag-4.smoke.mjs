import assert from "node:assert/strict";

import {
  REAL_DIAG_4_MAX_FILE_BYTES,
  REAL_DIAG_4_MAX_ITEMS,
  buildBillStageShapeDiagnostic,
  buildCteDiagnosticCapture,
  writeRealDiag4Json,
} from "../app/lib/diagnostics/real-diag-4.ts";

const localEnv = { FOUNDATION_LOCAL_DEV: "true", REAL_DIAG_4_ENABLED: "true" };

const core = buildBillStageShapeDiagnostic("CORE", "extract_bill_core", {
  billingPeriod: { value: "LUGLIO 2026 - AGOSTO 2026", status: "FOUND" },
  annualConsumption: { value: 1780, status: "FOUND" },
  billedConsumption: { value: 477, status: "FOUND" },
  totalAmount: { value: 123.45, status: "FOUND" },
  f1Consumption: { value: 183, status: "FOUND" },
  f2Consumption: { value: 132, status: "FOUND" },
  f3Consumption: { value: 162, status: "FOUND" },
  pod: "IT001E97688739",
  customerName: "PII_MARKER_NAME",
});
const analyst = buildBillStageShapeDiagnostic("ANALYST", "extract_bill_analyst", {
  items: [
    { kind: "FACT", code: "MONTHLY_F1", value: "2026-07 77,26" },
    { kind: "FACT", code: "MONTHLY_F2", value: "2026-07 58,73" },
    { kind: "FACT", code: "MONTHLY_F3", value: "2026-07 73,41" },
    { kind: "FACT", code: "MONTHLY_F1", value: "2026-08 105,62" },
  ],
  customerEmail: "person@example.invalid",
});

assert.equal(core.monthly.present, false);
assert.equal(analyst.monthly.present, true);
assert.deepEqual(analyst.monthly.monthKeys, ["2026-07", "2026-08"]);
assert.equal(analyst.items.length, 4);

const cte = buildCteDiagnosticCapture({
  type: "message",
  stop_reason: "tool_use",
  content: [{
    type: "tool_use",
    name: "extract_cte",
    input: {
      schemaVersion: 1,
      documentType: "CTE",
      vector: "EE",
      fields: [{ path: "pricing.spread.amount", value: "0,03", confidence: 0.9 }],
      sourceText: "PII_MARKER_FULL_DOCUMENT_TEXT",
      secret: "sk-ant-should-never-be-written",
    },
  }],
}, {
  code: "CTE_EXTRACTION_SCHEMA_INVALID",
  issuePaths: ["content[].input.fields[0].value", "content[].input.missing"],
  issueCodes: ["TYPE", "REQUIRED"],
});

assert.equal(cte.shape.toolName, "extract_cte");
assert.equal(cte.shape.toolInputIsObject, true);
assert.deepEqual(cte.shape.toolInputFieldShapes.map((field) => field.path), ["pricing.spread.amount"]);
assert.equal(cte.shape.toolInputFieldShapes[0].valueType, "string");
const lossCte = buildCteDiagnosticCapture({ content: [{ type: "tool_use", name: "extract_cte", input: { fields: [{ path: "commercialTerms.variableFees", value: [{ note: "lordo delle perdite di rete" }] }] } }] });
assert.deepEqual(lossCte.shape.toolInputFieldShapes[0].semanticTags, ["LOSS_SEMANTICS"]);
assert.equal(cte.validation.issues.length, 2);
assert.deepEqual(cte.validation.issues.map((issue) => issue.path), [
  "content[].input.fields[0].value",
  "content[].input.missing",
]);
assert.deepEqual(cte.validation.issues.map((issue) => issue.code), ["TYPE", "REQUIRED"]);

const serialized = JSON.stringify({ core, analyst, cte });
assert.equal(serialized.includes("sk-ant-should-never-be-written"), false);
assert.equal(serialized.includes("PII_MARKER"), false);
assert.equal(serialized.includes("person@example.invalid"), false);
assert.ok(serialized.length < REAL_DIAG_4_MAX_FILE_BYTES);
assert.ok(analyst.topLevelKeys.length <= REAL_DIAG_4_MAX_ITEMS);
assert.ok(cte.shape.nestedKeyPaths.length <= 64);

assert.equal(await writeRealDiag4Json("disabled.json", core, { FOUNDATION_LOCAL_DEV: "true" }), false);
await assert.rejects(() => writeRealDiag4Json("../escape.json", core, localEnv), /REAL_DIAG_4_FILE_NAME_INVALID/);
await assert.rejects(() => writeRealDiag4Json("oversized.json", "x".repeat(REAL_DIAG_4_MAX_FILE_BYTES + 1), localEnv), /REAL_DIAG_4_OUTPUT_TOO_LARGE/);

console.log("real diag 4 smoke: PASS");
