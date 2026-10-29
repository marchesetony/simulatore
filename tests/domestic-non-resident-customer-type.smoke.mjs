import assert from "node:assert/strict";
import { customerTypeOf } from "../app/lib/ingestion/customer-type.ts";

// Tony (29/10): a "Domestico non residente" bill stopped at the offer choice with RESIDENCY_MISMATCH, because the reading
// returned customerType NON_RESIDENTIAL (the enum's name) with residency NON_RESIDENT. A domestic supply is a household.
const evidence = (customerType, facts) => ({ customerType: { status: "FOUND", value: customerType }, customerTaxIdentifier: { status: "NOT_FOUND", value: null }, extendedFacts: facts.map(([code, value]) => ({ code, value, status: "FOUND" })) });
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["SUPPLY_USE_RAW", "Domestico non residente"]])), "RESIDENTIAL");
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["DOMESTIC_RESIDENCE_RAW", "Uso domestico"], ["CUSTOMER_TYPE_RAW", "Cliente non residente"]])), "RESIDENTIAL");
// A business stays a business.
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["SUPPLY_USE_RAW", "Altri usi"]])), "NON_RESIDENTIAL");
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["SUPPLY_USE_RAW", "Non domestico BTA3"]])), "NON_RESIDENTIAL");
assert.equal(customerTypeOf(evidence("RESIDENTIAL", [["SUPPLY_USE_RAW", "Domestico residente"]])), "RESIDENTIAL");
console.log("domestic non-resident customer type ok");
