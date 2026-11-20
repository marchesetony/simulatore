import assert from "node:assert/strict";
import { createRegulatoryValue, DOMESTIC_EQUAL_RATE_APPLICATION_BASIS, DOMESTIC_FORMAL_TIER_PROVENANCE } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { collisionDomainKey, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";
import { calculateRegulatedEeSubset } from "../app/lib/calculation/regulated-ee.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { CALCULATED_REGULATORY_DOMAINS, isCalculatedRegulatoryDomain } from "../app/lib/regulatory-refresh/registry.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) { const existing = await this.get(input.tenantId, input.recordId); if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS"); const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", payload: structuredClone(input.payload) }; this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next; }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}

const tenant = "tenant_domestic-non-resident-arera";
const scope = "DOMESTIC_NON_RESIDENT_BT";
const source = "https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx";
const sha = "c".repeat(64);
function value({ componentCode, normalizedUnit, normalizedValue, effectiveFrom = "2026-07-01", effectiveTo = "2026-09-01", regulatoryVariant, applicationBasis = "official QA fixture" }) {
  const base = createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: source, officialIdentifier: `QA-NONRES-${componentCode}-${normalizedUnit}-${effectiveFrom}-${regulatoryVariant ?? ""}`, publicationDate: "2026-09-09", retrievedAt: "2026-09-09T00:00:00.000Z", effectiveFrom, effectiveTo, componentCode, customerScope: scope, ...(regulatoryVariant === undefined ? {} : { regulatoryVariant }), originalValue: normalizedValue, originalUnit: normalizedUnit, applicationBasis, sourceSha256: sha });
  return base;
}
async function bridgeWith(records) {
  const values = new MemoryRepository(); const approvals = new MemoryRepository(); const bridge = new ProductionRegulatoryPersistenceBridge(values, approvals);
  for (const record of records) await bridge.save(tenant, record);
  for (const record of records) { const domainKey = collisionDomainKey(record); const stateId = regulatoryApprovalDomainId(tenant, domainKey); const previous = await approvals.get(tenant, stateId); const state = previous?.payload ?? { domainKey, componentCode: record.componentCode, customerScope: record.customerScope, normalizedUnit: record.normalizedUnit, effectiveApprovals: [] }; await approvals.put({ tenantId: tenant, recordId: stateId, payload: { ...state, effectiveApprovals: [...state.effectiveApprovals, { targetRecordId: record.id, targetRecordChecksum: record.checksum, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, decisionEventId: `qa-${record.id}` }] }, expectedVersion: previous?.version }); }
  return bridge;
}
// Tony (29/10, BE FAMILY FAST 26): "ancora esiste dato non letto arera". A non-resident household is priced on the ARERA
// tables like a resident one, with the ASOS/ARIM quota fissa of its own row; CDISPD comes with the offer pass-throughs.
for (const [componentCode, normalizedUnit] of [["ASOS", "EUR/KWH"], ["ASOS", "EUR/POD/YEAR"], ["ARIM", "EUR/KWH"], ["ARIM", "EUR/POD/YEAR"], ["UC3", "EUR/KWH"], ["UC6", "EUR/KWH"], ["UC6", "EUR/KW/YEAR"], ["NETWORK_FIXED", "EUR/POD/YEAR"], ["NETWORK_POWER", "EUR/KW/YEAR"], ["TRANSMISSION_ENERGY", "EUR/KWH"]]) {
  assert.equal(isCalculatedRegulatoryDomain({ componentCode, customerScope: scope, normalizedUnit }), true, `${componentCode} ${normalizedUnit}`);
}
assert.equal(CALCULATED_REGULATORY_DOMAINS.some((domain) => domain.customerScope === scope && domain.componentCode === "DISPATCHING_TOTAL"), false);
const records = [
  value({ componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.00276 }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KWH", normalizedValue: 0.00007 }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 0.1988 }),
  value({ componentCode: "NETWORK_FIXED", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 23.04 }),
  value({ componentCode: "NETWORK_POWER", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 23.52 }),
  value({ componentCode: "TRANSMISSION_ENERGY", normalizedUnit: "EUR/KWH", normalizedValue: 0.0119 }),
  value({ componentCode: "ASOS", normalizedUnit: "EUR/KWH", normalizedValue: 0.0285 }),
  value({ componentCode: "ASOS", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 120 }),
  value({ componentCode: "ARIM", normalizedUnit: "EUR/KWH", normalizedValue: 0.0045 }),
  value({ componentCode: "ARIM", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 24 }),
];
const request = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-09-09", supplyPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" }, customerCategory: "RESIDENTIAL", residency: "NON_RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 0, f3: 0 } }, tenant);
const context = { vector: "EE", contractedPowerKw: 3, availablePowerKw: 3.3, supplyUseCategory: "DOMESTIC", domesticResidenceStatus: "NON_RESIDENT", voltageLevel: "LV", regulatoryCustomerScope: scope };
const result = await calculateRegulatedEeSubset(request, { trustedElectricityContext: context, regulatoryBridge: await bridgeWith(records) });
const amount = (formulaId) => result.components.filter((component) => component.formulaId === formulaId).reduce((total, component) => total + component.amount.minorUnits, 0);
assert.equal(amount("REGULATED_DOMESTIC_ASOS_FIXED_RATE_TIMES_TIME"), 1000);
assert.equal(amount("REGULATED_DOMESTIC_ARIM_FIXED_RATE_TIMES_TIME"), 200);
assert.equal(amount("REGULATED_DOMESTIC_ASOS_ENERGY_RATE_TIMES_KWH"), 285);
assert.equal(amount("REGULATED_DOMESTIC_ARIM_ENERGY_RATE_TIMES_KWH"), 45);
assert.equal(amount("REGULATED_NETWORK_FIXED_RATE_TIMES_TIME"), 192);
assert.equal(result.components.some((component) => component.formulaId === "REGULATED_DOMESTIC_CDISPD_RATE_TIMES_KWH"), false);
assert.equal(result.includedComponents.includes("ASOS_FIXED") && result.includedComponents.includes("ARIM_FIXED"), true);
assert.equal(result.includedComponents.includes("DISPATCHING_TOTAL_ENERGY"), false);
console.log("domestic non-resident ARERA ok");
