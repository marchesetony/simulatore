import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put() { throw new Error("PUT_NOT_USED"); }
  async append(input) {
    if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT");
    const now = input.now ?? "2026-08-25T00:00:00.000Z";
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: now, updatedAt: now, payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records.push(record);
    return record;
  }
}

function value({ tenantId = "tenant_a", id = "reg-1", componentCode = "NETWORK_ENERGY", customerScope = "DOMESTIC_BT", effectiveFrom = "2026-07-01T00:00:00.000Z", effectiveTo = "2026-08-01T00:00:00.000Z", approvalStatus = "APPROVED", reviewStatus = "APPROVED", normalizedValue = 1 } = {}) {
  const base = { tenantId, id, identityKey: `${tenantId}|${id}`, version: "1", parentVersionId: null, authority: "ARERA", sourceType: "OFFICIAL_ATTACHMENT", sourceReference: "https://official.example/regulatory-source", officialIdentifier: "REG-TEST", publicationDate: "2026-06-01T00:00:00.000Z", retrievedAt: "2026-06-02T00:00:00.000Z", effectiveFrom, effectiveTo, vector: "EE", customerScope, componentCode, originalValue: normalizedValue, originalUnit: "EUR/KWH", normalizedValue, normalizedUnit: "EUR/KWH", applicationBasis: "test fixture only", sourceSha256: "a".repeat(64), conversionProvenance: [], approvalStatus, reviewStatus };
  return { ...base, checksum: checksumFor(base) };
}

const repository = new MemoryRepository();
const bridge = new ProductionRegulatoryPersistenceBridge(repository);
await bridge.save("tenant_a", value());
await bridge.save("tenant_a", value({ id: "reg-imported", approvalStatus: "IMPORTED", reviewStatus: "NEEDS_REVIEW" }));
await bridge.save("tenant_a", value({ id: "reg-expired", effectiveFrom: "2026-05-01T00:00:00.000Z", effectiveTo: "2026-06-01T00:00:00.000Z" }));
await bridge.save("tenant_b", value({ tenantId: "tenant_b", id: "reg-b" }));

assert.equal((await bridge.list("tenant_a")).length, 2, "tenant A sees only its approved records");
assert.equal((await bridge.list("tenant_b")).length, 1, "tenant B sees only its records");
assert.equal((await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" })).id, "reg-1", "effectiveFrom is inclusive");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-08-01T00:00:00.000Z" }), null, "effectiveTo is exclusive");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-06-15T00:00:00.000Z" }), null, "expired record is not resolved");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_FIXED", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" }), null, "wrong component is not returned");
assert.equal(await bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "NON_DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" }), null, "wrong customer scope is not returned");
assert.equal((await bridge.resolve("tenant_b", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-01T00:00:00.000Z" })).id, "reg-b", "tenant isolation is enforced");

await bridge.save("tenant_a", value({ id: "reg-conflict-a" }));
await bridge.save("tenant_a", value({ id: "reg-conflict-b", normalizedValue: 2 }));
await assert.rejects(() => bridge.resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-15T00:00:00.000Z" }), /REGULATORY_APPROVED_VALUE_CONFLICT/);

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
await assert.rejects(() => new ProductionRegulatoryPersistenceBridge(provenanceRepository).resolve("tenant_a", { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveAt: "2026-07-15T00:00:00.000Z" }), /REGULATORY_PROVENANCE_INVALID/);

const tenantMismatchRepository = new MemoryRepository();
await tenantMismatchRepository.append({ tenantId: "tenant_a", recordId: "reg-tenant-mismatch", payload: value({ tenantId: "tenant_b", id: "reg-tenant-mismatch" }) });
await assert.rejects(() => new ProductionRegulatoryPersistenceBridge(tenantMismatchRepository).list("tenant_a"), /REGULATORY_TENANT_MISMATCH/);

const source = await readFile("app/lib/regulatory-bridge.ts", "utf8");
assert.equal(/(?:EUR\/KWH|EUR\/MWH|0\.\d+|NETWORK_FIXED|ASOS|DISPATCHING|CAPACITY_MARKET)/.test(source), false, "production bridge has no hardcoded regulatory values");
assert.equal(/fetch\(|axios|https:\/\//.test(source), false, "bridge makes no network calls");
console.log("REGULATORY_PRODUCTION_BRIDGE_SMOKE=OK");
