import assert from "node:assert/strict";
import { BILL_WIRE_FIELD_NAMES, mapBillWireToStructuredBill } from "../app/lib/ingestion/bill-wire.ts";
import { ANALYST_WIRE_SCHEMA, CORE_WIRE_SCHEMA, mapBillCoreToStructuredBill, mergeBillCoreAndAnalyst } from "../app/lib/ingestion/bill-two-stage.ts";
import { structuredBillAnalyticalMonthlyTotal, structuredBillContract, structuredBillMonthlyDisplayReconciliation, validateStructuredBillExtraction } from "../app/lib/ingestion/structured-bill.ts";
import { MAX_MONTHLY_BANDS, MONTHLY_BANDS_WIRE_SCHEMA, monthlyBandsEqual, validateMonthlyBands } from "../app/lib/ingestion/monthly-bands.ts";

const outboundSchemaKeywords = new Set(["maxItems", "minimum", "maximum", "multipleOf", "minLength", "maxLength"]);
const outboundSchemaKeywordHits = [];
function inspectOutboundSchema(value, path = "monthlyBands") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item, index) => inspectOutboundSchema(item, `${path}[${index}]`));
  for (const [key, child] of Object.entries(value)) {
    if (outboundSchemaKeywords.has(key)) outboundSchemaKeywordHits.push(`${path}.${key}`);
    inspectOutboundSchema(child, `${path}.${key}`);
  }
}
inspectOutboundSchema(MONTHLY_BANDS_WIRE_SCHEMA);
assert.equal(MONTHLY_BANDS_WIRE_SCHEMA.type, "array");
assert.ok(MONTHLY_BANDS_WIRE_SCHEMA.items);
assert.equal(MONTHLY_BANDS_WIRE_SCHEMA.items.properties.f1.type, "number");
assert.equal(MONTHLY_BANDS_WIRE_SCHEMA.items.properties.f2.type, "number");
assert.equal(MONTHLY_BANDS_WIRE_SCHEMA.items.properties.f3.type, "number");
assert.equal(Object.hasOwn(MONTHLY_BANDS_WIRE_SCHEMA, "maxItems"), false);
assert.deepEqual(outboundSchemaKeywordHits, []);
assert.equal(Object.hasOwn(CORE_WIRE_SCHEMA.properties, "monthlyBands"), false);
assert.equal(Object.hasOwn(ANALYST_WIRE_SCHEMA.properties, "monthlyBands"), true);
assert.equal(ANALYST_WIRE_SCHEMA.required.includes("monthlyBands"), false);

const atLimit = Array.from({ length: MAX_MONTHLY_BANDS }, (_, index) => ({ month: `${String(2000 + Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`, f1: 0, f2: 0, f3: 0 }));
assert.doesNotThrow(() => validateMonthlyBands(atLimit));
assert.throws(() => validateMonthlyBands([...atLimit, { month: "2010-01", f1: 0, f2: 0, f3: 0 }]), /TOO_MANY_ITEMS/);

const found = (value) => ({ value: String(value), status: "FOUND" });
const missing = () => ({ value: "NOT_FOUND", status: "NOT_FOUND" });
const monthly = [
  { month: "2026-07", f1: 77.26, f2: 58.73, f3: 73.41 },
  { month: "2026-08", f1: 105.62, f2: 73.44, f3: 88.86 },
];
const wire = (overrides = {}) => {
  const value = { schemaVersion: 1 };
  for (const name of BILL_WIRE_FIELD_NAMES) value[name] = name === "vector" ? found("EE") : name === "customerType" ? found("RESIDENTIAL") : name === "voltageLevel" ? found("LV") : name === "billingPeriod" ? found("01/07/2026 - 31/08/2026") : name === "pod" ? found("IT001E12345678") : ["totalAmount", "annualConsumption", "billedConsumption", "powerKw", "f1Consumption", "f2Consumption", "f3Consumption"].includes(name) ? found(name === "billedConsumption" ? "477" : "183") : missing();
  delete value.customerId;
  return { ...value, ...overrides };
};
const analyst = (bands) => ({ schemaVersion: "1", items: [], ...(bands === undefined ? {} : { monthlyBands: bands }) });
assert.throws(() => mapBillCoreToStructuredBill(wire({ monthlyBands: monthly })), /CORE_ONLY_REQUIRED/);

const aggregateOnly = mapBillCoreToStructuredBill(wire());
assert.equal(aggregateOnly.monthlyBands, undefined);
assert.equal(structuredBillAnalyticalMonthlyTotal(aggregateOnly), null);
assert.doesNotThrow(() => validateStructuredBillExtraction(aggregateOnly));

const legacyWithMonthly = mapBillWireToStructuredBill(wire({ monthlyBands: monthly }));
assert.deepEqual(legacyWithMonthly.monthlyBands, monthly);
const merged = mergeBillCoreAndAnalyst(aggregateOnly, analyst(monthly));
assert.deepEqual(merged.monthlyBands, monthly);
assert.equal(structuredBillAnalyticalMonthlyTotal(merged), 477.32);
assert.equal(structuredBillMonthlyDisplayReconciliation(merged), "PASS");
assert.equal(merged.monthlyBands[0].f1, 77.26);
assert.equal(merged.monthlyBands[0].f2, 58.73);
assert.equal(merged.monthlyBands[1].f1, 105.62);
assert.equal(merged.monthlyBands[1].f3, 88.86);
const truncatedMonthly = monthly.map((band) => ({ ...band, f1: Math.round(band.f1), f2: Math.round(band.f2), f3: Math.round(band.f3) }));
assert.doesNotThrow(() => validateMonthlyBands(truncatedMonthly), "legacy integer monthly values remain structurally valid");
assert.doesNotThrow(() => validateMonthlyBands(truncatedMonthly), "legacy integer monthly values remain structurally valid");
assert.notEqual(structuredBillAnalyticalMonthlyTotal({ ...merged, monthlyBands: truncatedMonthly }), 477.32);
assert.equal(structuredBillAnalyticalMonthlyTotal({ ...merged, monthlyBands: truncatedMonthly }), 477);
assert.equal(monthlyBandsEqual(merged.monthlyBands, truncatedMonthly), false);
assert.notEqual(structuredBillAnalyticalMonthlyTotal({ ...merged, monthlyBands: truncatedMonthly }), structuredBillAnalyticalMonthlyTotal(merged), "decimal truncation must not be treated as the precise analytical total");
const materiallyMismatched = structuredClone(merged);
materiallyMismatched.monthlyBands[0].f1 += 10;
assert.equal(structuredBillContract({ extraction: materiallyMismatched, tenantId: "tenant_bill-monthly", billId: "bill-monthly", versionId: "v1" }), null);
assert.equal(merged.f1Consumption.value, 183);
assert.equal(merged.f2Consumption.value, 183);
assert.equal(merged.f3Consumption.value, 183);

assert.throws(() => mapBillWireToStructuredBill(wire({ monthlyBands: [{ ...monthly[0], month: "2026-07" }, { ...monthly[1], month: "2026-07" }] })), /DUPLICATE_MONTH/);
assert.throws(() => mapBillWireToStructuredBill(wire({ monthlyBands: [{ ...monthly[0], month: "2026-13" }] })), /YYYY_MM_REQUIRED/);
assert.throws(() => mapBillWireToStructuredBill(wire({ monthlyBands: [{ ...monthly[0], f2: -1 }] })), /FINITE_NON_NEGATIVE_NUMBER_REQUIRED/);
assert.throws(() => mergeBillCoreAndAnalyst(legacyWithMonthly, analyst([{ ...monthly[0], f1: 77.27 }, monthly[1]])), /CONFLICT/);

const legacy = structuredClone(merged);
delete legacy.monthlyBands;
assert.doesNotThrow(() => validateStructuredBillExtraction(legacy));
assert.equal(structuredBillAnalyticalMonthlyTotal(legacy), null);
assert.equal(structuredBillMonthlyDisplayReconciliation(legacy), "NOT_AVAILABLE");

console.log("bill monthly bands smoke: ok (period/month separation, strict monthly contract, analytical total, display reconciliation, legacy compatibility and fail-closed validation)");
