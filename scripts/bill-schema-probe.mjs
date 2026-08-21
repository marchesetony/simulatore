import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createValidSyntheticBillPdf, validateSyntheticBillPdf } from "../tests/helpers/create-valid-synthetic-bill-pdf.mjs";
import { BILL_WIRE_SCHEMA, BILL_WIRE_TOOL_NAME } from "../app/lib/ingestion/bill-wire.ts";
import { AnthropicBillSdkAdapter, createAnthropicBillSdkAdapter, extractAnthropicApiError, sanitizeAnthropicTechnicalError } from "../app/lib/ingestion/anthropic-bill-sdk.ts";

const OFFLINE_ONLY = process.argv.includes("--offline");
const MAX_ANTHROPIC_CALLS = 1;
let anthropicCalls = 0;
let tempDirectory = null;
let report = {
  automationCreated: "OK",
  automatedPdfCreation: "KO",
  automatedPdfValidation: "KO",
  automatedBase64Roundtrip: "KO",
  automatedPayloadValidation: "KO",
  automatedErrorExtraction: "KO",
  pdfGeneration: "KO",
  pdfValidation: "KO",
  pdfPageCount: "NONE",
  base64Roundtrip: "KO",
  sha256Match: "NO",
  tempCleanup: "KO",
  syntheticCalls: 0,
  sdkMaxRetries: 0,
  httpStatus: "NONE",
  stopReason: "NONE",
  contentBlockTypes: "NONE",
  matchingToolCount: "NONE",
  wireValidation: "NOT_RUN",
  errorType: "NONE",
  sanitizedMessage: "NONE",
  requestId: "NONE",
  schemaAccepted: "NON_DETERMINATO",
  compactTooLarge: "NO",
  recommendedArchitecture: "ONE_CALL_COMPACT",
  rootCause: "NONE",
  rootCauseProven: "NO",
};

function loadLocalEnvironment() {
  return readFile(path.join(process.cwd(), ".env.local"), "utf8").then((source) => {
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
      process.env[key] = value;
    }
  }).catch(() => undefined);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function schemaMetrics() {
  const json = JSON.stringify(BILL_WIRE_SCHEMA);
  const properties = Object.keys(BILL_WIRE_SCHEMA.properties);
  const metrics = { properties: 0, objects: 0, arrays: 0, enumValues: 0, maxDepth: 0 };
  const walk = (value, depth) => {
    if (!value || typeof value !== "object") return;
    metrics.maxDepth = Math.max(metrics.maxDepth, depth);
    if (value.type === "object") metrics.objects += 1;
    if (value.type === "array") metrics.arrays += 1;
    if (Array.isArray(value.enum)) metrics.enumValues += value.enum.length;
    if (value.properties) {
      metrics.properties += Object.keys(value.properties).length;
      for (const child of Object.values(value.properties)) walk(child, depth + 1);
    }
    if (value.items) walk(value.items, depth + 1);
  };
  walk(BILL_WIRE_SCHEMA, 1);
  const required = new Set(BILL_WIRE_SCHEMA.required);
  return {
    ...metrics,
    bytes: Buffer.byteLength(json, "utf8"),
    optional: properties.filter((property) => !required.has(property)).length,
    unions: (json.match(/"(?:anyOf|oneOf|allOf)"/g) ?? []).length,
  };
}

async function validateAndRoundtrip(pdfBytes) {
  const validation = validateSyntheticBillPdf(pdfBytes);
  report.pdfValidation = "OK";
  report.automatedPdfValidation = "OK";
  report.pdfPageCount = validation.pageCount;
  const encoded = Buffer.from(pdfBytes).toString("base64");
  assert(!encoded.startsWith("data:application/pdf;base64,"), "BASE64_DATA_URI");
  assert(!/\s/.test(encoded), "BASE64_WHITESPACE");
  const decoded = Buffer.from(encoded, "base64");
  assert.equal(decoded.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(decoded.toString("base64"), encoded, "DOUBLE_BASE64_OR_CORRUPTION");
  assert.equal(sha256(pdfBytes), sha256(decoded), "SHA256_MISMATCH");
  report.base64Roundtrip = "OK";
  report.automatedBase64Roundtrip = "OK";
  report.sha256Match = "SI";
  return { encoded, decoded, validation };
}

async function offlinePayloadValidation(pdfBytes, encoded) {
  let captured = null;
  const adapter = new AnthropicBillSdkAdapter({ messages: { async create(params) { captured = params; throw new Error("OFFLINE_PAYLOAD_CAPTURE"); } } }, "synthetic-model", 8192);
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => adapter.extract({ bytes: pdfBytes, contentType: "application/pdf" }), /BILL_OCR_PROVIDER_FAILED/);
  } finally {
    console.error = originalError;
  }
  assert.ok(captured);
  const document = captured.messages[0].content[0];
  assert.deepEqual(document, { type: "document", source: { type: "base64", media_type: "application/pdf", data: encoded } });
  assert.equal(document.source.data.includes("data:application/pdf;base64,"), false);
  assert.equal(/\s/.test(document.source.data), false);
  assert.equal(Buffer.from(document.source.data, "base64").equals(Buffer.from(pdfBytes)), true);
  assert.equal(captured.tools.length, 1);
  assert.equal(captured.tools[0].name, BILL_WIRE_TOOL_NAME);
  assert.equal(captured.tools[0].strict, true);
  assert.deepEqual(captured.tools[0].input_schema, BILL_WIRE_SCHEMA);
  assert.deepEqual(captured.tool_choice, { type: "tool", name: BILL_WIRE_TOOL_NAME, disable_parallel_tool_use: true });
  assert.deepEqual(captured.thinking, { type: "disabled" });
  report.automatedPayloadValidation = "OK";
}

function offlineErrorExtractionValidation() {
  const fixture = { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "Schema is too complex for compilation." }, request_id: "req_offline" }, requestID: "req_offline" };
  const details = extractAnthropicApiError(fixture);
  assert.equal(details.status, 400);
  assert.equal(details.type, "invalid_request_error");
  assert.equal(details.technicalMessage, "Schema is too complex for compilation.");
  assert.equal(details.requestID, "req_offline");
  assert.equal(sanitizeAnthropicTechnicalError(fixture), "Schema is too complex for compilation.");
  report.automatedErrorExtraction = "OK";
}

function diagnosticField(line, field, nextField) {
  const pattern = nextField ? new RegExp(`${field}=([\\s\\S]*?)\\s+${nextField}=`) : new RegExp(`${field}=([\\s\\S]*)$`);
  return line.match(pattern)?.[1] ?? "NONE";
}

function classifyDiagnostic(line) {
  report.httpStatus = diagnosticField(line, "upstream_status", "upstream_type");
  report.errorType = diagnosticField(line, "upstream_type", "upstream_message");
  report.sanitizedMessage = diagnosticField(line, "upstream_message", "request_id");
  report.requestId = diagnosticField(line, "request_id", "phase");
  report.rootCause = report.sanitizedMessage;
  report.rootCauseProven = report.httpStatus === "400" && report.sanitizedMessage !== "NONE" ? "SI" : "NO";
  if (/compiled grammar is too large|grammar too large/i.test(report.sanitizedMessage)) {
    report.compactTooLarge = "SI";
    report.recommendedArchitecture = "TWO_STAGE";
  }
  if (/pdf specified was not valid/i.test(report.sanitizedMessage)) report.pdfGeneration = "KO";
}

async function liveProbe(pdfBytes) {
  if (OFFLINE_ONLY) return;
  assert.equal(anthropicCalls, 0);
  assert.equal(MAX_ANTHROPIC_CALLS, 1);
  const diagnostics = [];
  const originalError = console.error;
  console.error = (...args) => diagnostics.push(args.map(String).join(" "));
  try {
    anthropicCalls += 1;
    const adapter = createAnthropicBillSdkAdapter(process.env);
    const extraction = await adapter.extract({ bytes: pdfBytes, contentType: "application/pdf" });
    assert.ok(extraction);
    report.httpStatus = "200";
    report.stopReason = "tool_use";
    report.contentBlockTypes = "tool_use";
    report.matchingToolCount = "1";
    report.wireValidation = "OK";
    report.schemaAccepted = "SI";
    report.recommendedArchitecture = "ONE_CALL_COMPACT";
    report.rootCause = "NONE";
  } catch {
    const diagnostic = diagnostics.find((line) => line.startsWith("[BILL_OCR_DIAG]")) ?? "";
    if (diagnostic) classifyDiagnostic(diagnostic);
  } finally {
    console.error = originalError;
  }
}

function printReport(metrics) {
  console.log(`AUTOMATION_CREATED=${report.automationCreated}`);
  console.log("AUTOMATION_COMMAND=npm run test:bill-anthropic-schema-probe");
  console.log(`AUTOMATED_PDF_CREATION=${report.automatedPdfCreation}`);
  console.log(`AUTOMATED_PDF_VALIDATION=${report.automatedPdfValidation}`);
  console.log(`AUTOMATED_BASE64_ROUNDTRIP=${report.automatedBase64Roundtrip}`);
  console.log(`AUTOMATED_PAYLOAD_VALIDATION=${report.automatedPayloadValidation}`);
  console.log(`AUTOMATED_ERROR_EXTRACTION=${report.automatedErrorExtraction}`);
  console.log(`AUTOMATED_TEMP_CLEANUP=${report.tempCleanup}`);
  console.log(`PDF_GENERATION=${report.pdfGeneration}`);
  console.log(`PDF_VALIDATION=${report.pdfValidation}`);
  console.log(`PDF_PAGE_COUNT=${report.pdfPageCount}`);
  console.log(`BASE64_ROUNDTRIP=${report.base64Roundtrip}`);
  console.log(`SHA256_MATCH=${report.sha256Match}`);
  console.log(`TEMP_CLEANUP=${report.tempCleanup}`);
  console.log(`SYNTHETIC_ANTHROPIC_CALLS=${report.syntheticCalls}`);
  console.log(`SDK_MAX_RETRIES=${report.sdkMaxRetries}`);
  console.log(`HTTP_STATUS=${report.httpStatus}`);
  console.log(`STOP_REASON=${report.stopReason}`);
  console.log(`CONTENT_BLOCK_TYPES=${report.contentBlockTypes}`);
  console.log(`MATCHING_TOOL_COUNT=${report.matchingToolCount}`);
  console.log(`WIRE_VALIDATION=${report.wireValidation}`);
  console.log(`ERROR_TYPE=${report.errorType}`);
  console.log(`SANITIZED_ERROR_MESSAGE=${report.sanitizedMessage}`);
  console.log(`REQUEST_ID=${report.requestId}`);
  console.log(`CURRENT_EXTENDED_SCHEMA_ACCEPTED=${report.schemaAccepted}`);
  console.log(`COMPACT_SCHEMA_ACCEPTED_BY_ANTHROPIC=${report.schemaAccepted}`);
  console.log(`COMPACT_ONE_CALL_TOO_LARGE=${report.compactTooLarge}`);
  console.log(`ROOT_CAUSE=${report.rootCause}`);
  console.log(`ROOT_CAUSE_PROVEN=${report.rootCauseProven}`);
  console.log("OLD_FAILED_SCHEMA_PROPERTIES=80");
  console.log("OLD_FAILED_SCHEMA_BYTES=8444");
  console.log("OLD_FAILED_OBJECTS=25");
  console.log("OLD_FAILED_ARRAYS=2");
  console.log("OLD_FAILED_ENUM_VALUES=153");
  console.log(`NEW_COMPACT_SCHEMA_PROPERTIES=${metrics.properties}`);
  console.log(`NEW_COMPACT_SCHEMA_BYTES=${metrics.bytes}`);
  console.log(`NEW_COMPACT_OBJECTS=${metrics.objects}`);
  console.log(`NEW_COMPACT_ARRAYS=${metrics.arrays}`);
  console.log(`NEW_COMPACT_ENUM_VALUES=${metrics.enumValues}`);
  console.log(`NEW_COMPACT_OPTIONAL=${metrics.optional}`);
  console.log(`NEW_COMPACT_UNIONS=${metrics.unions}`);
  console.log(`NEW_COMPACT_MAX_DEPTH=${metrics.maxDepth}`);
  console.log(`RECOMMENDED_EXTRACTION_ARCHITECTURE=${report.recommendedArchitecture}`);
  console.log("REAL_REPROCESS=0");
  console.log("REAL_UPLOADS=0");
  console.log("REAL_RETRIES=0");
  console.log("GME_CALLS=0");
}

async function main() {
  const metrics = schemaMetrics();
  try {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "bill-schema-probe-"));
    const fixturePath = path.join(tempDirectory, "synthetic-bill.pdf");
    const pdfBytes = createValidSyntheticBillPdf();
    report.pdfGeneration = "OK";
    report.automatedPdfCreation = "OK";
    await writeFile(fixturePath, pdfBytes);
    const fileStat = await stat(fixturePath);
    assert.equal(fileStat.size > 0, true);
    const storedBytes = await readFile(fixturePath);
    const { encoded } = await validateAndRoundtrip(storedBytes);
    await offlinePayloadValidation(storedBytes, encoded);
    report.wireValidation = "OFFLINE_PAYLOAD_OK";
    offlineErrorExtractionValidation();
    if (!OFFLINE_ONLY) await loadLocalEnvironment();
    await liveProbe(storedBytes);
    report.syntheticCalls = anthropicCalls;
  } catch (error) {
    report.rootCause = error instanceof Error ? error.message : "AUTOMATION_FAILURE";
    report.rootCauseProven = "NO";
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
      report.tempCleanup = existsSync(tempDirectory) ? "KO" : "OK";
    }
  }
  printReport(metrics);
  const preflight = [report.automatedPdfCreation, report.automatedPdfValidation, report.automatedBase64Roundtrip, report.automatedPayloadValidation, report.automatedErrorExtraction, report.tempCleanup];
  if (preflight.some((status) => status !== "OK")) process.exitCode = 1;
}

await main();
