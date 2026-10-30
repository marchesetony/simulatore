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

import { parseArera588BtaUpTo165ArimTableRows, parseArera588BtaUpTo165Uc3Uc6TableRows } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { btaTariffClass } from "../app/lib/calculation/trusted-ee-supply-context.ts";

// Tony (30/10, AZIENDA PROTETTA, business 3 kW in BT): "credo ci siano errori ancora". Rete and oneri showed "Non verificato
// su ARERA: tabelle ARERA non ancora caricate (NON_DOMESTIC_BT)". BT other uses up to 16,5 kW are priced on the ARERA tables
// of their TIT class (BTA1 fino a 1,5 kW ... BTA5 fino a 16,5 kW), read by the automatic refresh.
assert.deepEqual([1.5, 3, 3.3, 6, 10, 16.5, 16.6].map(btaTariffClass), ["BTA1", "BTA2", "BTA3", "BTA3", "BTA4", "BTA5", null]);
const tenant = "tenant_bta1-5-arera";
const scope = "NON_DOMESTIC_BT_BTA1_5";
for (const variant of ["BTA1", "BTA2", "BTA3", "BTA4", "BTA5"]) for (const [componentCode, normalizedUnit] of [["NETWORK_FIXED", "EUR/POD/YEAR"], ["NETWORK_POWER", "EUR/KW/YEAR"], ["NETWORK_ENERGY", "EUR/KWH"]]) assert.equal(isCalculatedRegulatoryDomain({ componentCode, customerScope: scope, normalizedUnit, regulatoryVariant: variant }), true);
for (const [componentCode, normalizedUnit] of [["METERING_FIXED", "EUR/POD/YEAR"], ["TRANSMISSION_ENERGY", "EUR/KWH"]]) assert.equal(isCalculatedRegulatoryDomain({ componentCode, customerScope: scope, normalizedUnit }), true);
// Tony (30/10, "ancora errori"): the refresh diagnostics showed the 588 and ASOS rows "fino a 16,5 kW" split by potenza
// impegnata into five sub-rows, so UC3/UC6, ARIM and ASOS have one domain per BTA class (ASOS also per agevolazione class).
for (const variant of ["BTA1", "BTA2", "BTA3", "BTA4", "BTA5"]) {
  for (const [componentCode, normalizedUnit] of [["UC3", "EUR/KWH"], ["UC6", "EUR/KWH"], ["UC6", "EUR/POD/YEAR"], ["UC6", "EUR/KW/YEAR"], ["ARIM", "EUR/POD/YEAR"], ["ARIM", "EUR/KW/YEAR"], ["ARIM", "EUR/KWH"]]) assert.equal(isCalculatedRegulatoryDomain({ componentCode, customerScope: scope, normalizedUnit, regulatoryVariant: variant }), true);
  for (const asos of ["ASOS_CLASS_0", "ASOS_CLASS_1", "ASOS_CLASS_2", "ASOS_CLASS_3"]) assert.equal(isCalculatedRegulatoryDomain({ componentCode: "ASOS", customerScope: scope, normalizedUnit: "EUR/KWH", regulatoryVariant: `${asos}_${variant}` }), true);
}
assert.equal(CALCULATED_REGULATORY_DOMAINS.filter((domain) => domain.customerScope === scope).length, 15 + 2 + 35 + 60);

// The 588/2025 rows of the BT other uses up to 16,5 kW (test values, not ARERA's). Tony (30/10, "ancora errori"): the heading
// "lettera d) ... fino a 16,5 kW" carries no values; the five sub-rows "per potenze impegnate ..." are BTA1..BTA5. An empty
// column is a quota without aliquota, archived as 0.
const rows = [
  ["", "Componenti UC3 e UC6", "", "", "", ""],
  ["", "lettera d) Altre utenze in bassa tensione con potenza disponibile fino a 16,5 kW", "", "", "", ""],
  ...[1, 2, 3, 4, 5].map((n) => ["", `- per potenze impegnate classe ${n}`, `0.${n}00`, `${n}00.00`, "", `0.0${n}0`]),
  ["", "lettera e) Altre utenze in bassa tensione con potenza disponibile superiore a 16,5 kW", "0.276", "168.24", "", "0.007"],
];
const uc = parseArera588BtaUpTo165Uc3Uc6TableRows({ rows, retrievedAt: "2026-09-04T12:00:00.000Z", sourceSha256: "a".repeat(64) });
assert.deepEqual(uc.filter((record) => record.regulatoryVariant === "BTA2").map((record) => [record.componentCode, record.normalizedUnit, record.normalizedValue, record.customerScope]), [["UC3", "EUR/KWH", 0.002, scope], ["UC6", "EUR/KWH", 0.0002, scope], ["UC6", "EUR/POD/YEAR", 2, scope], ["UC6", "EUR/KW/YEAR", 0, scope]]);
assert.deepEqual([...new Set(uc.map((record) => record.regulatoryVariant))], ["BTA1", "BTA2", "BTA3", "BTA4", "BTA5"]);
// A heading that carries the values itself holds for all five classes.
const arim = parseArera588BtaUpTo165ArimTableRows({ rows: [["", "Altre utenze in bassa tensione con potenza disponibile superiore a 16,5 kW", "302.76", "345.24", "0.1614"], ["", "Altre utenze in bassa tensione con potenza disponibile fino a 16,5 kW", "1200", "", "2"]], retrievedAt: "2026-09-04T12:00:00.000Z", sourceSha256: "a".repeat(64) });
assert.equal(arim.length, 15);
assert.deepEqual(arim.filter((record) => record.regulatoryVariant === "BTA5").map((record) => [record.normalizedUnit, record.normalizedValue]), [["EUR/POD/YEAR", 12], ["EUR/KW/YEAR", 0], ["EUR/KWH", 0.02]]);
assert.throws(() => parseArera588BtaUpTo165ArimTableRows({ rows: [rows[7]], retrievedAt: "2026-09-04T12:00:00.000Z", sourceSha256: "a".repeat(64) }), /ARERA_588_BTA1_5_ARIM_ROW_MISSING/);
assert.throws(() => parseArera588BtaUpTo165Uc3Uc6TableRows({ rows: rows.slice(0, 5), retrievedAt: "2026-09-04T12:00:00.000Z", sourceSha256: "a".repeat(64) }), /ARERA_588_BTA1_5_UC3_UC6_CLASS_ROWS_MISSING/);

const source = "https://www.arera.it/fileadmin/allegati/docs/25/575-2025-R-eel-TABELLE_TIT.xlsx";
function value({ componentCode, normalizedUnit, normalizedValue, regulatoryVariant }) {
  return createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: source, officialIdentifier: `QA-BTA15-${componentCode}-${normalizedUnit}-${regulatoryVariant ?? ""}`, publicationDate: "2025-12-30", retrievedAt: "2026-09-09T00:00:00.000Z", effectiveFrom: "2026-01-01", effectiveTo: "2027-01-01", componentCode, customerScope: scope, ...(regulatoryVariant === undefined ? {} : { regulatoryVariant }), originalValue: normalizedValue, originalUnit: normalizedUnit, applicationBasis: "official QA fixture", sourceSha256: "c".repeat(64) });
}
async function bridgeWith(records) {
  const values = new MemoryRepository(); const approvals = new MemoryRepository(); const bridge = new ProductionRegulatoryPersistenceBridge(values, approvals);
  for (const record of records) await bridge.save(tenant, record);
  for (const record of records) { const domainKey = collisionDomainKey(record); const stateId = regulatoryApprovalDomainId(tenant, domainKey); const previous = await approvals.get(tenant, stateId); const state = previous?.payload ?? { domainKey, componentCode: record.componentCode, customerScope: record.customerScope, normalizedUnit: record.normalizedUnit, ...(record.regulatoryVariant === undefined ? {} : { regulatoryVariant: record.regulatoryVariant }), effectiveApprovals: [] }; await approvals.put({ tenantId: tenant, recordId: stateId, payload: { ...state, effectiveApprovals: [...state.effectiveApprovals, { targetRecordId: record.id, targetRecordChecksum: record.checksum, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, decisionEventId: `qa-${record.id}` }] }, expectedVersion: previous?.version }); }
  return bridge;
}
// BTA2 and BTA3 tables side by side: a 3 kW supply takes only BTA2. ASOS of classe 0, the bill saying no class. Oneri of
// the 3 kW committed class BTA2 only: a missing BTA3 onere must not matter.
const records = [
  ...["BTA2", "BTA3"].flatMap((variant, index) => [
    value({ componentCode: "NETWORK_FIXED", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 24 + index, regulatoryVariant: variant }),
    value({ componentCode: "NETWORK_POWER", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 48 + index, regulatoryVariant: variant }),
    value({ componentCode: "NETWORK_ENERGY", normalizedUnit: "EUR/KWH", normalizedValue: 0.01 + index, regulatoryVariant: variant }),
  ]),
  value({ componentCode: "METERING_FIXED", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 12 }),
  value({ componentCode: "TRANSMISSION_ENERGY", normalizedUnit: "EUR/KWH", normalizedValue: 0.01 }),
  value({ componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.001, regulatoryVariant: "BTA2" }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KWH", normalizedValue: 0.0001, regulatoryVariant: "BTA2" }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 2.4, regulatoryVariant: "BTA2" }),
  value({ componentCode: "UC6", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 4, regulatoryVariant: "BTA2" }),
  value({ componentCode: "ARIM", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 12, regulatoryVariant: "BTA2" }),
  value({ componentCode: "ARIM", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 6, regulatoryVariant: "BTA2" }),
  value({ componentCode: "ARIM", normalizedUnit: "EUR/KWH", normalizedValue: 0.02, regulatoryVariant: "BTA2" }),
  ...["ASOS_CLASS_0_BTA2", "ASOS_CLASS_1_BTA2"].flatMap((variant, index) => [
    value({ componentCode: "ASOS", normalizedUnit: "EUR/POD/YEAR", normalizedValue: 120 + index, regulatoryVariant: variant }),
    value({ componentCode: "ASOS", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 60 + index, regulatoryVariant: variant }),
    value({ componentCode: "ASOS", normalizedUnit: "EUR/KWH", normalizedValue: 0.03 + index, regulatoryVariant: variant }),
  ]),
];
const request = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-09-09", supplyPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 0, f3: 0 } }, tenant);
const context = { vector: "EE", contractedPowerKw: 3, availablePowerKw: 3, supplyUseCategory: "OTHER_USE", domesticResidenceStatus: "NOT_APPLICABLE", voltageLevel: "LV", regulatoryCustomerScope: "NON_DOMESTIC_BT", regulatoryTariffClass: "BTA2", regulatoryOneriTariffClass: "BTA2", asosClass: "UNKNOWN", energyIntensiveStatus: "UNKNOWN", asosClassTemporalStatus: "UNKNOWN" };
const result = await calculateRegulatedEeSubset(request, { trustedElectricityContext: context, regulatoryBridge: await bridgeWith(records) });
const amount = (formulaId) => result.components.filter((component) => component.formulaId === formulaId).reduce((total, component) => total + component.amount.minorUnits, 0);
// One month: quota fissa 24/12 = 2,00; quota potenza 48 x 3 kW / 12 = 12,00; energia 0,01 x 100 kWh = 1,00.
assert.equal(amount("REGULATED_BTA1_5_NETWORK_FIXED_RATE_TIMES_TIME"), 200);
assert.equal(amount("REGULATED_BTA1_5_NETWORK_POWER_RATE_TIMES_COMMITTED_KW_TIME"), 1200);
assert.equal(amount("REGULATED_BTA1_5_NETWORK_ENERGY_RATE_TIMES_KWH"), 100);
assert.equal(amount("REGULATED_BTA1_5_METERING_FIXED_RATE_TIMES_TIME"), 100);
assert.equal(amount("REGULATED_TRANSMISSION_RATE_TIMES_KWH"), 100);
assert.equal(amount("REGULATED_UC3_RATE_TIMES_KWH"), 10);
assert.equal(amount("REGULATED_BTA1_5_UC6_FIXED_RATE_TIMES_TIME"), 20);
assert.equal(amount("REGULATED_BTA1_5_UC6_POWER_RATE_TIMES_COMMITTED_KW_TIME"), 100);
// ARIM 12/12 + 6 x 3 / 12 + 0,02 x 100; ASOS classe 0: 120/12 + 60 x 3 / 12 + 0,03 x 100.
assert.equal(amount("REGULATED_BTA1_5_ARIM_FIXED_RATE_TIMES_TIME") + amount("REGULATED_BTA1_5_ARIM_POWER_RATE_TIMES_COMMITTED_KW_TIME") + amount("REGULATED_BTA1_5_ARIM_ENERGY_RATE_TIMES_KWH"), 100 + 150 + 200);
assert.equal(amount("REGULATED_BTA1_5_ASOS_FIXED_RATE_TIMES_TIME") + amount("REGULATED_BTA1_5_ASOS_POWER_RATE_TIMES_COMMITTED_KW_TIME") + amount("REGULATED_BTA1_5_ASOS_ENERGY_RATE_TIMES_KWH"), 1000 + 1500 + 300);
assert.ok(result.components.every((component) => component.formulaInputs.customerScope === scope));
assert.equal(result.includedComponents.length, 15);
// The supply's own ASOS class, when the bill states it.
const energivoro = await calculateRegulatedEeSubset(request, { trustedElectricityContext: { ...context, asosClass: "ASOS_CLASS_1", asosClassTemporalStatus: "VALID" }, regulatoryBridge: await bridgeWith(records) });
assert.equal(energivoro.components.filter((component) => component.formulaInputs.componentCode === "ASOS").every((component) => component.formulaInputs.regulatoryVariant === "ASOS_CLASS_1_BTA2"), true);
// Tony (30/10): 3 kW impegnati with 3,3 kW disponibili: distribution of TIT class BTA3 (by available power), oneri of the
// sub-row "superiori a 1,5 kW e inferiori o uguali a 3 kW" (BTA2, by committed power).
const split = await calculateRegulatedEeSubset(request, { trustedElectricityContext: { ...context, availablePowerKw: 3.3, regulatoryTariffClass: "BTA3" }, regulatoryBridge: await bridgeWith(records) });
assert.equal(split.components.find((component) => component.formulaId === "REGULATED_BTA1_5_NETWORK_FIXED_RATE_TIMES_TIME").formulaInputs.regulatoryVariant, "BTA3");
assert.equal(split.components.find((component) => component.formulaId === "REGULATED_UC3_RATE_TIMES_KWH").formulaInputs.regulatoryVariant, "BTA2");
// Tables not yet in the archive: the quote says which value is missing, never prices without it.
await assert.rejects(calculateRegulatedEeSubset(request, { trustedElectricityContext: context, regulatoryBridge: await bridgeWith([]) }), /REGULATORY_TIMELINE_GAP:NETWORK_FIXED/);
console.log("BTA1_5_ARERA_TABLES=PASS");
