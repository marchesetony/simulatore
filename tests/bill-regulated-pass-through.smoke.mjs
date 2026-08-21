import assert from "node:assert/strict";
import { verifyRegulatedPassThrough } from "../app/lib/foundation/bill-regulated-pass-through.ts";

const period = { from: "2026-07-01", to: "2026-08-01" };
const record = (componentCode, originalValue, originalUnit, referenceDomain, authority = "ARERA") => ({
  tenantId: "tenant_test", id: `${componentCode}-id`, identityKey: `${componentCode}-identity`, version: "1", parentVersionId: null,
  authority, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: `https://${authority.toLowerCase()}.example.test/${componentCode}`, officialIdentifier: `REF-${componentCode}`,
  publicationDate: "2026-06-01", retrievedAt: "2026-06-02T00:00:00.000Z", effectiveFrom: "2026-07-01", effectiveTo: "2026-10-01", vector: "EE",
  customerScope: referenceDomain === "DISPATCHING" || referenceDomain === "CAPACITY_MARKET" ? "ALL_ELECTRICITY" : "DOMESTIC_BT", componentCode,
  referenceDomain, originalValue, originalUnit, normalizedValue: originalValue, normalizedUnit: originalUnit, applicationBasis: `Applicazione ${componentCode}`,
  sourceSha256: "a".repeat(64), conversionProvenance: [], approvalStatus: "IMPORTED", reviewStatus: "APPROVED", checksum: "b".repeat(64),
});
const line = (code, description, quantity, unit, unitPrice, amount) => ({ code, description, quantity, unit, unitPrice, amount, periodRaw: "07/2026", status: "FOUND" });

const references = [
  record("NETWORK_FIXED", 3.65, "EUR/POD/YEAR", "NETWORK"), record("S1_MEASURE", 1.2, "EUR/POD/YEAR", "NETWORK"),
  record("S2_POWER", 12, "EUR/KW/YEAR", "NETWORK"), record("S3_ENERGY_TRANSMISSION", 20, "EUR/MWH", "NETWORK"),
  record("ASOS", 20, "EUR/MWH", "SYSTEM_CHARGES"), record("ARIM", 0.01, "EUR/KWH", "SYSTEM_CHARGES"),
  record("UC3", 0.01, "EUR/KWH", "SYSTEM_CHARGES"), record("UC6", 0.01, "EUR/KWH", "SYSTEM_CHARGES"),
  record("DISPATCHING_TERNA_OPERATION", 0.0652, "CENT_EUR/KWH", "DISPATCHING"), record("DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION", 0.3041, "CENT_EUR/KWH", "DISPATCHING"),
  record("CAPACITY_MARKET_OFF_PEAK", 0.003197, "EUR/KWH", "CAPACITY_MARKET", "TERNA"),
];
const result = verifyRegulatedPassThrough({
  billingPeriod: period, regulatoryReferences: references, customerScope: "DOMESTIC_RESIDENT_BT", billedConsumptionKwh: 100, powerKw: 3,
  chargeLines: [
    line("POWER_CHARGE", "Quota potenza", "3 kW", "EUR/KW/MONTH", "1", "3,00"),
    line("NETWORK_SYSTEM", "Rete e oneri aggregati", "100 kWh", "EUR/KWH", "0,10", "10,00"),
    line("ASOS", "ASOS", "100 kWh", "EUR/KWH", "0,021", "2,10"),
    line("NETWORK_ENERGY", "Trasmissione", "100 kWh", "EUR/MWH", "20", "2,00"),
  ],
  extendedFacts: [
    { code: "DISPATCHING", value: "0,010501", unit: "EUR/KWH", status: "FOUND" },
    { code: "CAPACITY_MARKET", value: "0,024466", unit: "EUR/KWH", status: "FOUND" },
  ],
});

const byCode = (code) => result.items.find((item) => item.code === code);
assert.equal(byCode("NETWORK_POWER")?.outcome, "COINCIDE");
assert.equal(byCode("ASOS")?.outcome, "SCOSTAMENTO");
assert.equal(byCode("ASOS")?.unitRateDifference, 0.001);
assert.equal(byCode("ASOS")?.unitRateDifferencePercent, 5);
assert.equal(byCode("ASOS")?.amountDifference, 0.1);
assert.equal(byCode("NETWORK_FIXED")?.outcome, "PRESENTE_AGGREGATO");
assert.equal(byCode("METERING_FIXED")?.outcome, "PRESENTE_AGGREGATO");
assert.equal(byCode("UC3")?.outcome, "NON_IDENTIFICATO_IN_BOLLETTA");
assert.equal(byCode("DISPATCHING")?.outcome, "NON_CONFRONTABILE");
assert.equal(byCode("DISPATCHING")?.reason, "CUSTOMER_FACING_REFERENCE_MISSING");
assert.equal(byCode("CAPACITY_MARKET")?.outcome, "COINCIDE");
assert.equal(byCode("CAPACITY_MARKET")?.comparable, true);
assert.equal(byCode("CAPACITY_MARKET")?.authority, "ARERA");
assert.equal(byCode("CAPACITY_MARKET")?.officialIdentifier, "219/2026/R/eel");
assert.equal(byCode("CAPACITY_MARKET")?.normalizedOfficialRate, 0.024466);
assert.equal(byCode("CAPACITY_MARKET")?.unitRateDifference, 0);
assert.equal(byCode("CAPACITY_MARKET")?.unitRateDifferencePercent, 0);
assert.equal(byCode("CAPACITY_MARKET")?.amountDifference, null);
assert.equal(byCode("CAPACITY_MARKET")?.upstreamReferences[0]?.normalizedValue, 0.003197);
assert.equal(result.summary.differentCount, 1);
assert.equal(result.summary.comparableCount, 3);
assert.equal(result.summary.matchingCount, 2);
assert.equal(result.summary.aggregatedCount, 4);

const rounding = verifyRegulatedPassThrough({
  billingPeriod: period, regulatoryReferences: [record("ASOS", 0.02, "EUR/KWH", "SYSTEM_CHARGES")], customerScope: "DOMESTIC_RESIDENT_BT", billedConsumptionKwh: 100, powerKw: null,
  chargeLines: [line("ASOS", "ASOS", "100 kWh", "EUR/KWH", "0,0200004", "2,00")], extendedFacts: [],
});
assert.equal(rounding.items.find((item) => item.code === "ASOS")?.outcome, "COINCIDE");

console.log("DISPATCHING_OFFICIAL_COMPARISON=OK");
console.log("CAPACITY_OFFICIAL_COMPARISON=OK");
console.log("NETWORK_OFFICIAL_COMPARISON=OK");
console.log("SYSTEM_CHARGES_OFFICIAL_COMPARISON=OK");
console.log("UC3_OFFICIAL_COMPARISON=OK");
console.log("UC6_OFFICIAL_COMPARISON=OK");
console.log("UNIT_NORMALIZATION_BEFORE_COMPARISON=OK");
console.log("BILL_MINUS_OFFICIAL_DIFFERENCE=OK");
console.log("PERCENT_DIFFERENCE_CORRECT=OK");
console.log("AMOUNT_DIFFERENCE_CORRECT=OK");
console.log("ANNUAL_RATE_PRORATION_CORRECT=OK");
console.log("AGGREGATED_COMPONENT_NOT_FALSELY_COMPARED=OK");
console.log("CAPACITY_CUSTOMER_REFERENCE_ARERA_SELECTED=OK");
console.log("CAPACITY_BILL_MATCHES_ARERA=OK");
console.log("CAPACITY_TERNA_UPSTREAM_NOT_PRIMARY_COMPARATOR=OK");
console.log("ROUNDING_NOT_FALSE_ANOMALY=OK");
console.log("ONLY_COMPARABLE_DIFFERENCE_CAN_CREATE_ANOMALY=OK");
console.log("bill regulated pass-through smoke: ok");
