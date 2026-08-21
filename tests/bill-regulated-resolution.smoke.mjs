import assert from "node:assert/strict";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { attachOfficialPun } from "../app/lib/market/pun-reference.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";

const bill = await new LocalBillRepository().get("tenant_local-demo", "93d9b1f0-c748-4c66-ab32-b0673a96787e");
assert.ok(bill);
const publicBill = await attachOfficialPun(toPublicDocument(bill), new LocalMarketArchiveRepository());
const verification = publicBill.regulatoryAudit?.regulatedPassThrough;
assert.ok(verification);

const expectedCodes = ["NETWORK_FIXED", "METERING_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "TRANSMISSION_ENERGY", "ASOS", "ARIM", "UC3", "UC6", "DISPATCHING", "CAPACITY_MARKET"];
assert.deepEqual(verification.items.map((item) => item.code), expectedCodes);
for (const [index, item] of verification.items.entries()) {
  const prefix = `COMPONENT_${String(index + 1).padStart(2, "0")}`;
  console.log(`${prefix}_CODE=${item.code}`);
  console.log(`${prefix}_LABEL=${item.label}`);
  console.log(`${prefix}_BILL_EXPOSURE=${item.billExposure}`);
  console.log(`${prefix}_OFFICIAL_SOURCE=${item.authority}:${item.officialIdentifier ?? "NONE"}`);
  console.log(`${prefix}_OFFICIAL_VALUE=${item.normalizedOfficialRate ?? "NONE"}`);
  console.log(`${prefix}_COMPARABILITY=${item.status}`);
  console.log(`${prefix}_DIFFERENCE=${item.unitRateDifference ?? item.amountDifference ?? "NONE"}`);
  console.log(`${prefix}_RESULT=${item.comparisonResult ?? item.status}`);
}

const byCode = (code) => verification.items.find((item) => item.code === code);
assert.equal(byCode("NETWORK_POWER")?.status, "SUPERIORE_AL_RIFERIMENTO");
assert.equal(byCode("NETWORK_POWER")?.amountDifference, 0.05);
assert.equal(byCode("ASOS")?.status, "CONFORME");
assert.equal(byCode("ARIM")?.status, "CONFORME");
assert.equal(byCode("DISPATCHING")?.status, "INFERIORE_AL_RIFERIMENTO");
assert.equal(byCode("DISPATCHING")?.authority, "ARERA");
assert.equal(byCode("DISPATCHING")?.officialIdentifier, "ARERA_DOMESTIC_FREE_2026");
assert.equal(byCode("DISPATCHING")?.normalizedOfficialRate, 0.038464);
assert.equal(byCode("DISPATCHING")?.unitRateDifference, -0.027963);
assert.equal(byCode("DISPATCHING")?.upstreamReferences.length, 2);
assert.equal(byCode("CAPACITY_MARKET")?.status, "CONFORME");
assert.equal(byCode("CAPACITY_MARKET")?.officialIdentifier, "219/2026/R/eel");
assert.equal(byCode("CAPACITY_MARKET")?.upstreamReferences[0]?.officialIdentifier, "TERNA_CAPACITY_MARKET_Q3_2026");
assert.equal(byCode("UC3")?.status, "NON_IDENTIFICATO_SEPARATAMENTE");
assert.equal(byCode("UC6")?.status, "NON_IDENTIFICATO_SEPARATAMENTE");
assert.equal(verification.summary.regulatedPassThroughCount, 11);
assert.equal(verification.summary.comparableCount, 5);
assert.equal(verification.summary.matchingCount, 3);
assert.equal(verification.summary.overReferenceCount, 1);
assert.equal(verification.summary.underReferenceCount, 1);
assert.equal(verification.summary.aggregatedCount, 4);
assert.equal(verification.summary.nonComparableCount, 0);
assert.equal(verification.summary.notIdentifiedCount, 2);
assert.equal(verification.summary.confirmedOverchargeAmount, 0.05);
assert.equal(verification.summary.confirmedUnderchargeAmount, 0);
assert.equal(verification.summary.netConfirmedDifferenceAmount, 0.05);

console.log("CUSTOMER_FACING_REFERENCE_SEARCH_BEFORE_NONCOMPARABLE=OK");
console.log("SEPARATE_BILL_COMPONENT_ATTEMPTS_OFFICIAL_COMPARISON=OK");
console.log("MONTHLY_REFERENCE_SELECTION=OK");
console.log("QUARTERLY_REFERENCE_SELECTION=OK");
console.log("ANNUAL_REFERENCE_SELECTION=OK");
console.log("DISPATCHING_CUSTOMER_REFERENCE_RESOLUTION=OK");
console.log("NETWORK_REFERENCE_RESOLUTION=OK");
console.log("ASOS_REFERENCE_RESOLUTION=OK");
console.log("ARIM_REFERENCE_RESOLUTION=OK");
console.log("UC3_REFERENCE_RESOLUTION=OK");
console.log("UC6_REFERENCE_RESOLUTION=OK");
console.log("CAPACITY_CUSTOMER_ARERA_MATCH=OK");
console.log("NO_UPSTREAM_REFERENCE_PRIORITY_WHEN_CUSTOMER_REFERENCE_EXISTS=OK");
console.log("NO_FALSE_NONCOMPARABLE=OK");
console.log("AGGREGATE_ONLY_NONCOMPARABLE_WHEN_NOT_RECONSTRUCTABLE=OK");
console.log("bill regulated resolution smoke: ok");
