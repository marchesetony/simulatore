import assert from "node:assert/strict";
import { structuredBillContract, structuredBillContractIssue } from "../app/lib/ingestion/structured-bill.ts";

// A competitor bill stays usable when the voltage is printed in volts, and a bill that cannot be used says why.
const found = (value) => ({ value, status: "FOUND", confidence: 0.9, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
function extraction(overrides = {}) {
  return {
    schemaVersion: 1, vector: found("EE"), supplier: found("CAMER"), customerName: notFound(), customerId: notFound(), customerType: found("NON_RESIDENTIAL"), customerTaxIdentifier: notFound(),
    billingPeriod: found({ from: "2026-09-01", to: "2026-09-30" }), totalAmount: notFound(), annualConsumption: notFound(), billedConsumption: notFound(),
    pod: found("IT001E12345678"), pdr: notFound(), voltageLevel: notFound(), powerKw: found(104), f1Consumption: found(100), f2Consumption: found(50), f3Consumption: found(25),
    smcConsumption: notFound(), conversionCoefficient: notFound(), pcs: notFound(), offerName: notFound(), offerCode: notFound(), extendedFacts: [], economicChargeLines: [], ...overrides,
  };
}
const contract = (value) => structuredBillContract({ extraction: value, tenantId: "tenant_alpha", billId: "bill-tolerant", versionId: "v1" });

assert.equal(contract(extraction({ extendedFacts: [{ code: "NOMINAL_VOLTAGE", value: "20.000 V", status: "FOUND" }] }))?.supply.voltageLevel, "MV");
assert.equal(contract(extraction({ extendedFacts: [{ code: "NOMINAL_VOLTAGE", value: "Bassa tensione", status: "FOUND" }] }))?.supply.voltageLevel, "LV");
assert.equal(contract(extraction()), null);
assert.equal(structuredBillContractIssue(extraction()), "VOLTAGE_MISSING");
assert.equal(structuredBillContractIssue(extraction({ customerType: notFound() })), "CUSTOMER_TYPE_MISSING");
assert.equal(structuredBillContractIssue(extraction({ pod: notFound() })), "POD_MISSING");
console.log("bill contract tolerant reading: ok");
