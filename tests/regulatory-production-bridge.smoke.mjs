import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { collisionDomainKey, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.idempotencyKey !== undefined && existing?.idempotencyKey === input.idempotencyKey) return existing;
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const now = input.now ?? "2026-08-25T00:00:00.000Z";
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now, payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records = this.records.filter((item) => !(item.tenantId === input.tenantId && item.recordId === input.recordId));
    this.records.push(record);
    return record;
  }
  async append(input) {
    if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT");
    const now = input.now ?? "2026-08-25T00:00:00.000Z";
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: now, updatedAt: now, payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records.push(record);
    return record;
  }
}

async function seedApproval(approvalRepository, record) {
  const domainKey = collisionDomainKey(record);
  const stateId = regulatoryApprovalDomainId(record.tenantId, domainKey);
  const previous = await approvalRepository.get(record.tenantId, stateId);
  const payload = previous?.payload ?? { domainKey, componentCode: record.componentCode, customerScope: record.customerScope, normalizedUnit: record.normalizedUnit, effectiveApprovals: [] };
  await approvalRepository.put({ tenantId: record.tenantId, recordId: stateId, payload: { ...payload, effectiveApprovals: [...payload.effectiveApprovals, { targetRecordId: record.id, targetRecordChecksum: record.checksum, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, decisionEventId: `audit_fixture_${record.id}` }] }, expectedVersion: previous?.version });
}

function value({ tenantId = "tenant_a", id = "reg-1", componentCode = "NETWORK_ENERGY", customerScope = "DOMESTIC_BT", effectiveFrom = "2026-07-01T00:00:00.000Z", effectiveTo = "2026-08-01T00:00:00.000Z", approvalStatus = "APPROVED", reviewStatus = "APPROVED", normalizedValue = 1, normalizedUnit = "EUR/KWH" } = {}) {
  const base = { tenantId, id, identityKey: `${tenantId}|${id}`, version: "1", parentVersionId: null, authority: "ARERA", sourceType: "OFFICIAL_ATTACHMENT", sourceReference: "https://official.example/regulatory-source", officialIdentifier: "REG-TEST", publicationDate: "2026-06-01T00:00:00.000Z", retrievedAt: "2026-06-02T00:00:00.000Z", effectiveFrom, effectiveTo, vector: "EE", customerScope, componentCode, originalValue: normalizedValue, originalUnit: normalizedUnit, normalizedValue, normalizedUnit, applicationBasis: "test fixture only", sourceSha256: "a".repeat(64), conversionProvenance: [], approvalStatus, reviewStatus };
  return { ...base, checksum: checksumFor(base) };
}

const repository = new MemoryRepository();
const approvals = new MemoryRepository();
const bridge = new ProductionRegulatoryPersistenceBridge(repository, approvals);
const first = value();
await bridge.save("tenant_a", first);
await seedApproval(approvals, first);
await bridge.save("tenant_a", value({ id: "reg-imported", approvalStatus: "IMPORTED", reviewStatus: "NEEDS_REVIEW" }));
const expired = value({ id: "reg-expired", effectiveFrom: "2026-05-01T00:00:00.000Z", effectiveTo: "2026-06-01T00:00:00.000Z" });
await bridge.save("tenant_a", expired);
await seedApproval(approvals, expired);
const tenantB = value({ tenantId: "tenant_b", id: "reg-b" });
await bridge.save("tenant_b", tenantB);
await seedApproval(approvals, tenantB);

assert.equal((await bridge.list("tenant_a")).length, 2, "tenant A sees only its approved records");
assert.equal((await bridge.list("tenant_b")).length, 1, "tenant B sees only its records");
assert.equal((await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" })).id, "reg-1", "effectiveFrom is inclusive");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-08-01T00:00:00.000Z" }), null, "effectiveTo is exclusive");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-06-15T00:00:00.000Z" }), null, "expired record is not resolved");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_FIXED", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" }), null, "wrong component is not returned");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "NON_DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" }), null, "wrong customer scope is not returned");
assert.equal((await bridge.resolve("tenant_b", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" })).id, "reg-b", "tenant isolation is enforced");

const unitRepository = new MemoryRepository();
const unitApprovals = new MemoryRepository();
const unitBridge = new ProductionRegulatoryPersistenceBridge(unitRepository, unitApprovals);
const unitEnergy = value({ id: "reg-uc6-energy", componentCode: "UC6", customerScope: "DOMESTIC_RESIDENT_BT", effectiveTo: "2026-09-01T00:00:00.000Z", normalizedUnit: "EUR/KWH" });
const unitPower = value({ id: "reg-uc6-power", componentCode: "UC6", customerScope: "DOMESTIC_RESIDENT_BT", effectiveTo: "2026-09-01T00:00:00.000Z", normalizedUnit: "EUR/KW/YEAR" });
await unitBridge.save("tenant_a", unitEnergy);
await seedApproval(unitApprovals, unitEnergy);
await unitBridge.save("tenant_a", unitPower);
await seedApproval(unitApprovals, unitPower);
assert.equal((await unitBridge.list("tenant_a", { componentCode: "UC6", customerScope: "DOMESTIC_RESIDENT_BT" })).length, 2, "query without normalizedUnit remains supported");
assert.deepEqual((await unitBridge.list("tenant_a", { componentCode: "UC6", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/KWH" })).map((item) => item.id), ["reg-uc6-energy"], "exact energy unit match");
assert.deepEqual((await unitBridge.list("tenant_a", { componentCode: "UC6", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/KW/YEAR" })).map((item) => item.id), ["reg-uc6-power"], "exact power unit match");
assert.equal((await unitBridge.list("tenant_a", { componentCode: "UC6", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/MWH" })).length, 0, "unknown unit does not fallback");

const conflictA = value({ id: "reg-conflict-a" });
const conflictB = value({ id: "reg-conflict-b", normalizedValue: 2 });
await bridge.save("tenant_a", conflictA);
await seedApproval(approvals, conflictA);
await bridge.save("tenant_a", conflictB);
await seedApproval(approvals, conflictB);
await assert.rejects(() => bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-15T00:00:00.000Z" }), /REGULATORY_APPROVAL_OVERLAP/);

const invalidChecksum = value({ id: "reg-invalid-checksum" });
invalidChecksum.checksum = "b".repeat(64);
await repository.append({ tenantId: "tenant_a", recordId: invalidChecksum.id, payload: invalidChecksum });
await assert.rejects(() => bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-15T00:00:00.000Z" }), /REGULATORY_CHECKSUM_INVALID/);

const invalidProvenance = value({ id: "reg-invalid-provenance" });
invalidProvenance.sourceSha256 = "invalid";
const { checksum: _ignoredChecksum, ...invalidProvenancePayload } = invalidProvenance;
invalidProvenance.checksum = checksumFor(invalidProvenancePayload);
const provenanceRepository = new MemoryRepository();
await provenanceRepository.append({ tenantId: "tenant_a", recordId: invalidProvenance.id, payload: invalidProvenance });
await assert.rejects(() => new ProductionRegulatoryPersistenceBridge(provenanceRepository, new MemoryRepository()).resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-15T00:00:00.000Z" }), /REGULATORY_PROVENANCE_INVALID/);

const tenantMismatchRepository = new MemoryRepository();
await tenantMismatchRepository.append({ tenantId: "tenant_a", recordId: "reg-tenant-mismatch", payload: value({ tenantId: "tenant_b", id: "reg-tenant-mismatch" }) });
await assert.rejects(() => new ProductionRegulatoryPersistenceBridge(tenantMismatchRepository, new MemoryRepository()).list("tenant_a"), /REGULATORY_TENANT_MISMATCH/);

const source = await readFile("app/lib/regulatory-bridge.ts", "utf8");
assert.equal(/(?:EUR\/KWH|EUR\/MWH|0\.\d+|NETWORK_FIXED|ASOS|DISPATCHING|CAPACITY_MARKET)/.test(source), false, "production bridge has no hardcoded regulatory values");
assert.equal(/fetch\(|axios|https:\/\//.test(source), false, "bridge makes no network calls");
console.log("REGULATORY_PRODUCTION_BRIDGE_SMOKE=OK");
