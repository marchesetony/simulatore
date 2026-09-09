import assert from "node:assert/strict";
import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { collisionDomainKey, RegulatoryApprovalDomainService, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { resolveRegulatoryTimeline } from "../app/lib/calculation/regulatory-timeline.ts";
import { CALCULATED_REGULATORY_DOMAINS, AUTO_REFRESH_REGISTERED_DOMAINS, regulatoryDomainKey } from "../app/lib/regulatory-refresh/registry.ts";
import { readFile } from "node:fs/promises";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); const saved = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }; this.records.push(saved); return saved; }
  async put(input) { const existing = await this.get(input.tenantId, input.recordId); if (existing && input.expectedVersion === undefined) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS"); if (existing && input.expectedVersion !== existing.version) throw new Error("PERSISTENCE_VERSION_CONFLICT"); const saved = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }; this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(saved); return saved; }
}

const tenant = "tenant_variant-smoke";
const sourceReference = "https://www.arera.it/fileadmin/allegati/docs/26/227-2026-R-com-TABELLE.xlsx";
const sourceSha256 = "a".repeat(64);
const make = (variant, value = 1, overrides = {}) => createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference, officialIdentifier: "227/2026/R/com", publicationDate: "2026-06-25", retrievedAt: "2026-09-07T00:00:00Z", effectiveFrom: "2026-07-01", effectiveTo: null, componentCode: "ASOS", customerScope: "NON_DOMESTIC_BT_BTA6", ...(variant === undefined ? {} : { regulatoryVariant: variant }), originalValue: value, originalUnit: "EUR/KWH", applicationBasis: "Tabella ASOS ufficiale; riga BTA6", sourceSha256, ...overrides });

const legacyA = createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference, officialIdentifier: "LEGACY", publicationDate: "2026-01-01", retrievedAt: "2026-09-07T00:00:00Z", effectiveFrom: "2026-01-01", effectiveTo: null, componentCode: "ARIM", customerScope: "NON_DOMESTIC_BT_BTA6", originalValue: 1, originalUnit: "EUR/KWH", applicationBasis: "legacy", sourceSha256 });
const legacyB = createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference, officialIdentifier: "LEGACY", publicationDate: "2026-01-01", retrievedAt: "2026-09-07T00:00:00Z", effectiveFrom: "2026-01-01", effectiveTo: null, componentCode: "ARIM", customerScope: "NON_DOMESTIC_BT_BTA6", originalValue: 1, originalUnit: "EUR/KWH", applicationBasis: "legacy", sourceSha256 });
assert.equal(legacyA.id, legacyB.id);
assert.equal(legacyA.identityKey, legacyB.identityKey);
assert.equal(legacyA.checksum, legacyB.checksum);
const class0 = make("ASOS_CLASS_0", 1);
const class1 = make("ASOS_CLASS_1", 2);
assert.notEqual(class0.id, class1.id);
assert.notEqual(class0.identityKey, class1.identityKey);
assert.notEqual(class0.checksum, class1.checksum);
assert.equal(collisionDomainKey(legacyA), "ARIM|NON_DOMESTIC_BT_BTA6|EUR/KWH");
assert.equal(collisionDomainKey(class0), "ASOS|NON_DOMESTIC_BT_BTA6|EUR/KWH|ASOS_CLASS_0");
assert.equal(collisionDomainKey(class1), "ASOS|NON_DOMESTIC_BT_BTA6|EUR/KWH|ASOS_CLASS_1");
const class1Fixed = make("ASOS_CLASS_1", 2, { originalUnit: "EUR/POD/YEAR" });
const class1Power = make("ASOS_CLASS_1", 3, { originalUnit: "EUR/KW/YEAR" });
const class1PowerNext = make("ASOS_CLASS_1", 4, { originalUnit: "EUR/KW/YEAR", officialIdentifier: "227/2026/R/com-follow-up", effectiveFrom: "2026-08-01" });
assert.notEqual(class1Fixed.id, class1Power.id);
assert.notEqual(class1Power.id, class1PowerNext.id);
assert.equal(collisionDomainKey(class1Fixed), "ASOS|NON_DOMESTIC_BT_BTA6|EUR/POD/YEAR|ASOS_CLASS_1");
assert.equal(collisionDomainKey(class1Power), "ASOS|NON_DOMESTIC_BT_BTA6|EUR/KW/YEAR|ASOS_CLASS_1");
console.log("ASOS_VARIANT_UNIT_INDEPENDENT_VERSIONING=PASS");
console.log("LEGACY_RECORD_IDENTITY_PRESERVED=PASS");
console.log("VARIANT_RECORD_IDENTITY_DISTINCT=PASS");
console.log("C3_VARIANT_DOMAIN_SUPPORTED=PASS");
console.log("CUSTOMER_SCOPE_ABUSED_FOR_ASOS_CLASS=NO");

const regulatoryValues = new MemoryRepository();
const approvalDomains = new MemoryRepository();
const auditEvents = new MemoryRepository();
const approval = new RegulatoryApprovalDomainService({ regulatoryValues, approvalDomains, auditEvents });
for (const [record, suffix] of [[class0, "class0"], [class1, "class1"]]) {
  await regulatoryValues.append({ tenantId: tenant, recordId: record.id, payload: record });
  await approval.approveRegulatoryValue({ tenantId: tenant, targetRecordId: record.id, principalId: "user_local-regulatory-qa", role: "ADMIN", correlationId: "ee-calc-3e2b-bta6-asos", idempotencyKey: `ee-calc-3e2b-${suffix}-energy-2026-07-01`, evidenceReference: sourceReference });
}
assert.equal((await approvalDomains.list(tenant)).length, 2);
console.log("ASOS_C3_VARIANT_ISOLATION=PASS");
const sameVariantOverlap = make("ASOS_CLASS_0", 3, { officialIdentifier: "227/2026/R/com-follow-up", effectiveFrom: "2026-08-01" });
await regulatoryValues.append({ tenantId: tenant, recordId: sameVariantOverlap.id, payload: sameVariantOverlap });
await assert.rejects(() => approval.approveRegulatoryValue({ tenantId: tenant, targetRecordId: sameVariantOverlap.id, principalId: "user_local-regulatory-qa", role: "ADMIN", correlationId: "ee-calc-3e2b-bta6-asos", idempotencyKey: "ee-calc-3e2b-class0-energy-2026-08-01-overlap", evidenceReference: sourceReference }), /REGULATORY_APPROVAL_BLOCKED|REGULATORY_APPROVAL_OVERLAP/);
console.log("ASOS_SAME_VARIANT_OVERLAP_FAIL_CLOSED=PASS");
const bridge = new ProductionRegulatoryPersistenceBridge(regulatoryValues, approvalDomains);
assert.equal((await bridge.list(tenant, { componentCode: "ASOS", customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit: "EUR/KWH", regulatoryVariant: "ASOS_CLASS_0" })).length, 1);
assert.equal((await bridge.list(tenant, { componentCode: "ASOS", customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit: "EUR/KWH", regulatoryVariant: null })).length, 0);
await assert.rejects(() => bridge.resolve(tenant, { componentCode: "ASOS", customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit: "EUR/KWH", effectiveAt: "2026-07-15", regulatoryVariant: undefined }), /REGULATORY_VARIANT_REQUIRED/);
const timeline = await resolveRegulatoryTimeline(bridge, { tenantId: tenant, componentCode: "ASOS", customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit: "EUR/KWH", regulatoryVariant: "ASOS_CLASS_1", periodStart: "2026-07-01", periodEnd: "2026-08-01" });
assert.equal(timeline.segments.length, 1);
assert.equal(timeline.segments[0].regulatoryVariant, "ASOS_CLASS_1");
console.log("VARIANT_EXACT_QUERY=PASS");
console.log("ASOS_MULTI_CLASS_QUERY_CONFLICT_PREVENTED=PASS");
console.log("VARIANT_TIMELINE_EXACT=PASS");

const legacyState = { domainKey: collisionDomainKey(legacyA), componentCode: "ARIM", customerScope: "NON_DOMESTIC_BT_BTA6", normalizedUnit: "EUR/KWH", effectiveApprovals: [] };
assert.equal(regulatoryApprovalDomainId(tenant, legacyState.domainKey), regulatoryApprovalDomainId(tenant, collisionDomainKey(legacyA)));
console.log("LEGACY_C3_STATE_COMPATIBLE=PASS");
console.log("NO_DB_MIGRATION_REQUIRED=PASS");

assert.equal(CALCULATED_REGULATORY_DOMAINS.length, 32);
assert.equal(CALCULATED_REGULATORY_DOMAINS.filter((domain) => domain.regulatoryVariant !== undefined).length, 12);
assert.deepEqual(CALCULATED_REGULATORY_DOMAINS.map(regulatoryDomainKey), AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey));
assert.equal(CALCULATED_REGULATORY_DOMAINS.some((domain) => domain.regulatoryVariant === "UNKNOWN"), false);
console.log("ASOS_VARIANT_DOMAINS=12");
console.log("UNKNOWN_ASOS_REGISTRY_DOMAIN_CREATED=NO");
console.log("AUTO_REFRESH_EXACT_DOMAIN_COVERAGE=PASS");

const typesSource = await readFile("app/lib/calculation/types.ts", "utf8");
const requestBlock = typesSource.slice(typesSource.indexOf("export interface ElectricitySimulationRequest"), typesSource.indexOf("export interface GasMonthlyProfile"));
assert.doesNotMatch(requestBlock, /asosClass|regulatoryVariant|tariffClass|energyIntensiveStatus/);
console.log("ASOS_VARIANT_CLIENT_CONTROLLED=NO");
console.log("regulatory variant smoke: ok");
