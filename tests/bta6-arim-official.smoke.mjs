import assert from "node:assert/strict";
import { parseArera588Bta6ArimTableRows, ARERA_98_PDF_URL, ARERA_227_PDF_URL, ARERA_588_IDENTIFIER } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { AUTO_REFRESH_REGISTERED_DOMAINS, CALCULATED_REGULATORY_DOMAINS, regulatoryDomainKey } from "../app/lib/regulatory-refresh/registry.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { resolveRegulatoryTimeline } from "../app/lib/calculation/regulatory-timeline.ts";

const sourceSha256 = "a".repeat(64);
const records = parseArera588Bta6ArimTableRows({
  rows: [
    ["Rimanenti oneri generali (ARIM)"],
    ["", "", "Quota fissa", "Quota potenza", "Quota energia"],
    ["", "", "centesimi di euro/punto di prelievo/anno", "centesimi di euro/kW per anno", "centesimi di euro/kWh"],
    ["", "Altre utenze in bassa tensione con potenza disponibile superiore a 16,5 kW", "302.76", "345.24", "0.1614"],
  ],
  sourceSha256,
  retrievedAt: "2026-09-04T12:00:00.000Z",
});

assert.equal(records.length, 3);
assert.equal(records[0].officialIdentifier, `${ARERA_588_IDENTIFIER}:Tabella B:BTA6:OPEN_UNTIL_SUPERSEDED`);
assert.deepEqual(records.map((record) => [record.componentCode, record.normalizedUnit, record.normalizedValue]), [
  ["ARIM", "EUR/POD/YEAR", 3.0276],
  ["ARIM", "EUR/KW/YEAR", 3.4524],
  ["ARIM", "EUR/KWH", 0.001614],
]);
assert.equal(records.every((record) => record.customerScope === "NON_DOMESTIC_BT_BTA6"), true);
assert.equal(records.every((record) => record.effectiveFrom === "2026-01-01" && record.effectiveTo === null), true);
assert.equal(records.every((record) => record.applicationBasis.includes("indifferenziata rispetto alle classi di agevolazione")), true);
assert.equal(records.every((record) => record.confirmationSource?.includes(ARERA_98_PDF_URL) && record.confirmationSource?.includes(ARERA_227_PDF_URL)), true);
assert.equal(records.every((record) => record.sourceSha256 === sourceSha256), true);

const keys = new Set(AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey));
for (const unit of ["EUR/POD/YEAR", "EUR/KW/YEAR", "EUR/KWH"]) {
  assert.equal(keys.has(`ARIM|NON_DOMESTIC_BT_BTA6|${unit}`), true);
}
assert.equal(CALCULATED_REGULATORY_DOMAINS.length, 31);
assert.equal(CALCULATED_REGULATORY_DOMAINS.filter((domain) => domain.regulatoryVariant === undefined).length, 19);
assert.equal(AUTO_REFRESH_REGISTERED_DOMAINS.length, 31);
assert.deepEqual(AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey), CALCULATED_REGULATORY_DOMAINS.map(regulatoryDomainKey));

const local = new LocalFilesystemAdapter("var/phase6");
const bridge = new ProductionRegulatoryPersistenceBridge(local.collection("regulatory-values"), local.collection("regulatory-approval-domains"));
for (const unit of ["EUR/POD/YEAR", "EUR/KW/YEAR", "EUR/KWH"]) {
  const timeline = await resolveRegulatoryTimeline(bridge, { tenantId: "tenant_local-demo", componentCode: "ARIM", customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit: unit, periodStart: "2026-07-01", periodEnd: "2026-08-01" });
  assert.equal(timeline.segments.length, 1);
  assert.equal(timeline.segments[0].segmentStart, "2026-07-01T00:00:00.000Z");
  assert.equal(timeline.segments[0].segmentEnd, "2026-08-01T00:00:00.000Z");
}

console.log(`BTA6_ARIM_ROW_LABEL=Altre utenze in bassa tensione con potenza disponibile superiore a 16,5 kW`);
console.log("BTA6_ARIM_VALUES_RECONFIRMED=PASS");
console.log("BTA6_ARIM_CLASS_DEPENDENT=NO");
console.log("ENERGY_INTENSIVE_CLASS_REQUIRED_FOR_ARIM=NO");
console.log("BTA6_ARIM_SCOPE_FALLBACK=NO");
console.log("BTA6_ARIM_EFFECTIVE_INTERVAL=2026-01-01/OPEN_UNTIL_SUPERSEDED");
console.log("BTA6_ARIM_FIXED_TIMELINE=PASS");
console.log("BTA6_ARIM_POWER_TIMELINE=PASS");
console.log("BTA6_ARIM_ENERGY_TIMELINE=PASS");
console.log("AUTO_REFRESH_EXACT_DOMAIN_COVERAGE=PASS");
console.log("BTA6_ARIM_OFFICIAL_SMOKE=PASS");
