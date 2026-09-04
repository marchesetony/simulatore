import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseArera575Bta6DistributionXlsx, parseArera575Bta6MeasurementXlsx, parseAreraBta6TransmissionHtml } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { resolveRegulatoryTimeline } from "../app/lib/calculation/regulatory-timeline.ts";

const retrievedAt = "2026-09-04T12:00:00.000Z";
const tit = new Uint8Array(await readFile(".tmp-regulatory-sources/ee-calc-3c2/575-2025-R-eel-TABELLE_TIT.xlsx"));
const time = new Uint8Array(await readFile(".tmp-regulatory-sources/ee-calc-3c2/575-2025-R-eel-TABELLE_TIME.xlsx"));
const distribution = parseArera575Bta6DistributionXlsx({ body: tit, retrievedAt });
const metering = parseArera575Bta6MeasurementXlsx({ body: time, retrievedAt });
const transmission = parseAreraBta6TransmissionHtml({ html: `<table><tr><th>Categoria</th><th>Anno 2024</th><th>Anno 2025</th><th>Anno 2026</th></tr><tr><td>d) Altre utenze in bassa tensione</td><td>1,057</td><td>1,189</td><td>1,190</td></tr></table>`, retrievedAt, sourceReference: "https://www.arera.it/area-operatori/prezzi-e-tariffe/tariffa-per-il-servizio-di-trasmissione" });
assert.deepEqual(distribution.map((record) => [record.componentCode, record.customerScope, record.normalizedValue, record.normalizedUnit]), [["NETWORK_FIXED", "NON_DOMESTIC_BT_BTA6", 5.3471, "EUR/POD/YEAR"], ["NETWORK_POWER", "NON_DOMESTIC_BT_BTA6", 32.9297, "EUR/KW/YEAR"], ["NETWORK_ENERGY", "NON_DOMESTIC_BT_BTA6", 0.00066, "EUR/KWH"]]);
assert.equal(metering.normalizedValue, 19.6826);
assert.equal(metering.componentCode, "METERING_FIXED");
assert.equal(transmission.normalizedValue, 0.011899999999999999);
assert.equal(transmission.componentCode, "TRANSMISSION_ENERGY");
for (const record of [...distribution, metering, transmission]) { assert.equal(record.effectiveFrom, "2026-01-01"); assert.equal(record.effectiveTo, "2027-01-01"); assert.equal(record.customerScope, "NON_DOMESTIC_BT_BTA6"); assert.equal(record.approvalStatus, "IMPORTED"); assert.equal(record.reviewStatus, "NEEDS_REVIEW"); assert.match(record.sourceReference, /^https:\/\/www\.arera\.it\//); assert.equal(record.sourceSha256.length, 64); assert.ok(record.checksum); }
const local = new LocalFilesystemAdapter("var/phase6");
const bridge = new ProductionRegulatoryPersistenceBridge(local.collection("regulatory-values"), local.collection("regulatory-approval-domains"));
const timelineInputs = [["NETWORK_FIXED", "EUR/POD/YEAR"], ["NETWORK_POWER", "EUR/KW/YEAR"], ["NETWORK_ENERGY", "EUR/KWH"], ["METERING_FIXED", "EUR/POD/YEAR"], ["TRANSMISSION_ENERGY", "EUR/KWH"]];
for (const [componentCode, normalizedUnit] of timelineInputs) {
  const timeline = await resolveRegulatoryTimeline(bridge, { tenantId: "tenant_local-demo", componentCode, customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit, periodStart: "2026-07-01", periodEnd: "2026-08-01" });
  assert.equal(timeline.segments.length, 1);
  assert.equal(timeline.segments[0].customerScope, "NON_DOMESTIC_BT_BTA6");
  assert.ok(timeline.segments[0].regulatoryRecordId);
}
const generic = await bridge.list("tenant_local-demo", { componentCode: "NETWORK_FIXED", customerScope: "NON_DOMESTIC_BT", normalizedUnit: "EUR/POD/YEAR" });
assert.equal(generic.length, 0);
console.log("BTA6_NETWORK_FIXED_TIMELINE=PASS");
console.log("BTA6_NETWORK_POWER_TIMELINE=PASS");
console.log("BTA6_NETWORK_ENERGY_TIMELINE=PASS");
console.log("BTA6_METERING_TIMELINE=PASS");
console.log("BTA6_TRANSMISSION_TIMELINE=PASS");
console.log("BTA6_SCOPE_FALLBACK=NO");
console.log("ARERA_VALUES_RECONFIRMED=PASS");
console.log("BTA6_NETWORK_FIXED_RECORD=PASS");
console.log("BTA6_NETWORK_POWER_RECORD=PASS");
console.log("BTA6_NETWORK_ENERGY_RECORD=PASS");
console.log("BTA6_METERING_RECORD=PASS");
console.log("BTA6_TRANSMISSION_RECORD=PASS");
console.log("BTA6_EFFECTIVE_PERIOD_SOURCE_DERIVED=PASS");
console.log("BTA6_NETWORK_ENERGY_SEPARATE_FROM_TRANSMISSION=PASS");
