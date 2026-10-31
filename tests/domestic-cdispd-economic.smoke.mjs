import assert from "node:assert/strict";
import { createRegulatoryValue, DOMESTIC_EQUAL_RATE_APPLICATION_BASIS, DOMESTIC_FORMAL_TIER_PROVENANCE } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { collisionDomainKey, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";
import { calculateRegulatedEeSubset } from "../app/lib/calculation/regulated-ee.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculatePreparedOffer } from "../app/lib/calculation/engine.ts";

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

// Tony (28/10, bolletta Minniti): "voci non verificate su ARERA non deve esistere". A month of CDISPD not yet in the archive
// leaves only dispatching out: transport and oneri are still priced from the ARERA tables.
const yearLong = fixed.map((record) => value({ componentCode: record.componentCode, normalizedUnit: record.normalizedUnit, normalizedValue: record.normalizedValue, effectiveTo: "2026-10-01", applicationBasis: record.applicationBasis }));
const septemberRequest = (sourceBill) => parseSimulationRequest({ ...request("2026-09-01", "2026-10-01"), ...(sourceBill ? { sourceBill: { billId: "bill-cdispd", version: "v1" } } : {}) }, tenant);
const noCdispd = await calculateRegulatedEeSubset(septemberRequest(false), { trustedElectricityContext: context, regulatoryBridge: await bridgeWith([...yearLong, ...cdispd]) });
assert.equal(noCdispd.dispatchingMissing, true);
assert.equal(noCdispd.components.some((component) => component.formulaId === "REGULATED_DOMESTIC_CDISPD_RATE_TIMES_KWH"), false);
assert.equal(noCdispd.components.some((component) => component.formulaId === "REGULATED_UC3_RATE_TIMES_KWH"), true);
assert.equal(noCdispd.includedComponents.includes("DISPATCHING_TOTAL_ENERGY"), false);

// On the bill quote CDISPD already includes the capacity charge (TIV comma 48.9, 338/2026/R/eel): no separate capacity or
// dispatching line for households, and a missing month says it is CDISPD that is missing.
const prepared = {
  record: { archiveId: "archive-cdispd", cteId: "cte-cdispd" },
  version: { versionId: "version-cdispd", contract: { tenantId: tenant, vector: "EE", version: "1", supplier: { name: "Supplier" }, offer: { code: "CASA", name: "Casa" }, commercialTerms: {} } },
  offer: {
    schemaVersion: 1, tenantId: tenant, sourceCteId: "cte-cdispd", sourceCteVersion: "1", approval: { status: "APPROVED" }, offerId: "offer-cdispd", supplierId: "supplier", offerCode: "CASA", offerName: "Casa",
    currency: "EUR", taxTreatment: "EXCLUDED", validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
    fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [], vector: "EE",
    pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.1, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
  },
  markets: [],
};
const quoteDeps = async (records) => ({ regulatoryBridge: await bridgeWith(records), trustedElectricityContext: context });
const kinds = (result, kind) => result.components.filter((component) => component.formulaInputs?.kind === kind);
const septemberCdispd = value({ componentCode: "DISPATCHING_TOTAL", normalizedUnit: "EUR/KWH", normalizedValue: 0.015068, effectiveFrom: "2026-09-01", effectiveTo: "2026-10-01", applicationBasis: "CDISPD aggregate dispatching + capacity market" });
const priced = await calculatePreparedOffer(septemberRequest(true), prepared, await quoteDeps([...yearLong, septemberCdispd]));
assert.deepEqual(priced.components.filter((component) => component.formulaId === "REGULATED_DOMESTIC_CDISPD_RATE_TIMES_KWH").map((component) => component.amount.amount), [15.07]);
assert.equal(kinds(priced, "CAPACITY_MARKET").length, 0);
assert.equal(kinds(priced, "DISPATCHING").length, 0);
assert.equal(priced.warnings.some((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:REGULATED")), false);
const unpublished = await calculatePreparedOffer(septemberRequest(true), prepared, await quoteDeps(yearLong));
assert.equal(kinds(unpublished, "CAPACITY_MARKET").length, 0);
assert.ok(unpublished.warnings.includes("OFFICIAL_VALUE_MISSING:DISPATCHING:CDISPD_MISSING"));
assert.equal(unpublished.warnings.some((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:REGULATED")), false);
assert.ok(unpublished.components.some((component) => component.formulaId === "REGULATED_UC3_RATE_TIMES_KWH"));
// Tony (29/10, bolletta Casa Protetta domestico non residente, Box "Dispacciamento: 0,015068 €/kWh"): "come fa a costare
// meno la proposta se ha una cte con spread superiore alla fattura?". The simulation had no dispatching and a separate
// capacity line: CDISPD is the same for every household, so the non-resident pays the month's CDISPD and no capacity.
const nonResident = { ...context, domesticResidenceStatus: "NON_RESIDENT", regulatoryCustomerScope: "DOMESTIC_NON_RESIDENT_BT" };
const nonResidentQuote = await calculatePreparedOffer(septemberRequest(true), prepared, { regulatoryBridge: await bridgeWith([...yearLong, septemberCdispd]), trustedElectricityContext: nonResident });
assert.deepEqual(kinds(nonResidentQuote, "DISPATCHING").map((component) => [component.label, component.amount.amount]), [["Dispacciamento e mercato della capacità (CDISPD)", 15.07]]);
assert.equal(kinds(nonResidentQuote, "CAPACITY_MARKET").length, 0);
const nonResidentUnpublished = await calculatePreparedOffer(septemberRequest(true), prepared, { regulatoryBridge: await bridgeWith(yearLong), trustedElectricityContext: nonResident });
assert.ok(nonResidentUnpublished.warnings.includes("OFFICIAL_VALUE_MISSING:DISPATCHING:CDISPD_MISSING"));
assert.equal(kinds(nonResidentUnpublished, "CAPACITY_MARKET").length, 0);
console.log("CDISPD_NON_RESIDENT_HOUSEHOLD=PASS");
console.log("CDISPD_MISSING_KEEPS_TRANSPORT_AND_ONERI=PASS");
console.log("CDISPD_INCLUDES_CAPACITY_NO_SEPARATE_LINE=PASS");
console.log("CDISPD_AUGUST_ECONOMIC_QA=PASS");
console.log("CDISPD_CROSS_MONTH_WITH_PROFILE=PASS");
console.log("CDISPD_CROSS_MONTH_WITHOUT_PROFILE_FAILS_CLOSED=PASS");
console.log("CDISPD_MISSING_MONTH_FAIL_CLOSED=PASS");
console.log("CDISPD_INCLUDED_IN_ECONOMIC_SUBSET=PASS");
console.log("CDISPD_NO_DECOMPOSITION=PASS");
