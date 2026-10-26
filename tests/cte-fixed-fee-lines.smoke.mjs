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
// Be Smile FLEX 25 (CTE 003888ESVFL03…SMILFLEX26) lists every corrispettivo as a bullet: the 15 of the first line is €/mese,
// not €/kWh taken from the commercializzazione line, and the "Opzione Flex pari a 36 €/anno" bullet adds 3 €/mese (Tony, 26/10).
const { normalizeCteReview } = await import("../app/lib/cte/review.ts");
const cteField = (path, value) => ({ path, value, sourceText: value, status: "CONFIRMED", confidence: 0.9 });
const smileFlex = normalizeCteReview({ vector: "ELECTRICITY", fields: [
  cteField("offer.name", "Be Smile FLEX 25"),
  cteField("commercialTerms.fixedFees", "• Quota fissa business pari a 15 €/mese;\n• Commercializzazione pari a 0,003 €/kWh al netto delle perdite di rete;\n• Sbilanciamento pari a 0,008 €/kWh al netto delle perdite di rete.\n• Opzione Flex pari a 36 €/anno"),
] });
const smileFields = new Map([...smileFlex.commercialFields, ...smileFlex.notFoundFields].map((field) => [field.fieldKey, field]));
const smileFixed = smileFields.get("commercialTerms.fixedFees");
assert.equal(smileFixed.normalizedValue, 15);
assert.equal(smileFixed.unit, "€/mese");
assert.deepEqual(extraFixedFees({ ...primary }, smileFields, "Be Smile FLEX 25", "x-fixed", "EXCLUDED").map((fee) => [fee.amount, fee.unit]), [[36, "EUR_PER_YEAR"]]);
console.log("CTE_FIXED_FEE_BULLET_LIST=PASS");
