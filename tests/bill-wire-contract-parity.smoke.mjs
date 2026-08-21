import assert from "node:assert/strict";
import {
  BILL_WIRE_FIELD_NAMES,
  BILL_WIRE_SCHEMA,
  BILL_WIRE_STATUS_VALUES,
  BILL_WIRE_TOOL_NAME,
  BILL_WIRE_VECTOR_VALUES,
  mapBillWireToStructuredBill,
  parseBillWireExtraction,
} from "../app/lib/ingestion/bill-wire.ts";
import { AnthropicBillSdkAdapter } from "../app/lib/ingestion/anthropic-bill-sdk.ts";

const numericFields = new Set(["totalAmount", "annualConsumption", "billedConsumption", "powerKw", "f1Consumption", "f2Consumption", "f3Consumption", "smcConsumption", "conversionCoefficient", "pcs"]);

function jsonType(value) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function schemaAccepts(value, schema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (schema.type === "string") return typeof value === "string";
  if (schema.type !== "object" || jsonType(value) !== "object") return false;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  if (Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false;
  if ([...required].some((key) => !Object.hasOwn(value, key))) return false;
  return Object.entries(value).every(([key, child]) => schemaAccepts(child, properties[key]));
}

function generatedWire({ status = "FOUND", vector = "EE", omitCustomerId = false, emptyCustomerName = false } = {}) {
  const wire = { schemaVersion: 1 };
  for (const name of BILL_WIRE_FIELD_NAMES) {
    if (name === "customerId" && omitCustomerId) continue;
    let value = "document value";
    if (name === "vector") value = vector;
    else if (name === "customerType") value = vector === "UNKNOWN" ? "UNKNOWN" : "RESIDENTIAL";
    else if (name === "voltageLevel") value = vector === "UNKNOWN" ? "UNKNOWN" : "LV";
    else if (name === "billingPeriod") value = "01/06/2026 - 30/06/2026";
    else if (name === "pod") value = vector === "GAS" ? "NOT_FOUND" : "IT001E12345678";
    else if (name === "pdr") value = vector === "GAS" ? "12345678901234" : "NOT_FOUND";
    else if (numericFields.has(name)) value = status === "INVALID" ? "not-a-number" : "8.972 kWh";
    else if (name === "customerName" && emptyCustomerName) value = "";
    else if (status === "NOT_FOUND") value = "NOT_FOUND";
    else if (status === "NEEDS_REVIEW" && ["vector", "customerType", "voltageLevel"].includes(name)) value = "UNKNOWN";
    wire[name] = { value, status };
  }
  return wire;
}

for (const status of BILL_WIRE_STATUS_VALUES) {
  const example = generatedWire({ status, vector: status === "NEEDS_REVIEW" ? "UNKNOWN" : "EE", omitCustomerId: true });
  assert.equal(schemaAccepts(example, BILL_WIRE_SCHEMA), true, `schema example rejected for ${status}`);
  assert.doesNotThrow(() => parseBillWireExtraction(example));
  assert.doesNotThrow(() => mapBillWireToStructuredBill(example));
}

for (const vector of BILL_WIRE_VECTOR_VALUES) {
  const example = generatedWire({ vector, status: vector === "UNKNOWN" ? "NEEDS_REVIEW" : vector === "NOT_FOUND" ? "NOT_FOUND" : "FOUND", omitCustomerId: true });
  assert.equal(schemaAccepts(example, BILL_WIRE_SCHEMA), true, `schema example rejected for ${vector}`);
  assert.doesNotThrow(() => parseBillWireExtraction(example));
}

const emptyWire = generatedWire({ omitCustomerId: true, emptyCustomerName: true });
assert.equal(schemaAccepts(emptyWire, BILL_WIRE_SCHEMA), true);
assert.doesNotThrow(() => parseBillWireExtraction(emptyWire));
assert.equal(mapBillWireToStructuredBill(emptyWire).customerName.status, "INVALID");

const normalized = generatedWire({ omitCustomerId: true });
const normalizedExtraction = mapBillWireToStructuredBill(normalized);
assert.equal(normalizedExtraction.customerId.status, "NOT_FOUND");
assert.equal(normalizedExtraction.f1Consumption.value, 8972);
assert.equal(normalizedExtraction.billingPeriod.value.from, "2026-06-01");
assert.equal(normalizedExtraction.totalAmount.value, 8972);

for (const [raw, from, to] of [["01/06/2026 - 30/06/2026", "2026-06-01", "2026-06-30"], ["01.06.2026 - 30.06.2026", "2026-06-01", "2026-06-30"], ["01-06-2026 - 30-06-2026", "2026-06-01", "2026-06-30"], ["01/06/2026 al 30/06/2026", "2026-06-01", "2026-06-30"], ["dal 01/06/2026 al 30/06/2026", "2026-06-01", "2026-06-30"], ["06/2026", "2026-06-01", "2026-07-01"], ["Giugno 2026", "2026-06-01", "2026-07-01"]]) {
  const candidate = generatedWire({ omitCustomerId: true });
  candidate.billingPeriod = { value: raw, status: "FOUND" };
  const parsedPeriod = mapBillWireToStructuredBill(candidate).billingPeriod;
  assert.equal(parsedPeriod.status, "FOUND");
  assert.equal(parsedPeriod.value.from, from);
  assert.equal(parsedPeriod.value.to, to);
  assert.equal(parsedPeriod.value.raw, raw);
}
console.log("BILLING_PERIOD_FORMATS=OK");

const pun = generatedWire({ omitCustomerId: true });
pun.f1Consumption = { value: "0,1542 €/kWh", status: "FOUND" };
assert.equal(schemaAccepts(pun, BILL_WIRE_SCHEMA), true);
assert.equal(mapBillWireToStructuredBill(pun).f1Consumption.status, "INVALID");

const validEe = generatedWire({ omitCustomerId: true });
validEe.vector = { value: "EE", status: "FOUND" };
validEe.customerType = { value: "RESIDENTIAL", status: "FOUND" };
validEe.voltageLevel = { value: "LV", status: "FOUND" };
validEe.billingPeriod = { value: "2026-06-01 - 2026-06-30", status: "FOUND" };
validEe.pod = { value: "IT001E12345678", status: "FOUND" };
validEe.pdr = { value: "NOT_FOUND", status: "NOT_FOUND" };
const holder = { request: null };
const adapter = new AnthropicBillSdkAdapter({ messages: { async create(params) { holder.request = params; return { type: "message", role: "assistant", content: [{ type: "tool_use", id: "fixture", name: BILL_WIRE_TOOL_NAME, input: validEe }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } }; } } }, "fake-model", 8192);
const extraction = await adapter.extract({ bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf" });
assert.equal(extraction.f1Consumption.value, 8972);
assert.equal(holder.request.tools[0].strict, true);
assert.equal(holder.request.tools[0].input_schema.required.includes("customerId"), false);

console.log("bill wire contract parity smoke: ok (schema-generated statuses, enums, optional customerId, OCR normalization, PUN separation and SDK parity)");
