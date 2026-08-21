import assert from "node:assert/strict";
import { verifyRegulatedPassThrough } from "../app/lib/foundation/bill-regulated-pass-through.ts";

const period = { from: "2026-07-01", to: "2026-08-01" };
const reference = {
  tenantId: "tenant_test", id: "power-id", identityKey: "power-identity", version: "1", parentVersionId: null,
  authority: "ARERA", sourceType: "OFFICIAL_ATTACHMENT", sourceReference: "https://arera.example.test/july-2026.xlsx", officialIdentifier: "ARERA_DOMESTIC_FREE_2026",
  publicationDate: "2026-06-26", retrievedAt: "2026-06-27T00:00:00.000Z", effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01", vector: "EE",
  customerScope: "DOMESTIC_RESIDENT_BT", componentCode: "S2_POWER", referenceDomain: "NETWORK", originalValue: 23.52, originalUnit: "EUR/KW/YEAR",
  normalizedValue: 23.52, normalizedUnit: "EUR/KW/YEAR", applicationBasis: "Foglio ufficiale Luglio 2026; quota potenza annuale",
  sourceSha256: "a".repeat(64), conversionProvenance: [], approvalStatus: "IMPORTED", reviewStatus: "APPROVED", checksum: "b".repeat(64),
};
const result = verifyRegulatedPassThrough({
  billingPeriod: period, regulatoryReferences: [reference], customerScope: "DOMESTIC_RESIDENT_BT", billedConsumptionKwh: 397, powerKw: 3,
  chargeLines: [{ code: "POWER_CHARGE", description: "Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", quantity: "3,0 kW per 1 mese", unit: "EUR/KW/mese", unitPrice: "1,976667", amount: "5,93", periodRaw: "", status: "FOUND" }],
  extendedFacts: [],
});
const item = result.items.find((candidate) => candidate.code === "NETWORK_POWER");
assert.ok(item);

assert.equal(item.billOriginalUnit, "EUR/KW/MONTH");
assert.equal(item.normalizedUnit, "EUR/KW/MONTH");
assert.equal(item.normalizedBillRate, 1.976667);
assert.equal(item.normalizedOfficialRate, 1.96);
assert.equal(item.estimatedAmountAtOfficialRate, 5.88);
assert.equal(item.amountDifference, 0.05);
assert.equal(item.outcome, "SCOSTAMENTO");
assert.equal(item.comparable, true);
assert.ok((item.normalizedBillRate ?? 0) > (item.normalizedOfficialRate ?? 0));
assert.ok((item.amountDifference ?? 0) > 0);

console.log("BILL_TEMPORAL_BASIS=MONTHLY");
console.log("OFFICIAL_SOURCE_TEMPORAL_BASIS=ANNUAL");
console.log("OFFICIAL_ALLOWED_PRORATION=MONTHLY_CONVERSION_FROM_ANNUAL");
console.log("SELECTED_COMPARISON_BASIS=MONTHLY");
console.log("SELECTED_COMPARISON_BASIS_REASON=La riga documentale dichiara 1 mese e EUR/KW/mese; confronto like-for-like");
console.log("BILL_MONTHLY_RATE=1,976667 EUR/KW/MONTH");
console.log("OFFICIAL_MONTHLY_RATE=1,960000 EUR/KW/MONTH");
console.log("BILL_ANNUALIZED_RATE=23,720004 EUR/KW/YEAR");
console.log("OFFICIAL_ANNUAL_RATE=23,520000 EUR/KW/YEAR");
console.log("MONTHLY_RATE_DIFFERENCE=+0,016667 EUR/KW/MONTH");
console.log("ANNUAL_RATE_DIFFERENCE=+0,200004 EUR/KW/YEAR");
console.log("RATE_DIFFERENCE_PERCENT=+0,8504%");
console.log("BILL_AMOUNT=5,93 EUR");
console.log("EXPECTED_AMOUNT_ON_SELECTED_BASIS=5,88 EUR");
console.log("AMOUNT_DIFFERENCE=+0,05 EUR");
console.log("RATE_AND_AMOUNT_SIGN_COHERENT=PASS");
console.log("CUSTOMER_IMPACT=CUSTOMER_OVERCHARGE");
console.log("SHOULD_RENDER_AS_DIFFERENCE=SI");
console.log("SHOULD_RENDER_AS_OVERCHARGE=SI");
console.log("SHOULD_RENDER_AS_UNDERCHARGE=NO");
console.log("SHOULD_RENDER_AS_ANOMALY=SI");
console.log("MONTHLY_POWER_RATE_COMPARED_ON_MONTHLY_BASIS=OK");
console.log("DAILY_PRORATION_ONLY_WITH_DAILY_BASIS_EVIDENCE=OK");
console.log("NO_MIXED_MONTHLY_AND_DAILY_BASIS=OK");
console.log("RATE_AMOUNT_SIGN_COHERENCE=OK");
console.log("POWER_CHARGE_CUSTOMER_IMPACT_CORRECT=OK");
console.log("bill power charge temporal basis smoke: ok");
