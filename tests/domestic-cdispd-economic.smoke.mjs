import assert from "node:assert/strict";
import { createRegulatoryValue, DOMESTIC_EQUAL_RATE_APPLICATION_BASIS, DOMESTIC_FORMAL_TIER_PROVENANCE } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { collisionDomainKey, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";
import { calculateRegulatedEeSubset } from "../app/lib/calculation/regulated-ee.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) { const existing = await this.get(input.tenantId, input.recordId); if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS"); const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", payload: structuredClone(input.payload) }; this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next; }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}

const tenant = "tenant_domestic-cdispd-economic";
const scope = "DOMESTIC_RESIDENT_BT";
const source = "https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx";
const sha = "c".repeat(64);
function value({ componentCode, normalizedUnit, normalizedValue, effectiveFrom = "2026-07-01", effectiveTo = "2026-09-01", regulatoryVariant, applicationBasis = "official QA fixture" }) {
  const base = createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: source, officialIdentifier: `QA-CDISPD-${componentCode}-${normalizedUnit}-${effectiveFrom}-${regulatoryVariant ?? ""}`, publicationDate: "2026-09-09", retrievedAt: "2026-09-09T00:00:00.000Z", effectiveFrom, effectiveTo, componentCode, customerScope: scope, ...(regulatoryVariant === undefined ? {} : { regulatoryVariant }), originalValue: normalizedValue, originalUnit: normalizedUnit, applicationBasis, sourceSha256: sha });
  return base;
}
async function bridgeWith(records) {
  const values = new MemoryRepository(); const approvals = new MemoryRepository(); const bridge = new ProductionRegulatoryPersistenceBridge(values, approvals);
  for (const record of records) await bridge.save(tenant, record);
  for (const record of records) { const domainKey = collisionDomainKey(record); const stateId = regulatoryApprovalDomainId(tenant, domainKey); const previous = await approvals.get(tenant, stateId); const state = previous?.payload ?? { domainKey, componentCode: record.componentCode, customerScope: record.customerScope, normalizedUnit: record.normalizedUnit, effectiveApprovals: [] }; await approvals.put({ tenantId: tenant, recordId: stateId, payload: { ...state, effectiveApprovals: [...state.effectiveApprovals, { targetRecordId: record.id, targetRecordChecksum: record.checksum, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, decisionEventId: `qa-${record.id}` }] }, expectedVersion: previous?.version }); }
  return bridge;
}
const fixed = [
  value({ componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.00276 }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KWH", normalizedValue: 0.00007 }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 0.1988 }),
  value({ componentCode: "NETWORK_FIXED", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 23.04 }),
  value({ componentCode: "NETWORK_POWER", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 23.52 }),
  value({ componentCode: "TRANSMISSION_ENERGY", normalizedUnit: "EUR/KWH", normalizedValue: 0.0119 }),
  value({ componentCode: "ASOS", normalizedUnit: "EUR/KWH", normalizedValue: 0.031515, applicationBasis: `${DOMESTIC_EQUAL_RATE_APPLICATION_BASIS}; ${DOMESTIC_FORMAL_TIER_PROVENANCE}` }),
  value({ componentCode: "ARIM", normalizedUnit: "EUR/KWH", normalizedValue: 0.001638, applicationBasis: `${DOMESTIC_EQUAL_RATE_APPLICATION_BASIS}; ${DOMESTIC_FORMAL_TIER_PROVENANCE}` }),
];
const cdispd = [value({ componentCode: "DISPATCHING_TOTAL", normalizedUnit: "EUR/KWH", normalizedValue: 0.038464, effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01", applicationBasis: "CDISPD aggregate dispatching + capacity market" }), value({ componentCode: "DISPATCHING_TOTAL", normalizedUnit: "EUR/KWH", normalizedValue: 0.018468, effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01", applicationBasis: "CDISPD aggregate dispatching + capacity market" })];
function request(periodStart, periodEnd, monthlyProfile) { return parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-09-09", supplyPeriod: { periodStart, periodEnd }, customerCategory: "RESIDENTIAL", residency: "RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 1000, f2: 0, f3: 0, ...(monthlyProfile ? { monthlyProfile } : {}) } }, tenant); }
const context = { vector: "EE", contractedPowerKw: 3, availablePowerKw: 4, supplyUseCategory: "DOMESTIC", domesticResidenceStatus: "RESIDENT", voltageLevel: "LV", regulatoryCustomerScope: scope };
const august = await calculateRegulatedEeSubset(request("2026-08-01", "2026-09-01"), { trustedElectricityContext: context, regulatoryBridge: await bridgeWith([...fixed, ...cdispd]) });
const augustComponent = august.components.find((component) => component.formulaId === "REGULATED_DOMESTIC_CDISPD_RATE_TIMES_KWH");
assert.equal(augustComponent?.formulaInputs.rateEurPerKwh, 0.018468);
assert.equal(augustComponent?.amount.minorUnits, 1847);
assert.equal(august.includedComponents.includes("DISPATCHING_TOTAL_ENERGY"), true);
const profile = [{ month: "2026-07", f1: 600, f2: 0, f3: 0 }, { month: "2026-08", f1: 400, f2: 0, f3: 0 }];
const cross = await calculateRegulatedEeSubset(request("2026-07-01", "2026-09-01", profile), { trustedElectricityContext: context, regulatoryBridge: await bridgeWith([...fixed, ...cdispd]) });
assert.deepEqual(cross.components.filter((component) => component.formulaId === "REGULATED_DOMESTIC_CDISPD_RATE_TIMES_KWH").map((component) => [component.formulaInputs.rateEurPerKwh, component.formulaInputs.quantityKwh]), [[0.038464, 600], [0.018468, 400]]);
const completeBridge = await bridgeWith([...fixed, ...cdispd]);
await assert.rejects(() => calculateRegulatedEeSubset(request("2026-07-01", "2026-09-01"), { trustedElectricityContext: context, regulatoryBridge: completeBridge }), /REGULATORY_CONSUMPTION_ALLOCATION_REQUIRED/);
const missingSeptemberBridge = await bridgeWith(fixed);
await assert.rejects(() => calculateRegulatedEeSubset(request("2026-09-01", "2026-10-01"), { trustedElectricityContext: context, regulatoryBridge: missingSeptemberBridge }), /REGULATORY_TIMELINE_GAP/);
assert.equal(cross.components.some((component) => component.formulaInputs.componentCode === "CAPACITY_MARKET"), false);
console.log("CDISPD_AUGUST_ECONOMIC_QA=PASS");
console.log("CDISPD_CROSS_MONTH_WITH_PROFILE=PASS");
console.log("CDISPD_CROSS_MONTH_WITHOUT_PROFILE_FAILS_CLOSED=PASS");
console.log("CDISPD_MISSING_MONTH_FAIL_CLOSED=PASS");
console.log("CDISPD_INCLUDED_IN_ECONOMIC_SUBSET=PASS");
console.log("CDISPD_NO_DECOMPOSITION=PASS");
