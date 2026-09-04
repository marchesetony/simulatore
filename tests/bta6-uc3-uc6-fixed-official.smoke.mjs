import assert from "node:assert/strict";
import { parseArera588Bta6Uc3Uc6TableRows } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { CALCULATED_REGULATORY_DOMAINS, AUTO_REFRESH_REGISTERED_DOMAINS, regulatoryDomainKey } from "../app/lib/regulatory-refresh/registry.ts";

const records = parseArera588Bta6Uc3Uc6TableRows({
  rows: [["", "Altre utenze in bassa tensione con potenza disponibile superiore a 16,5 kW", "0.276", "168.24", "", "0.007"]],
  sourceReference: "https://www.arera.it/fileadmin/allegati/docs/25/588-2025-R-com-TABELLE.xlsx",
  publicationDate: "2025-12-30",
  retrievedAt: "2026-09-04T15:00:00.000Z",
  sourceSha256: "a".repeat(64),
});

assert.deepEqual(records.map((record) => [record.componentCode, record.customerScope, record.originalValue, record.originalUnit, record.normalizedUnit]), [
  ["UC3", "NON_DOMESTIC_BT_BTA6", 0.276, "CENT_EUR/KWH", "EUR/KWH"],
  ["UC6", "NON_DOMESTIC_BT_BTA6", 0.007, "CENT_EUR/KWH", "EUR/KWH"],
  ["UC6", "NON_DOMESTIC_BT_BTA6", 168.24, "CENT_EUR/POD/YEAR", "EUR/POD/YEAR"],
]);
assert.ok(Math.abs(records[0].normalizedValue - 0.00276) < 1e-12);
assert.ok(Math.abs(records[1].normalizedValue - 0.00007) < 1e-12);
assert.ok(Math.abs(records[2].normalizedValue - 1.6824) < 1e-12);
assert.deepEqual(records.map((record) => [record.effectiveFrom, record.effectiveTo]), [["2026-01-01", null], ["2026-01-01", null], ["2026-01-01", null]]);
assert.equal(records.every((record) => record.applicationBasis.includes("227/2026/R/com")), true);
assert.equal(records.some((record) => record.componentCode === "UC6" && record.normalizedUnit === "EUR/KW/YEAR"), false);
assert.match(records[2].applicationBasis, /quota fissa per punto di prelievo\/anno/);
console.log("BTA6_UC3_RECORD=PASS");
console.log("BTA6_UC6_ENERGY_RECORD=PASS");
console.log("BTA6_UC6_FIXED_RECORD=PASS");
console.log("BTA6_UC6_POWER_VALUE_PRESENT=NO");
console.log("BTA6_168_24_IS_POWER_RATE=NO");
console.log("BTA6_168_24_IS_FIXED_POD_RATE=YES");
console.log("BTA6_UC6_POWER_NOT_REQUESTED=PASS");

const keys = new Set(AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey));
assert.equal(CALCULATED_REGULATORY_DOMAINS.length, 14);
assert.equal(AUTO_REFRESH_REGISTERED_DOMAINS.length, 14);
for (const record of records) assert.equal(keys.has(regulatoryDomainKey({ componentCode: record.componentCode, customerScope: record.customerScope, normalizedUnit: record.normalizedUnit })), true);
console.log("BTA6_UC3_AUTO_REFRESH=PASS");
console.log("BTA6_UC6_ENERGY_AUTO_REFRESH=PASS");
console.log("BTA6_UC6_FIXED_AUTO_REFRESH=PASS");
console.log("BTA6_UC6_POWER_AUTO_REFRESH=NOT_APPLICABLE");
console.log("AUTO_REFRESH_EXACT_DOMAIN_COVERAGE=PASS");
console.log("bta6 uc3 uc6 fixed official smoke: ok");
