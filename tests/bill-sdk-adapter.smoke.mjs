import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingestEnergyBill } from "../app/lib/ingestion/service.ts";
import { AnthropicBillSdkAdapter, createAnthropicBillSdkAdapter } from "../app/lib/ingestion/anthropic-bill-sdk.ts";
import { BILL_WIRE_FIELD_NAMES, BILL_WIRE_SCHEMA, BILL_WIRE_TOOL_NAME, mapBillWireToContract } from "../app/lib/ingestion/bill-wire.ts";

const env = { CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fake-key", ANTHROPIC_MODEL: "fake-model" };
const pdfWithPun = new Uint8Array(Buffer.from("%PDF-1.7\nPUN F1 0,1542 EUR/kWh PUN F2 0,1693 EUR/kWh PUN F3 0,1522 EUR/kWh\n%%EOF", "latin1"));
const found = (value) => ({ value: String(value), status: "FOUND" });
const missing = () => ({ value: "NOT_FOUND", status: "NOT_FOUND" });

function eeWire(overrides = {}) {
  return {
    schemaVersion: 1,
    vector: found("EE"), supplier: found("Supplier EE"), customerName: found("Cliente EE"), customerId: missing(), customerType: found("RESIDENTIAL"), customerTaxIdentifier: missing(),
    billingPeriod: found("2026-07-01 - 2026-07-31"), totalAmount: found("108,34"), annualConsumption: found("1944"), billedConsumption: found("241,73"),
    pod: found("IT001E12345678"), pdr: missing(), voltageLevel: found("LV"), powerKw: found("3"), f1Consumption: found("170,11"), f2Consumption: found("35,25"), f3Consumption: found("36,37"),
    smcConsumption: missing(), conversionCoefficient: missing(), pcs: missing(), offerName: found("Offerta EE"), offerCode: found("EE-001"), ...overrides,
  };
}

function gasWire(overrides = {}) {
  return {
    ...eeWire(), vector: found("GAS"), pod: missing(), pdr: found("12345678901234"), voltageLevel: missing(), powerKw: missing(), f1Consumption: missing(), f2Consumption: missing(), f3Consumption: missing(),
    smcConsumption: found("75,5"), conversionCoefficient: found("1,02"), pcs: found("38,1"), ...overrides,
  };
}

const message = (content, stop_reason = "tool_use") => ({ type: "message", role: "assistant", id: "msg_fixture", model: "fake-model", content, stop_reason, stop_details: null, stop_sequence: null, container: null, usage: { input_tokens: 1, output_tokens: 1 } });
const tool = (input, name = BILL_WIRE_TOOL_NAME) => ({ type: "tool_use", id: "tool_fixture", name, input });
const text = (value = "ignored") => ({ type: "text", text: value });

function fakeClient(response) {
  let request = null;
  return { client: { messages: { async create(params) { request = params; return response; } } }, get request() { return request; } };
}

function adapterFor(response) {
  const holder = fakeClient(response);
  return { adapter: new AnthropicBillSdkAdapter(holder.client, "fake-model", 8192), holder };
}

async function extractionFor(response) {
  return adapterFor(response).adapter.extract({ bytes: pdfWithPun, contentType: "application/pdf" });
}

for (const content of [
  [tool(eeWire())],
  [text(), tool(eeWire())],
  [text("one"), text("two"), tool(eeWire())],
]) {
  const extraction = await extractionFor(message(content));
  assert.equal(extraction.vector.value, "EE");
  assert.equal(extraction.f1Consumption.value, 170.11);
}

for (const response of [
  message([tool(eeWire(), "wrong_tool")]),
  message([text()]),
  message([tool({ schemaVersion: 1 })]),
]) await assert.rejects(() => extractionFor(response), /BILL_OCR_RESPONSE_INVALID/);

await assert.rejects(() => extractionFor(message([tool(eeWire()), tool(eeWire())])), /BILL_OCR_RESPONSE_INVALID/);
await assert.rejects(() => extractionFor(message([], "max_tokens")), /BILL_OCR_OUTPUT_TRUNCATED/);
await assert.rejects(() => extractionFor(message([], "refusal")), /BILL_OCR_PROVIDER_REFUSAL/);
for (const reason of ["end_turn", "pause_turn", "model_context_window_exceeded"]) await assert.rejects(() => extractionFor(message([], reason)), /BILL_OCR_RESPONSE_INVALID/);

const ee = await extractionFor(message([text(), tool(eeWire())]));
const gas = await extractionFor(message([tool(gasWire())]));
assert.equal(ee.customerId.value, null);
assert.equal(ee.f1Consumption.value, 170.11);
assert.equal(ee.f2Consumption.value, 35.25);
assert.equal(ee.f3Consumption.value, 36.37);
assert.equal(ee.f1Consumption.status, "FOUND");
assert.equal(ee.f1Consumption.source, "DOCUMENT_AI");
assert.equal(gas.vector.value, "GAS");
assert.equal(gas.pdr.value, "12345678901234");
assert.equal(gas.smcConsumption.value, 75.5);
assert.equal(gas.conversionCoefficient.value, 1.02);

const eeContract = mapBillWireToContract({ extraction: ee, tenantId: "tenant_alpha", billId: "bill-ee", versionId: "v1" });
assert.equal(eeContract.vector, "EE");
assert.equal(eeContract.consumption.f1.unit, "KWH");
assert.equal(eeContract.consumption.f1.value, 170.11);
assert.equal(eeContract.consumption.f2.value, 35.25);
assert.equal(eeContract.consumption.f3.value, 36.37);
assert.equal(eeContract.consumption.f1.value === 0.1542, false);
assert.equal(mapBillWireToContract({ extraction: gas, tenantId: "tenant_alpha", billId: "bill-gas", versionId: "v1" }).consumption.smc.value, 75.5);

const holder = fakeClient(message([tool(eeWire({ customerName: missing(), f2Consumption: { value: "NOT_FOUND", status: "NEEDS_REVIEW" } }))]));
const capturedAdapter = new AnthropicBillSdkAdapter(holder.client, "fake-model", 8192);
const captured = await capturedAdapter.extract({ bytes: pdfWithPun, contentType: "application/pdf" });
assert.equal(captured.customerName.status, "NOT_FOUND");
assert.equal(captured.f2Consumption.status, "NEEDS_REVIEW");
assert.equal(holder.request.tools.length, 1);
assert.equal(holder.request.tools[0].name, BILL_WIRE_TOOL_NAME);
assert.deepEqual(holder.request.tools[0].input_schema, BILL_WIRE_SCHEMA);
assert.deepEqual(holder.request.tool_choice, { type: "tool", name: BILL_WIRE_TOOL_NAME, disable_parallel_tool_use: true });
assert.deepEqual(holder.request.thinking, { type: "disabled" });
assert.deepEqual([...BILL_WIRE_FIELD_NAMES].filter((name) => name !== "customerId"), holder.request.tools[0].input_schema.required.slice(1));

const root = await mkdtemp(path.join(os.tmpdir(), "bill-sdk-adapter-"));
try {
  const result = await ingestEnergyBill({ tenantId: "tenant_alpha", fileName: "fixture.pdf", contentType: "application/pdf", bytes: pdfWithPun, maxBytes: 1_000_000, documentsRoot: root, localDev: "true", structuredProvider: { async extract() { return ee; } } });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.document.versions.at(-1).structuredBill.customerId.status, "NOT_FOUND");
  assert.equal(result.document.versions.at(-1).structuredBill.f1Consumption.value, 170.11);
} finally { await rm(root, { recursive: true, force: true }); }

const configured = createAnthropicBillSdkAdapter(env, fakeClient(message([tool(eeWire())])).client);
assert.equal(configured instanceof AnthropicBillSdkAdapter, true);
console.log("bill SDK adapter smoke: ok (typed content selection, wire single source, EE/GAS mapping, missing values, PUN separation and review state)");
