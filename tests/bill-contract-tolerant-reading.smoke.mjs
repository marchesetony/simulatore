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
// Tony (28/10, bolletta BPower Casa Protetta): "Tipologia cliente: Domestico non residente" was refused as neither Consumer
// nor Business. The supply characteristics, or else the holder's tax code, give the customer type (synthetic codes).
const lv = [{ code: "NOMINAL_VOLTAGE", value: "220 V", status: "FOUND" }];
assert.equal(contract(extraction({ customerType: notFound(), extendedFacts: [...lv, { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Domestico non residente", status: "FOUND" }] }))?.customer.customerType, "RESIDENTIAL");
assert.equal(contract(extraction({ customerType: notFound(), extendedFacts: [...lv, { code: "SUPPLY_USE_CATEGORY_RAW", value: "Altri usi", status: "FOUND" }] }))?.customer.customerType, "NON_RESIDENTIAL");
assert.equal(contract(extraction({ customerType: notFound(), customerTaxIdentifier: found("RSSMRA80A01H501U"), extendedFacts: lv }))?.customer.customerType, "RESIDENTIAL");
assert.equal(contract(extraction({ customerType: notFound(), customerTaxIdentifier: found("IT01234567890"), extendedFacts: lv }))?.customer.customerType, "NON_RESIDENTIAL");
console.log("bill contract tolerant reading: ok");
