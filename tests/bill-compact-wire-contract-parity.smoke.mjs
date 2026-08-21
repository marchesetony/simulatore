import assert from "node:assert/strict";
import { BILL_WIRE_ANALYST_ITEM_KINDS, BILL_WIRE_FIELD_NAMES, BILL_WIRE_SCHEMA, BILL_WIRE_STATUS_VALUES, BILL_WIRE_TOOL, mapBillWireToStructuredBill, parseBillWireExtraction } from "../app/lib/ingestion/bill-wire.ts";
import { normalizeAnalystItemCode } from "../app/lib/ingestion/bill-extended-contract.ts";

const found = (value) => ({ value, status: "FOUND" });
const missing = () => ({ value: "NOT_FOUND", status: "NOT_FOUND" });
const core = () => {
  const wire = { schemaVersion: 1 };
  for (const name of BILL_WIRE_FIELD_NAMES) {
    if (name === "customerId") continue;
    wire[name] = name === "vector" ? found("EE") : name === "customerType" ? found("RESIDENTIAL") : name === "voltageLevel" ? found("LV") : name === "billingPeriod" ? found("01/07/2026 - 31/07/2026") : name === "pod" ? found("IT001E12345678") : name === "pdr" ? missing() : ["totalAmount", "annualConsumption", "billedConsumption", "powerKw", "f1Consumption", "f2Consumption", "f3Consumption"].includes(name) ? found("80") : missing();
  }
  return wire;
};
const item = (overrides = {}) => ({ kind: "FACT", code: "UNKNOWN", value: "", unit: "", description: "", period: "", status: "FOUND", ...overrides });
const wire = { ...core(), analystItems: [item({ code: "SUPPLY_ADDRESS", value: "Via sintetica 1" }), item({ kind: "CHARGE", code: "seller spread", value: "0,0125", unit: "EUR/kWh", description: "Spread venditore" })] };

function accepts(value, schema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "array") return Array.isArray(value) && value.every((child) => accepts(child, schema.items));
  if (schema.type !== "object" || value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  if (Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false;
  if ([...required].some((key) => !Object.hasOwn(value, key))) return false;
  return Object.entries(value).every(([key, child]) => accepts(child, properties[key]));
}

assert.equal(BILL_WIRE_TOOL.strict, true);
assert.equal(Object.hasOwn(BILL_WIRE_SCHEMA.properties, "extendedFacts"), false);
assert.equal(Object.hasOwn(BILL_WIRE_SCHEMA.properties, "economicChargeLines"), false);
assert.equal(BILL_WIRE_SCHEMA.properties.analystItems.items.properties.code.type, "string");
assert.equal(Object.hasOwn(BILL_WIRE_SCHEMA.properties.analystItems.items.properties.code, "enum"), false);
assert.equal(accepts(wire, BILL_WIRE_SCHEMA), true);
assert.doesNotThrow(() => parseBillWireExtraction(wire));
assert.doesNotThrow(() => mapBillWireToStructuredBill(wire));

for (const status of BILL_WIRE_STATUS_VALUES) {
  const candidate = { ...core(), analystItems: [item({ status, value: status === "NOT_FOUND" ? "NOT_FOUND" : "" })] };
  assert.equal(accepts(candidate, BILL_WIRE_SCHEMA), true);
  assert.doesNotThrow(() => parseBillWireExtraction(candidate), status);
}
for (const kind of BILL_WIRE_ANALYST_ITEM_KINDS) {
  const candidate = { ...core(), analystItems: [item({ kind, description: "" })] };
  assert.doesNotThrow(() => parseBillWireExtraction(candidate), kind);
}

const unknown = mapBillWireToStructuredBill({ ...core(), analystItems: [item({ code: "future component", value: "x" })] });
assert.equal(unknown.extendedFacts[0].code, "UNKNOWN");
assert.equal(normalizeAnalystItemCode("spread"), "SPREAD");
assert.equal(normalizeAnalystItemCode("seller spread"), "SPREAD");
assert.equal(normalizeAnalystItemCode("dispacciamento"), "DISPATCHING");
assert.equal(normalizeAnalystItemCode("future component"), "UNKNOWN");

const mapped = mapBillWireToStructuredBill(wire);
assert.equal(mapped.economicChargeLines[0].code, "SPREAD");
assert.equal(mapped.economicChargeLines[0].description, "Spread venditore");
assert.equal(mapped.economicChargeLines[0].amount, "0,0125");
console.log("COMPACT_WIRE_NO_EXTENDED_ARRAYS=OK");
console.log("COMPACT_WIRE_CODE_STRING=OK");
console.log("COMPACT_WIRE_STATUS_PARITY=OK");
console.log("COMPACT_WIRE_DESCRIPTION_EMPTY=OK");
console.log("COMPACT_WIRE_UNKNOWN_CODE=OK");
console.log("bill compact wire contract parity smoke: ok");
