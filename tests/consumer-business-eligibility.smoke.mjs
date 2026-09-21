import assert from "node:assert/strict";
import { deriveBillEligibilityContext, evaluateCustomerAndSupply } from "../app/lib/eligibility/domain.ts";

const profile = (use) => ({ supplyUseCategory: { normalizedValue: use, rawValue: use, status: "FOUND" }, domesticResidenceStatus: { normalizedValue: use === "DOMESTIC" ? "NON_RESIDENT" : "NOT_APPLICABLE", rawValue: null, status: "NOT_FOUND" } });
const bill = (customerLegalType, supplyUseScope, identifierTypes = ["NOT_DECLARED"]) => ({ customerLegalType, supplyUseScope, identifierTypes, legalForms: ["NATURAL_PERSON"], evidence: [] });
const cte = (allowedCustomerTypes, allowedSupplyUses = [], allowedIdentifierTypes = ["NOT_DECLARED"]) => ({ allowedCustomerTypes, allowedSupplyUses, allowedLegalForms: ["NOT_DECLARED"], allowedIdentifierTypes });

assert.deepEqual(evaluateCustomerAndSupply({ bill: bill("CONSUMER", "DOMESTIC"), cte: cte(["CONSUMER"], ["DOMESTIC"]) }), []);
assert.deepEqual(evaluateCustomerAndSupply({ bill: bill("BUSINESS", "OTHER_USE"), cte: cte(["BUSINESS"], ["OTHER_USE"]) }), []);
assert.ok(evaluateCustomerAndSupply({ bill: bill("CONSUMER", "DOMESTIC"), cte: cte(["BUSINESS"], ["OTHER_USE"]) }).includes("CUSTOMER_LEGAL_TYPE_MISMATCH"));
assert.ok(evaluateCustomerAndSupply({ bill: bill("BUSINESS", "OTHER_USE"), cte: cte(["CONSUMER"], ["DOMESTIC"]) }).includes("CUSTOMER_LEGAL_TYPE_MISMATCH"));
assert.deepEqual(evaluateCustomerAndSupply({ bill: bill("CONSUMER", "OTHER_USE", ["TAX_CODE"]), cte: cte(["CONSUMER"], ["OTHER_USE"], ["TAX_CODE"]) }), []);
assert.ok(evaluateCustomerAndSupply({ bill: bill("CONSUMER", "OTHER_USE", ["TAX_CODE"]), cte: cte(["NOT_DECLARED"], ["OTHER_USE"]) }).includes("CUSTOMER_LEGAL_TYPE_MISMATCH"));
assert.deepEqual(evaluateCustomerAndSupply({ bill: bill("CONSUMER", "DOMESTIC"), cte: cte(["BOTH"], ["DOMESTIC"]) }), []);

const consumerOtherUse = deriveBillEligibilityContext({ customerType: "NON_RESIDENTIAL", residency: null, profile: profile("OTHER_USE"), identifiers: [{ kind: "TAX_CODE" }], evidence: ["Persona fisica", "Altri Usi"] });
assert.equal(consumerOtherUse.customerLegalType, "CONSUMER");
assert.equal(consumerOtherUse.supplyUseScope, "OTHER_USE");
assert.deepEqual(consumerOtherUse.identifierTypes, ["TAX_CODE"]);
assert.deepEqual(evaluateCustomerAndSupply({ bill: consumerOtherUse, cte: cte(["CONSUMER"], ["OTHER_USE"], ["TAX_CODE"]) }), []);

console.log("CUSTOMER_LEGAL_TYPE_SEPARATE_FROM_SUPPLY_USE=PASS");
console.log("CONSUMER_VS_CONSUMER=MATCH");
console.log("BUSINESS_VS_BUSINESS=MATCH");
console.log("CONSUMER_VS_BUSINESS=MISMATCH");
console.log("BUSINESS_VS_CONSUMER=MISMATCH");
console.log("BOTH=MATCH");
console.log("CONSUMER_OTHER_USE_WITH_TAX_CODE=MATCH");
console.log("OTHER_USE_ALONE_DOES_NOT_MEAN_BOTH=PASS");
console.log("CONSUMER_BUSINESS_ELIGIBILITY_TECHNICAL_SMOKE=PASS");
