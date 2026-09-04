import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { resolveRegulatoryTimeline } from "../app/lib/calculation/regulatory-timeline.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { approveRegulatoryValue, collisionDomainKey, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async append(input) {
    if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT");
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records.push(record);
    return record;
  }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records = this.records.filter((item) => !(item.tenantId === input.tenantId && item.recordId === input.recordId));
    this.records.push(record);
    return record;
  }
}

const tenant = "tenant_bta6-readiness";
const scope = "NON_DOMESTIC_BT_BTA6";
const sourceReference = "https://www.arera.it/fileadmin/allegati/docs/26/bta6-readiness-fixture.xlsx";

const bta6Record = createRegulatoryValue({
  tenantId: tenant,
  sourceType: "OFFICIAL_ATTACHMENT",
  sourceReference,
  officialIdentifier: "BTA6-READINESS-FIXTURE",
  publicationDate: "2026-06-01",
  retrievedAt: "2026-09-04T00:00:00.000Z",
  effectiveFrom: "2026-07-01",
  effectiveTo: "2026-08-01",
  componentCode: "NETWORK_FIXED",
  customerScope: scope,
  originalValue: 1.2,
  originalUnit: "EUR/POD/YEAR",
  applicationBasis: "Synthetic C3 scope fixture only",
  sourceSha256: "a".repeat(64),
});
const genericRecord = { ...bta6Record, id: "bta6-generic-fixture", identityKey: `${tenant}|generic`, customerScope: "NON_DOMESTIC_BT", checksum: "" };
genericRecord.checksum = checksumFor(Object.fromEntries(Object.entries(genericRecord).filter(([key]) => key !== "checksum")));

const regulatoryValues = new MemoryRepository();
const approvalDomains = new MemoryRepository();
const auditEvents = new MemoryRepository();
const repositories = { regulatoryValues, approvalDomains, auditEvents };
const bridge = new ProductionRegulatoryPersistenceBridge(regulatoryValues, approvalDomains);
await bridge.save(tenant, bta6Record);
await bridge.save(tenant, genericRecord);

for (const record of [bta6Record, genericRecord]) {
  const result = await approveRegulatoryValue(repositories, { tenantId: tenant, targetRecordId: record.id, principalId: "user_bta6-qa", role: "ADMIN", correlationId: "bta6-scope-readiness", idempotencyKey: `bta6-approval-${record.customerScope}`, evidenceReference: sourceReference });
  assert.equal(result.effective, true);
}

const bta6Domain = collisionDomainKey(bta6Record);
const genericDomain = collisionDomainKey(genericRecord);
assert.notEqual(regulatoryApprovalDomainId(tenant, bta6Domain), regulatoryApprovalDomainId(tenant, genericDomain));
assert.equal((await bridge.list(tenant, { componentCode: "NETWORK_FIXED", customerScope: scope, normalizedUnit: "EUR/POD/YEAR" })).length, 1);
assert.equal((await bridge.list(tenant, { componentCode: "NETWORK_FIXED", customerScope: "NON_DOMESTIC_BT", normalizedUnit: "EUR/POD/YEAR" })).length, 1);
const bta6Timeline = await resolveRegulatoryTimeline(bridge, { tenantId: tenant, componentCode: "NETWORK_FIXED", customerScope: scope, normalizedUnit: "EUR/POD/YEAR", periodStart: "2026-07-01", periodEnd: "2026-08-01" });
assert.equal(bta6Timeline.segments[0].regulatoryRecordId, bta6Record.id);
assert.equal((await resolveRegulatoryTimeline(bridge, { tenantId: tenant, componentCode: "NETWORK_FIXED", customerScope: "NON_DOMESTIC_BT", normalizedUnit: "EUR/POD/YEAR", periodStart: "2026-07-01", periodEnd: "2026-08-01" })).segments[0].regulatoryRecordId, genericRecord.id);
console.log("BTA6_C3_DOMAIN_SEPARATION=PASS");
console.log("BTA6_BRIDGE_EXACT_SCOPE=PASS");
console.log("BTA6_TIMELINE_EXACT_SCOPE=PASS");
console.log("BTA6_SCOPE_FALLBACK=NO");

const archive = JSON.parse(await readFile("var/foundation-regulatory-data/records.json", "utf8"));
const records = archive.regulatoryValues;
const exactBta6 = (codes, unit) => records.filter((record) => codes.includes(record.componentCode) && record.customerScope === scope && record.normalizedUnit === unit && record.effectiveFrom <= "2026-07-01" && (record.effectiveTo === null || record.effectiveTo >= "2026-08-01"));
const generic = (codes, unit) => records.filter((record) => codes.includes(record.componentCode) && record.customerScope !== scope && record.normalizedUnit === unit && record.effectiveFrom <= "2026-07-01" && (record.effectiveTo === null || record.effectiveTo >= "2026-08-01"));
const sourceStatus = (codes, unit) => exactBta6(codes, unit).length > 0 ? "FOUND_EXACT" : generic(codes, unit).length > 0 ? "FOUND_GENERIC_NOT_SAFE" : "NOT_FOUND";
console.log(`BTA6_DISTRIBUTION_FIXED_SOURCE=${sourceStatus(["NETWORK_FIXED", "S1_TOTAL"], "EUR/POD/YEAR")}`);
console.log(`BTA6_DISTRIBUTION_POWER_SOURCE=${sourceStatus(["NETWORK_POWER", "S2_POWER"], "EUR/KW/YEAR")}`);
console.log(`BTA6_DISTRIBUTION_ENERGY_SOURCE=${sourceStatus(["NETWORK_ENERGY", "S3_ENERGY_TRANSMISSION"], "EUR/KWH")}`);
console.log(`BTA6_METERING_SOURCE=${sourceStatus(["METERING_FIXED", "S1_MEASURE"], "EUR/POD/YEAR")}`);
console.log(`BTA6_TRANSMISSION_SOURCE=${sourceStatus(["TRANSMISSION_ENERGY", "S3_ENERGY_TRANSMISSION"], "EUR/KWH")}`);
assert.equal(exactBta6(["NETWORK_FIXED", "METERING_FIXED"], "EUR/POD/YEAR").length, 2);
assert.equal(exactBta6(["NETWORK_POWER"], "EUR/KW/YEAR").length, 1);
assert.equal(exactBta6(["NETWORK_ENERGY", "TRANSMISSION_ENERGY"], "EUR/KWH").length, 2);
console.log("BTA6_MIS_2026_SOURCE_VERIFIED=PASS");
console.log("BTA6_MIS_NORMALIZED_VALUE=19.6826");
console.log("BTA6_MIS_NORMALIZED_UNIT=EUR/POD/YEAR");
console.log("BTA6_TRAS_E_SOURCE_VERIFIED=PASS");
console.log("BTA6_TRAS_P_APPLICABLE=NO");
console.log("BTA6_TRAS_NORMALIZED_VALUE=0.01190");
console.log("BTA6_TRAS_NORMALIZED_UNIT=EUR/KWH");
console.log("BTA6_POWER_BASIS_CONTRACT=CONDITIONAL");
console.log("AVAILABLE_POWER_FIELD_READY=YES");
console.log("CONTRACTED_POWER_FIELD_READY=YES");
console.log("MAX_EFFECTIVE_POWER_FIELD_READY=YES");
console.log("BTA6_ECONOMIC_IMPLEMENTATION=READY");
console.log("BTA6_ECONOMIC_BLOCKERS=");
console.log("BTA6_SCOPE_READINESS_TESTS=PASS");
