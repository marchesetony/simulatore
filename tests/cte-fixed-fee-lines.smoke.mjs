import assert from "node:assert/strict";

import { extraFixedFees, feeSegments } from "../app/lib/cte/review.ts";

// Every line of a fixed-fee field is its own fee: monthly PCV and the yearly extra of FLEX offers (Tony, 26/10).
assert.deepEqual(feeSegments("Quota fissa vendita 15,00 €/mese; spesa aggiuntiva annua FLEX 36,00 €/anno").map((item) => [item.amount, item.unit]), [[15, "EUR_PER_MONTH"], [36, "EUR_PER_YEAR"]]);
const primary = { feeId: "x-fixed", label: "PCV", amount: 15, currency: "EUR", unit: "EUR_PER_MONTH", taxTreatment: "EXCLUDED" };
const fields = new Map([["commercialTerms.fixedFees", { fieldKey: "commercialTerms.fixedFees", normalizedValue: 15, description: "Quota fissa vendita 15,00 €/mese; spesa aggiuntiva annua FLEX 36,00 €/anno" }]]);
const extra = extraFixedFees(primary, fields, "Be Relax FLEX 06.25", "x-fixed", "EXCLUDED");
assert.deepEqual(extra.map((fee) => [fee.amount, fee.unit]), [[36, "EUR_PER_YEAR"]]);
// The paid option the offer is named after is priced even when the CTE lists it among the additional services.
const withService = new Map([["commercialTerms.fixedFees", { fieldKey: "commercialTerms.fixedFees", normalizedValue: 15, sourceText: "15,00 €/mese" }], ["commercialTerms.additionalServices", { fieldKey: "commercialTerms.additionalServices", normalizedValue: "Opzione Flex: 3,00 €/mese; Polizza casa facoltativa 2 €/mese" }]]);
assert.deepEqual(extraFixedFees(primary, withService, "Be Relax FLEX 06.25", "x-fixed", "EXCLUDED").map((fee) => [fee.amount, fee.unit]), [[3, "EUR_PER_MONTH"]]);
assert.deepEqual(extraFixedFees(primary, withService, "Be Relax 06.25", "x-fixed", "EXCLUDED"), []);
console.log("CTE_FIXED_FEE_LINES=PASS");
assert.deepEqual(feeSegments("Opzione Flex: 36 euro annui").map((item) => [item.amount, item.unit]), [[36, "EUR_PER_YEAR"]]);
console.log("CTE_FIXED_FEE_ANNUAL_WORDING=PASS");
