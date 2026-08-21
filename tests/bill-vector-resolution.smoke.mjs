import assert from "node:assert/strict";
import { resolveBillVectorFromEvidence } from "../app/lib/ingestion/vector-resolution.ts";
import { structuredBillContract } from "../app/lib/ingestion/structured-bill.ts";

const found = (value) => ({ value, status: "FOUND", confidence: 0.9, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const invalid = () => ({ value: null, status: "INVALID", confidence: 0, source: "DOCUMENT_AI" });

function extraction(overrides = {}) {
  return {
    schemaVersion: 1,
    vector: found("EE"), supplier: found("Supplier"), customerName: notFound(), customerId: notFound(), customerType: found("RESIDENTIAL"), customerTaxIdentifier: notFound(),
    billingPeriod: found({ from: "2026-01-01", to: "2026-02-01" }), totalAmount: notFound(), annualConsumption: notFound(), billedConsumption: notFound(),
    pod: notFound(), pdr: notFound(), voltageLevel: notFound(), powerKw: notFound(), f1Consumption: notFound(), f2Consumption: notFound(), f3Consumption: notFound(),
    smcConsumption: notFound(), conversionCoefficient: notFound(), pcs: notFound(), offerName: notFound(), offerCode: notFound(), ...overrides,
  };
}

const eeBands = { f1Consumption: found(100), f2Consumption: found(50), f3Consumption: found(25), powerKw: found(3), voltageLevel: found("LV") };
const gasSignals = { smcConsumption: found(200), conversionCoefficient: found(1.05), pcs: found(38) };

assert.equal(resolveBillVectorFromEvidence(extraction({ vector: found("GAS"), pod: found("IT001E12345678") })).vector, "EE");
assert.equal(resolveBillVectorFromEvidence(extraction({ vector: found("EE"), pdr: found("12345678901234"), ...gasSignals })).vector, "GAS");
assert.equal(resolveBillVectorFromEvidence(extraction({ vector: found("GAS"), pod: found("IT001E12345678"), supplier: found("Gas Energia S.p.A.") })).vector, "EE");
assert.equal(resolveBillVectorFromEvidence(extraction({ vector: found("GAS"), ...eeBands })).vector, "EE");
assert.equal(resolveBillVectorFromEvidence(extraction({ vector: found("EE"), ...gasSignals })).vector, "GAS");
const conflict = resolveBillVectorFromEvidence(extraction({ pod: found("IT001E12345678"), pdr: found("12345678901234") }));
assert.equal(conflict.vector, "UNKNOWN");
assert.equal(conflict.reviewRequired, true);
assert.equal(resolveBillVectorFromEvidence(extraction({ vector: found("GAS") })).vector, "UNKNOWN");
assert.equal(resolveBillVectorFromEvidence(extraction({ vector: found("GAS"), f1Consumption: invalid(), f2Consumption: invalid(), f3Consumption: invalid() })).vector, "UNKNOWN");

const corrected = extraction({ vector: found("GAS"), pod: found("IT001E12345678"), ...eeBands });
const contract = structuredBillContract({ extraction: corrected, tenantId: "tenant_alpha", billId: "bill-vector", versionId: "v1" });
assert.equal(contract?.vector, "EE");
assert.equal(contract?.supply.pod, "IT001E12345678");

console.log("bill vector resolution smoke: ok (hard POD/PDR priority, secondary evidence, advisory model, conflict review and PUN exclusion)");
