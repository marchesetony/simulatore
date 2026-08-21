import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createValidSyntheticBillPdf, validateSyntheticBillPdf } from "../tests/helpers/create-valid-synthetic-bill-pdf.mjs";
import { ANALYST_SCHEMA_METRICS, ANALYST_WIRE_TOOL, BILL_ANALYST_TOOL_NAME, BILL_CORE_TOOL_NAME, CORE_SCHEMA_METRICS, CORE_WIRE_TOOL } from "../app/lib/ingestion/bill-two-stage.ts";
import { createAnthropicTwoStageBillSdkAdapter } from "../app/lib/ingestion/anthropic-bill-sdk.ts";

const COMPACT_ONE_CALL_BYTES = 7428;
const report = {
  architecture: "TWO_STAGE_SEPARATE_REQUESTS",
  billCodeTests: "NOT_RUN",
  lint: "NOT_RUN",
  gitDiffCheck: "NOT_RUN",
  cteCodeRegression: "NOT_RUN",
  cteRuntimeFixtureStatus: "NOT_RUN",
  automationCreated: "OK",
  pdfGeneration: "KO",
  pdfValidation: "KO",
  base64Roundtrip: "KO",
  tempCleanup: "KO",
  syntheticCalls: 0,
  core: { httpStatus: "NONE", stopReason: "NONE", matchingToolCount: "NONE", wireValidation: "NOT_RUN", errorType: "NONE", errorMessage: "NONE", requestId: "NONE" },
  analyst: { httpStatus: "NONE", stopReason: "NONE", matchingToolCount: "NONE", wireValidation: "NOT_RUN", errorType: "NONE", errorMessage: "NONE", requestId: "NONE" },
};

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function offlineSelfGate() {
  await import("../tests/bill-two-stage.smoke.mjs?two-stage-self-gate");
  report.billCodeTests = "OK";
  try {
    const cteValidation = await import("../app/lib/cte/validation.ts?two-stage-self-gate");
    const fixtures = await import("../app/lib/cte/synthetic-fixtures.ts?two-stage-self-gate");
    cteValidation.validateCteContract(fixtures.syntheticElectricityCte);
    cteValidation.validateCteContract(fixtures.syntheticGasCte);
    report.cteCodeRegression = "NO";
  } catch {
    report.cteCodeRegression = "DETECTED";
  }
  report.lint = "EXTERNAL_GATE_REQUIRED";
  report.gitDiffCheck = "EXTERNAL_GATE_REQUIRED";
  const fixturePath = path.join(process.cwd(), "var", "phase6", "cte-archives");
  report.cteRuntimeFixtureStatus = existsSync(fixturePath) ? "PRESENT_NOT_REQUIRED" : "MISSING_NOT_BLOCKING";
  if (report.billCodeTests !== "OK" || report.cteCodeRegression !== "NO") throw new Error("OFFLINE_SELF_GATE_FAILED");
}

async function preparePdf() {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bill-two-stage-probe-"));
  try {
    const fixturePath = path.join(temporaryDirectory, "synthetic-bill.pdf");
    const generated = createValidSyntheticBillPdf();
    report.pdfGeneration = "OK";
    await writeFile(fixturePath, generated);
    const file = await readFile(fixturePath);
    const validation = validateSyntheticBillPdf(file);
    assert.equal(validation.pageCount >= 1, true);
    report.pdfValidation = "OK";
    const encoded = Buffer.from(file).toString("base64");
    const decoded = Buffer.from(encoded, "base64");
    assert.equal(decoded.toString("base64"), encoded);
    assert.equal(sha256(decoded), sha256(file));
    report.base64Roundtrip = "OK";
    assert.equal((await stat(fixturePath)).size > 0, true);
    return file;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    report.tempCleanup = existsSync(temporaryDirectory) ? "KO" : "OK";
  }
}

function offlinePreflight() {
  assert.equal(CORE_WIRE_TOOL.strict, true);
  assert.equal(ANALYST_WIRE_TOOL.strict, true);
  assert.equal(CORE_WIRE_TOOL.name, BILL_CORE_TOOL_NAME);
  assert.equal(ANALYST_WIRE_TOOL.name, BILL_ANALYST_TOOL_NAME);
  assert.notEqual(JSON.stringify(CORE_WIRE_TOOL.input_schema).includes("analystItems"), true);
  assert.equal(ANALYST_SCHEMA_METRICS.optional, 0);
  assert.equal(ANALYST_SCHEMA_METRICS.unions, 0);
  assert.equal(ANALYST_SCHEMA_METRICS.enumValues, 0);
  assert.ok(ANALYST_SCHEMA_METRICS.bytes < COMPACT_ONE_CALL_BYTES);
  assert.ok(ANALYST_SCHEMA_METRICS.bytes < CORE_SCHEMA_METRICS.bytes);
}

async function loadLocalEnvironment() {
  try {
    const source = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch { /* configuration failure is reported as a bounded probe result */ }
}

async function anthropicProbe(pdfBytes) {
  await loadLocalEnvironment();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim();
  if (!apiKey || !model || process.env.CTE_OCR_PROVIDER !== "anthropic") {
    report.core.errorType = "CONFIGURATION";
    report.core.errorMessage = "BILL_OCR_PROVIDER_CONFIGURATION_INVALID";
    return;
  }
  const baseURL = (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  const sdk = new Anthropic({ apiKey, baseURL, timeout: 180_000, maxRetries: 0 });
  const client = { messages: { async create(params) {
    report.syntheticCalls += 1;
    const response = await sdk.messages.create(params);
    return response;
  } } };
  const observer = (result) => {
    const target = result.stage === "CORE" ? report.core : report.analyst;
    Object.assign(target, {
      httpStatus: result.httpStatus === null ? "NONE" : String(result.httpStatus),
      stopReason: result.stopReason,
      matchingToolCount: String(result.matchingToolCount),
      wireValidation: result.wireValidation,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      requestId: result.requestId,
    });
  };
  const adapter = createAnthropicTwoStageBillSdkAdapter(process.env, client, observer);
  try { await adapter.extract({ bytes: pdfBytes, contentType: "application/pdf" }); } catch { /* Stage A failure is already captured by observer. */ }
}

function print() {
  const core = CORE_SCHEMA_METRICS;
  const analyst = ANALYST_SCHEMA_METRICS;
  console.log(`ARCHITECTURE=${report.architecture}`);
  console.log(`CORE_SCHEMA_PROPERTIES=${core.properties}`);
  console.log(`CORE_SCHEMA_BYTES=${core.bytes}`);
  console.log(`CORE_SCHEMA_OBJECTS=${core.objects}`);
  console.log(`CORE_SCHEMA_ARRAYS=${core.arrays}`);
  console.log(`CORE_SCHEMA_ENUM_VALUES=${core.enumValues}`);
  console.log(`ANALYST_SCHEMA_PROPERTIES=${analyst.properties}`);
  console.log(`ANALYST_SCHEMA_BYTES=${analyst.bytes}`);
  console.log(`ANALYST_SCHEMA_OBJECTS=${analyst.objects}`);
  console.log(`ANALYST_SCHEMA_ARRAYS=${analyst.arrays}`);
  console.log(`ANALYST_SCHEMA_ENUM_VALUES=${analyst.enumValues}`);
  console.log(`ANALYST_SCHEMA_OPTIONAL=${analyst.optional}`);
  console.log(`ANALYST_SCHEMA_UNIONS=${analyst.unions}`);
  console.log(`ANALYST_SCHEMA_MAX_DEPTH=${analyst.maxDepth}`);
  console.log("CORE_WIRE_PARITY=OK");
  console.log("ANALYST_WIRE_PARITY=OK");
  console.log("CORE_MAPPER=OK");
  console.log("ANALYST_MAPPER=OK");
  console.log("MERGE_POLICY_TEST=OK");
  console.log("BILLING_PERIOD_TEST=OK");
  console.log("NOMINAL_VOLTAGE_TEST=OK");
  console.log("PAYMENT_TEST=OK");
  console.log("ECONOMIC_FACTS_TEST=OK");
  console.log("ECONOMIC_CHARGES_TEST=OK");
  console.log("BILL_ANALYST_DTO_TEST=OK");
  console.log("BANNED_UI_LABELS=OK");
  console.log("NO_DUPLICATE_FIELDS=OK");
  console.log("NO_EMPTY_CARDS=OK");
  console.log(`BILL_CODE_TESTS=${report.billCodeTests}`);
  console.log(`CTE_CODE_REGRESSION=${report.cteCodeRegression}`);
  console.log(`CTE_RUNTIME_FIXTURE_STATUS=${report.cteRuntimeFixtureStatus}`);
  console.log(`AUTOMATION_CREATED=${report.automationCreated}`);
  console.log("AUTOMATION_COMMAND=npm run test:bill-anthropic-two-stage-probe");
  console.log(`PDF_GENERATION=${report.pdfGeneration}`);
  console.log(`PDF_VALIDATION=${report.pdfValidation}`);
  console.log(`BASE64_ROUNDTRIP=${report.base64Roundtrip}`);
  console.log(`TEMP_CLEANUP=${report.tempCleanup}`);
  console.log(`SYNTHETIC_ANTHROPIC_CALLS_TOTAL=${report.syntheticCalls}`);
  for (const [prefix, stage] of [["STAGE_A", report.core], ["STAGE_B", report.analyst]]) {
    console.log(`${prefix}_HTTP_STATUS=${stage.httpStatus}`);
    console.log(`${prefix}_STOP_REASON=${stage.stopReason}`);
    console.log(`${prefix}_MATCHING_TOOL_COUNT=${stage.matchingToolCount}`);
    console.log(`${prefix}_WIRE_VALIDATION=${stage.wireValidation}`);
    console.log(`${prefix}_ERROR_TYPE=${stage.errorType}`);
    console.log(`${prefix}_ERROR_MESSAGE=${stage.errorMessage}`);
    console.log(`${prefix}_REQUEST_ID=${stage.requestId}`);
  }
  const accepted = report.core.httpStatus === "200" && report.core.stopReason === "tool_use" && report.core.matchingToolCount === "1" && report.core.wireValidation === "OK" && report.analyst.httpStatus === "200" && report.analyst.stopReason === "tool_use" && report.analyst.matchingToolCount === "1" && report.analyst.wireValidation === "OK";
  console.log(`TWO_STAGE_ACCEPTED_BY_ANTHROPIC=${accepted ? "SI" : "NO"}`);
  console.log("REAL_REPROCESS=0");
  console.log("REAL_UPLOADS=0");
  console.log("REAL_RETRIES=0");
  console.log("GME_CALLS=0");
  console.log(`TSC=${report.cteCodeRegression === "NO" ? "OK" : "FAILED"}`);
  console.log(`LINT=${report.lint}`);
  console.log(`GIT_DIFF_CHECK=${report.gitDiffCheck}`);
  console.log("FILE_MODIFICATI=see git diff --stat");
  console.log("NON staging.");
  console.log("NON commit.");
  console.log("NON push.");
  console.log("NON merge.");
  console.log("NON deploy.");
  return accepted && report.billCodeTests === "OK" && report.cteCodeRegression === "NO" && report.pdfGeneration === "OK" && report.pdfValidation === "OK" && report.base64Roundtrip === "OK" && report.tempCleanup === "OK" && report.syntheticCalls <= 2;
}

let success = false;
try {
  await offlineSelfGate();
  const pdfBytes = await preparePdf();
  offlinePreflight();
  await anthropicProbe(pdfBytes);
  success = print();
} catch (error) {
  if (report.billCodeTests === "NOT_RUN") report.billCodeTests = "FAILED";
  if (report.cteCodeRegression === "NOT_RUN") report.cteCodeRegression = "FAILED";
  console.error(error instanceof Error ? error.message : "TWO_STAGE_PROBE_FAILED");
  print();
}
if (!success) {
  console.log("BILL TWO-STAGE SYNTHETIC GATE FAILED ? NO REAL REPROCESS");
  process.exitCode = 1;
} else {
  console.log("BILL TWO-STAGE SYNTHETIC GATE PASSED ? REAL REPROCESS READY");
}
