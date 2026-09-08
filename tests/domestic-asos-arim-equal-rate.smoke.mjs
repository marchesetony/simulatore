import assert from "node:assert/strict";

import { createRegulatoryValue, DOMESTIC_EQUAL_RATE_APPLICATION_BASIS, DOMESTIC_FORMAL_TIER_PROVENANCE, assertDomesticFormalTierRatesEqual } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { collisionDomainKey, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";
import { CALCULATED_REGULATORY_DOMAINS, AUTO_REFRESH_REGISTERED_DOMAINS, assertAutoRefreshCoverage } from "../app/lib/regulatory-refresh/registry.ts";
import { calculateRegulatedEeSubset } from "../app/lib/calculation/regulated-ee.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((item) => item.tenantId === tenantId && item.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((item) => item.tenantId === tenantId); }
  async append(input) {
    if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT");
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z", payload: structuredClone(input.payload) };
    this.records.push(record);
    return record;
  }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z", payload: structuredClone(input.payload) };
    this.records = this.records.filter((item) => !(item.tenantId === input.tenantId && item.recordId === input.recordId));
    this.records.push(record);
    return record;
  }
}

const tenant = "tenant_domestic-equal-rate-smoke";
const scope = "DOMESTIC_RESIDENT_BT";
const officialSource = "https://www.arera.it/fileadmin/allegati/docs/26/227-2026-R-com-TABELLE.xlsx";
const sourceSha256 = "a".repeat(64);
const equalBasis = `${DOMESTIC_EQUAL_RATE_APPLICATION_BASIS}; ${DOMESTIC_FORMAL_TIER_PROVENANCE}; official equal-rate fixture`;

function value({ componentCode, normalizedUnit, normalizedValue, effectiveFrom = "2026-01-01", effectiveTo = null, applicationBasis = "official QA fixture" }) {
  return createRegulatoryValue({
    tenantId: tenant,
    sourceType: "OFFICIAL_ATTACHMENT",
    sourceReference: officialSource,
    officialIdentifier: `QA:${componentCode}:${normalizedUnit}:${effectiveFrom}:${effectiveTo ?? "OPEN"}`,
    publicationDate: "2026-06-25",
    retrievedAt: "2026-09-08T00:00:00.000Z",
    effectiveFrom,
    effectiveTo,
    componentCode,
    customerScope: scope,
    originalValue: normalizedUnit === "EUR/KWH" ? normalizedValue * 100 : normalizedValue,
    originalUnit: normalizedUnit === "EUR/KWH" ? "CENT_EUR/KWH" : normalizedUnit,
    applicationBasis,
    sourceSha256,
  });
}

const baseRecords = [
  value({ componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.00276 }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KWH", normalizedValue: 0.00007 }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 0.1988 }),
  value({ componentCode: "NETWORK_FIXED", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 12 }),
  value({ componentCode: "NETWORK_POWER", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 12 }),
  value({ componentCode: "TRANSMISSION_ENERGY", normalizedUnit: "EUR/KWH", normalizedValue: 0.01 }),
  value({ componentCode: "ASOS", normalizedUnit: "EUR/KWH", normalizedValue: 0.028657, effectiveTo: "2026-07-01", applicationBasis: equalBasis }),
  value({ componentCode: "ASOS", normalizedUnit: "EUR/KWH", normalizedValue: 0.031515, effectiveFrom: "2026-07-01", applicationBasis: equalBasis }),
  value({ componentCode: "ARIM", normalizedUnit: "EUR/KWH", normalizedValue: 0.001638, applicationBasis: equalBasis }),
];

async function bridgeWith(records) {
  const repository = new MemoryRepository();
  const approvals = new MemoryRepository();
  const bridge = new ProductionRegulatoryPersistenceBridge(repository, approvals);
  for (const record of records) await bridge.save(tenant, record);
  for (const record of records) {
    const domainKey = collisionDomainKey(record);
    const stateId = regulatoryApprovalDomainId(tenant, domainKey);
    const current = await approvals.get(tenant, stateId);
    const state = current?.payload ?? { domainKey, componentCode: record.componentCode, customerScope: record.customerScope, normalizedUnit: record.normalizedUnit, effectiveApprovals: [] };
    await approvals.put({ tenantId: tenant, recordId: stateId, payload: { ...state, effectiveApprovals: [...state.effectiveApprovals, { targetRecordId: record.id, targetRecordChecksum: record.checksum, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, decisionEventId: `qa-${record.id}` }] }, expectedVersion: current?.version });
  }
  return bridge;
}

function request(consumption, periodStart = "2026-07-01", periodEnd = "2026-08-01") {
  return parseSimulationRequest({
    schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-07-15", supplyPeriod: { periodStart, periodEnd }, customerCategory: "RESIDENTIAL", residency: "RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: consumption, f2: 0, f3: 0 },
  }, tenant);
}

const context = { vector: "EE", contractedPowerKw: 3, availablePowerKw: 3.3, supplyUseCategory: "DOMESTIC", domesticResidenceStatus: "RESIDENT", voltageLevel: "LV", regulatoryCustomerScope: scope };
const bridge = await bridgeWith(baseRecords);

assert.equal(CALCULATED_REGULATORY_DOMAINS.length, 31);
assert.equal(AUTO_REFRESH_REGISTERED_DOMAINS.length, 31);
assertAutoRefreshCoverage();
assert.ok(CALCULATED_REGULATORY_DOMAINS.some((domain) => domain.componentCode === "ASOS" && domain.customerScope === scope && domain.normalizedUnit === "EUR/KWH" && domain.regulatoryVariant === undefined));
assert.ok(CALCULATED_REGULATORY_DOMAINS.some((domain) => domain.componentCode === "ARIM" && domain.customerScope === scope && domain.normalizedUnit === "EUR/KWH" && domain.regulatoryVariant === undefined));
assert.equal(CALCULATED_REGULATORY_DOMAINS.filter((domain) => domain.customerScope === scope && (domain.componentCode === "ASOS" || domain.componentCode === "ARIM")).length, 2);

assert.equal(assertDomesticFormalTierRatesEqual("ASOS", [3.1515, 3.1515]), 3.1515);
assert.equal(assertDomesticFormalTierRatesEqual("ARIM", [0.1638, 0.1638]), 0.1638);

const julyResults = await Promise.all([1000, 3000, 5000].map((kwh) => calculateRegulatedEeSubset(request(kwh), { trustedElectricityContext: context, regulatoryBridge: bridge })));
const rates = julyResults.map((result) => ({ asos: result.components.find((component) => component.formulaId === "REGULATED_DOMESTIC_ASOS_ENERGY_RATE_TIMES_KWH")?.formulaInputs.rateEurPerKwh, arim: result.components.find((component) => component.formulaId === "REGULATED_DOMESTIC_ARIM_ENERGY_RATE_TIMES_KWH")?.formulaInputs.rateEurPerKwh }));
assert.deepEqual(rates, [{ asos: 0.031515, arim: 0.001638 }, { asos: 0.031515, arim: 0.001638 }, { asos: 0.031515, arim: 0.001638 }]);
assert.equal(julyResults[0].components.find((component) => component.formulaId === "REGULATED_DOMESTIC_ASOS_ENERGY_RATE_TIMES_KWH")?.amount.minorUnits, 3152);
assert.equal(julyResults[0].components.find((component) => component.formulaId === "REGULATED_DOMESTIC_ARIM_ENERGY_RATE_TIMES_KWH")?.amount.minorUnits, 164);
assert.equal(julyResults[0].components.some((component) => component.formulaId.includes("ASOS") && component.category !== "REGULATED_ENERGY"), false);
assert.equal(julyResults[0].components.some((component) => component.formulaId.includes("ARIM") && component.category !== "REGULATED_ENERGY"), false);
assert.equal(julyResults[0].includedComponents.includes("ASOS_ENERGY"), true);
assert.equal(julyResults[0].includedComponents.includes("ARIM_ENERGY"), true);
assert.equal(julyResults[0].partialWarning, "REGULATED_SUBSET_PARTIAL_DOMESTIC_NETWORK_UC3_UC6_ASOS_ARIM_ONLY");

assert.equal(julyResults[0].references.find((reference) => reference.componentCode === "ASOS")?.applicationBasis.includes(DOMESTIC_EQUAL_RATE_APPLICATION_BASIS), true);
assert.equal(julyResults[0].references.find((reference) => reference.componentCode === "ARIM")?.applicationBasis.includes(DOMESTIC_FORMAL_TIER_PROVENANCE), true);
assert.equal(julyResults[0].components.find((component) => component.formulaId === "REGULATED_DOMESTIC_ASOS_ENERGY_RATE_TIMES_KWH")?.formulaInputs.quantityKwh, 1000);
assert.equal(julyResults[0].components.find((component) => component.formulaId === "REGULATED_DOMESTIC_ARIM_ENERGY_RATE_TIMES_KWH")?.formulaInputs.quantityKwh, 1000);

const crossChange = request(2000, "2026-06-01", "2026-08-01");
await assert.rejects(() => calculateRegulatedEeSubset(crossChange, { trustedElectricityContext: context, regulatoryBridge: bridge }), /REGULATORY_CONSUMPTION_ALLOCATION_REQUIRED/);
const profiledCrossChange = parseSimulationRequest({
  ...crossChange,
  consumption: { basis: "PERIOD", unit: "KWH", f1: 2000, f2: 0, f3: 0, monthlyProfile: [{ month: "2026-06", f1: 1000, f2: 0, f3: 0 }, { month: "2026-07", f1: 1000, f2: 0, f3: 0 }] },
}, tenant);
const profileResult = await calculateRegulatedEeSubset(profiledCrossChange, { trustedElectricityContext: context, regulatoryBridge: bridge });
assert.deepEqual(profileResult.components.filter((component) => component.formulaId === "REGULATED_DOMESTIC_ASOS_ENERGY_RATE_TIMES_KWH").map((component) => [component.formulaInputs.rateEurPerKwh, component.formulaInputs.quantityKwh]), [[0.028657, 1000], [0.031515, 1000]]);
assert.equal(profileResult.components.filter((component) => component.formulaId === "REGULATED_DOMESTIC_ARIM_ENERGY_RATE_TIMES_KWH").length, 1);

console.log("DOMESTIC_TIER_ALLOCATION_USED=NO");
console.log("DOMESTIC_EQUAL_RATE_COLLAPSE_MATHEMATICALLY_EQUIVALENT=PASS");
console.log("ASOS_EQUAL_RATE_LOW_HIGH_CONSUMPTION=PASS");
console.log("ARIM_EQUAL_RATE_LOW_HIGH_CONSUMPTION=PASS");
console.log("DOMESTIC_ASOS_CURRENT_ECONOMIC=PASS");
console.log("DOMESTIC_ARIM_CURRENT_ECONOMIC=PASS");
console.log("DOMESTIC_MULTI_RATE_PERIOD_REQUIRES_PROFILE=PASS");
console.log("DOMESTIC_ASOS_CROSS_CHANGE_FAIL_CLOSED=PASS");
console.log("DOMESTIC_ASOS_CROSS_CHANGE_WITH_PROFILE=PASS");
console.log("DOMESTIC_ASOS_DOUBLE_COUNT_PREVENTED=PASS");
console.log("DOMESTIC_ARIM_DOUBLE_COUNT_PREVENTED=PASS");
console.log("DOMESTIC_ASOS_ARIM_EQUAL_RATE_ENGINE=PASS");
