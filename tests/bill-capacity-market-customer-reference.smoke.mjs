import assert from "node:assert/strict";
import { resolveCustomerFacingCapacityMarketReference } from "../app/lib/foundation/bill-capacity-market.ts";
import { verifyRegulatedPassThrough } from "../app/lib/foundation/bill-regulated-pass-through.ts";

const record = (authority, componentCode, referenceDomain, originalValue, originalUnit, effectiveFrom, effectiveTo, customerScope = "ALL_ELECTRICITY") => ({
  tenantId: "tenant_test", id: `${authority}-${componentCode}`, identityKey: `${authority}-${componentCode}`, version: "1", parentVersionId: null,
  authority, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: `${authority}-source`, officialIdentifier: `${authority}-${componentCode}`,
  publicationDate: "2026-06-01", retrievedAt: "2026-06-02T00:00:00.000Z", effectiveFrom, effectiveTo, vector: "EE", customerScope, componentCode,
  referenceDomain, originalValue, originalUnit, normalizedValue: originalUnit === "EUR/MWH" ? originalValue / 1000 : originalUnit === "CENT_EUR/KWH" ? originalValue / 100 : originalValue,
  normalizedUnit: originalUnit === "EUR/MWH" ? "EUR/KWH" : originalUnit === "CENT_EUR/KWH" ? "EUR/KWH" : originalUnit, applicationBasis: "Test reference", sourceSha256: "a".repeat(64),
  conversionProvenance: [], approvalStatus: "IMPORTED", reviewStatus: "APPROVED", checksum: "b".repeat(64),
});

const upstream = record("TERNA", "CAPACITY_MARKET_OFF_PEAK", "CAPACITY_MARKET", 3.197, "EUR/MWH", "2026-07-01", "2026-10-01");
const customerFacing = record("ARERA", "CAPACITY_MARKET", "CAPACITY_MARKET", 2.4466, "CENT_EUR/KWH", "2026-07-01", "2026-08-01", "DOMESTIC_RESIDENT_BT");
const references = [upstream, customerFacing];
const july = resolveCustomerFacingCapacityMarketReference(references, { from: "2026-07-01", to: "2026-08-01" }, "DOMESTIC_RESIDENT_BT");
assert.ok(july);
assert.equal(july.authority, "ARERA");
assert.equal(july.officialIdentifier, "ARERA-CAPACITY_MARKET");
assert.equal(july.originalValue, 2.4466);
assert.equal(july.originalUnit, "CENT_EUR/KWH");
assert.equal(Number(july.normalizedValue.toFixed(6)), 0.024466);
assert.equal(july.normalizedUnit, "EUR/KWH");

const absent = resolveCustomerFacingCapacityMarketReference([upstream], { from: "2026-08-01", to: "2026-09-01" }, "DOMESTIC_RESIDENT_BT");
assert.equal(absent, null);

const result = verifyRegulatedPassThrough({
  billingPeriod: { from: "2026-07-01", to: "2026-08-01" }, regulatoryReferences: references, customerScope: "DOMESTIC_RESIDENT_BT",
  billedConsumptionKwh: 397, powerKw: null, chargeLines: [], extendedFacts: [{ code: "CAPACITY_MARKET", value: "0,024466", unit: "EUR/KWH", status: "FOUND" }],
});
const capacity = result.items.find((item) => item.code === "CAPACITY_MARKET");
assert.equal(capacity?.authority, "ARERA");
assert.equal(capacity?.officialIdentifier, "ARERA-CAPACITY_MARKET");
assert.equal(capacity?.outcome, "COINCIDE");
assert.equal(capacity?.comparable, true);
assert.equal(Number(capacity?.normalizedOfficialRate?.toFixed(6)), 0.024466);
assert.equal(capacity?.unitRateDifference, 0);
assert.equal(capacity?.unitRateDifferencePercent, 0);
assert.equal(Number(capacity?.upstreamReferences[0]?.normalizedValue.toFixed(6)), 0.003197);
assert.equal(result.summary.matchingCount, 1);
assert.equal(result.summary.differentCount, 0);

console.log("CAPACITY_CUSTOMER_REFERENCE_REQUIRES_RUNTIME_RECORD=OK");
console.log("CAPACITY_NO_HARDCODED_MONTHLY_FALLBACK=OK");
console.log("CAPACITY_TERNA_UPSTREAM_NOT_PRIMARY_COMPARATOR=OK");
console.log("CAPACITY_MISSING_CUSTOMER_REFERENCE_REMAINS_NONCOMPARABLE=OK");
console.log("bill capacity market customer reference smoke: ok");
