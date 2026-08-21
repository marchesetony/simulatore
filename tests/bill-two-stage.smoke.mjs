import assert from "node:assert/strict";
import { buildBillAnalystReview } from "../app/lib/foundation/bill-analyst-review.ts";
import { ANALYST_SCHEMA_METRICS, ANALYST_WIRE_SCHEMA, ANALYST_WIRE_TOOL, BILL_ANALYST_TOOL_NAME, BILL_CORE_TOOL_NAME, CORE_SCHEMA_METRICS, CORE_WIRE_SCHEMA, CORE_WIRE_TOOL, mapBillAnalystItems, mapBillCoreToStructuredBill, mergeBillCoreAndAnalyst } from "../app/lib/ingestion/bill-two-stage.ts";
import { AnthropicBillSdkError, AnthropicTwoStageBillSdkAdapter } from "../app/lib/ingestion/anthropic-bill-sdk.ts";
import { BILL_WIRE_FIELD_NAMES } from "../app/lib/ingestion/bill-wire.ts";

const found = (value) => ({ value: String(value), status: "FOUND" });
const missing = () => ({ value: "NOT_FOUND", status: "NOT_FOUND" });
const coreWire = (overrides = {}) => {
  const wire = { schemaVersion: 1 };
  for (const name of BILL_WIRE_FIELD_NAMES) wire[name] = name === "vector" ? found("EE") : name === "customerType" ? found("RESIDENTIAL") : name === "voltageLevel" ? found("LV") : name === "billingPeriod" ? found("01/07/2026 - 31/07/2026") : name === "pod" ? found("IT001E12345678") : ["totalAmount", "annualConsumption", "billedConsumption", "powerKw", "f1Consumption", "f2Consumption", "f3Consumption"].includes(name) ? found("80") : missing();
  delete wire.customerId;
  return { ...wire, ...overrides };
};
const analystWire = (items) => ({ schemaVersion: "1", items });
const analystItem = (overrides = {}) => ({ kind: "FACT", code: "UNKNOWN", label: "", value: "", unit: "", quantity: "", unitPrice: "", amount: "", period: "", status: "FOUND", ...overrides });
const tool = (name, input) => ({ type: "tool_use", id: `${name}-fixture`, name, input });
const message = (content, stop_reason = "tool_use") => ({ type: "message", role: "assistant", content, stop_reason, usage: { input_tokens: 1, output_tokens: 1 } });

assert.equal(CORE_WIRE_TOOL.name, BILL_CORE_TOOL_NAME);
assert.equal(ANALYST_WIRE_TOOL.name, BILL_ANALYST_TOOL_NAME);
assert.equal(CORE_WIRE_TOOL.strict, true);
assert.equal(ANALYST_WIRE_TOOL.strict, true);
assert.equal(Object.hasOwn(CORE_WIRE_SCHEMA.properties, "analystItems"), false);
assert.deepEqual(ANALYST_WIRE_SCHEMA.required, ["schemaVersion", "items"]);
assert.deepEqual(ANALYST_WIRE_SCHEMA.properties.items.items.required, ["kind", "code", "label", "value", "unit", "quantity", "unitPrice", "amount", "period", "status"]);
assert.equal(ANALYST_SCHEMA_METRICS.enumValues, 0);
assert.equal(ANALYST_SCHEMA_METRICS.optional, 0);
assert.equal(ANALYST_SCHEMA_METRICS.unions, 0);
assert.ok(ANALYST_SCHEMA_METRICS.bytes < 7428);
assert.ok(ANALYST_SCHEMA_METRICS.bytes < CORE_SCHEMA_METRICS.bytes);

const core = mapBillCoreToStructuredBill(coreWire());
assert.equal(core.f1Consumption.value, 80);
assert.equal(core.extendedFacts.length, 0);
assert.equal(core.economicChargeLines.length, 0);
const analyst = analystWire([
  analystItem({ code: "SUPPLY_ADDRESS", value: "Via Sintetica 1" }),
  analystItem({ code: "NOMINAL_VOLTAGE", value: "230", unit: "v" }),
  analystItem({ code: "BILLING_PERIOD_RAW", value: "01/07/2026 - 31/07/2026" }),
  analystItem({ code: "PAYMENT_METHOD", value: "Addebito diretto" }),
  analystItem({ code: "PUN_F1", value: "0,15000", unit: "€/kWh" }),
  analystItem({ kind: "CHARGE", code: "NETWORK_SYSTEM", label: "Rete e sistema", value: "12,30", quantity: "220", unit: "kWh", unitPrice: "0,0559", amount: "12,30" }),
]);
const mappedAnalyst = mapBillAnalystItems(analyst);
assert.equal(mappedAnalyst.facts.find((item) => item.code === "NOMINAL_VOLTAGE").value, "230");
assert.equal(mappedAnalyst.facts.find((item) => item.code === "PUN_F1").value, "0,15000");
assert.equal(mappedAnalyst.charges[0].description, "Rete e sistema");
assert.equal(mappedAnalyst.charges[0].quantity, "220");
assert.equal(mappedAnalyst.charges[0].unit, "KWH");
assert.equal(mappedAnalyst.charges[0].unitPrice, "0,0559");
assert.equal(mappedAnalyst.charges[0].amount, "12,30");

const merged = mergeBillCoreAndAnalyst(core, analyst);
assert.equal(merged.billingPeriod.value.from, "2026-07-01");
assert.equal(merged.billingPeriod.value.to, "2026-07-31");
assert.equal(merged.billingPeriod.value.raw, "01/07/2026 - 31/07/2026");
assert.equal(merged.f1Consumption.value, 80);
assert.equal(merged.extendedFacts.find((item) => item.code === "SUPPLY_ADDRESS").value, "Via Sintetica 1");
assert.equal(merged.economicChargeLines[0].code, "NETWORK_SYSTEM");
assert.equal(merged.analystExtractionStatus, "EXTRACTED");

const coreWithoutPeriod = mapBillCoreToStructuredBill(coreWire({ billingPeriod: missing() }));
const periodFromAnalyst = mergeBillCoreAndAnalyst(coreWithoutPeriod, analyst);
assert.equal(periodFromAnalyst.billingPeriod.value.from, "2026-07-01");
assert.equal(periodFromAnalyst.billingPeriod.value.to, "2026-07-31");
const failedAnalyst = mergeBillCoreAndAnalyst(core, null, { analystExtractionStatus: "FAILED", diagnostic: { code: "BILL_OCR_PROVIDER_FAILED", requestId: null, message: "bounded" } });
assert.equal(failedAnalyst.f1Consumption.value, 80);
assert.equal(failedAnalyst.analystExtractionStatus, "FAILED");

let requests = [];
const client = { messages: { async create(params) { requests.push(params); return requests.length === 1 ? message([tool(BILL_CORE_TOOL_NAME, coreWire())]) : message([tool(BILL_ANALYST_TOOL_NAME, analyst)]); } } };
const adapter = new AnthropicTwoStageBillSdkAdapter(client, "synthetic-model", 8192);
const extracted = await adapter.extract({ bytes: new Uint8Array(Buffer.from("%PDF-1.4 synthetic", "ascii")), contentType: "application/pdf" });
assert.equal(requests.length, 2);
assert.equal(requests[0].tools.length, 1);
assert.equal(requests[0].tools[0].name, BILL_CORE_TOOL_NAME);
assert.equal(requests[1].tools.length, 1);
assert.equal(requests[1].tools[0].name, BILL_ANALYST_TOOL_NAME);
assert.match(requests[1].messages[0].content[1].text, /Scansiona l'intero documento/);
assert.match(requests[1].messages[0].content[1].text, /kind FACT/);
assert.match(requests[1].messages[0].content[1].text, /kind CHARGE/);
assert.match(requests[1].messages[0].content[1].text, /UNKNOWN o INVALID/);
assert.match(requests[1].messages[0].content[1].text, /PUN_SINGLE\/PUN_F1\/PUN_F2\/PUN_F3/);
assert.equal(extracted.analystExtractionStatus, "EXTRACTED");

let failedCalls = 0;
const coreOnlyAdapter = new AnthropicTwoStageBillSdkAdapter({ messages: { async create() { failedCalls += 1; if (failedCalls === 1) return message([tool(BILL_CORE_TOOL_NAME, coreWire())]); throw new AnthropicBillSdkError("BILL_OCR_PROVIDER_FAILED", "req_b"); } } }, "synthetic-model", 8192);
const coreOnly = await coreOnlyAdapter.extract({ bytes: new Uint8Array(Buffer.from("%PDF-1.4 synthetic", "ascii")), contentType: "application/pdf" });
assert.equal(failedCalls, 2);
assert.equal(coreOnly.f1Consumption.value, 80);
assert.equal(coreOnly.analystExtractionStatus, "FAILED");
assert.equal(coreOnly.analystDiagnostic.code, "BILL_OCR_PROVIDER_FAILED");

const dto = buildBillAnalystReview({ id: "bill-two-stage", fileName: "synthetic.pdf", status: "REVIEW_REQUIRED", reviewState: "WORKING", currentVersionNumber: 1, approvalReady: false, updatedAt: "2026-08-17T00:00:00.000Z", fields: { supplier: { value: null, confidence: 0, source: "unavailable", confirmed: false }, pod: { value: null, confidence: 0, source: "unavailable", confirmed: false }, customerName: { value: null, confidence: 0, source: "unavailable", confirmed: false }, billingPeriod: { value: null, confidence: 0, source: "unavailable", confirmed: false }, annualConsumption: { value: null, confidence: 0, source: "unavailable", confirmed: false }, billedConsumption: { value: null, confidence: 0, source: "unavailable", confirmed: false }, totalAmount: { value: null, confidence: 0, source: "unavailable", confirmed: false } }, normalized: null, structuredBill: coreOnly, resolvedVector: "EE", invoicePunReferences: [] });
assert.equal(dto.document.fileName, "synthetic.pdf");
assert.equal(dto.document.status, "REVIEW_REQUIRED");
assert.equal(dto.document.analystExtractionStatus, "FAILED");
assert.ok(dto.dates.billingPeriodStart);
assert.ok(dto.payment);
assert.ok(dto.economics);

console.log("bill two-stage smoke: ok (core/analyst wire parity, complexity, mappers, merge precedence, billing period, voltage, payment, economics, charges, DTO and independent failure policy)");
