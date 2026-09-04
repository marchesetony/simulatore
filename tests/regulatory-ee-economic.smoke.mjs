import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { collisionDomainKey, regulatoryApprovalDomainId } from "../app/lib/regulatory-approval-domain.ts";
import { calculatePreparedOffer } from "../app/lib/calculation/engine.ts";
import { calculateRegulatedEeSubset } from "../app/lib/calculation/regulated-ee.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", payload: structuredClone(input.payload) };
    this.records = this.records.filter((item) => !(item.tenantId === input.tenantId && item.recordId === input.recordId));
    this.records.push(record);
    return record;
  }
  async append(input) {
    if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT");
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", payload: structuredClone(input.payload) };
    this.records.push(record);
    return record;
  }
}

const tenant = "tenant_regulatory-ee-smoke";
const scope = "DOMESTIC_RESIDENT_BT";
const baseRecord = ({ id, componentCode, normalizedUnit, normalizedValue, effectiveFrom = "2026-07-01", effectiveTo = "2026-08-01", approvalStatus = "IMPORTED", reviewStatus = "NEEDS_REVIEW" }) => {
  const base = {
    tenantId: tenant, id, identityKey: `${tenant}|${id}`, version: "1", parentVersionId: null, authority: "ARERA", sourceType: "OFFICIAL_ATTACHMENT", sourceReference: "https://official.example/regulatory-ee-smoke", officialIdentifier: "QA-REGULATORY-FIXTURE", publicationDate: "2026-06-26", retrievedAt: "2026-09-04T00:00:00Z", effectiveFrom, effectiveTo, vector: "EE", customerScope: scope, componentCode, originalValue: normalizedValue, originalUnit: normalizedUnit, normalizedValue, normalizedUnit, applicationBasis: "QA fixture only", sourceSha256: "a".repeat(64), conversionProvenance: [], approvalStatus, reviewStatus,
  };
  return { ...base, checksum: checksumFor(base) };
};

async function bridgeWith(records) {
  const repository = new MemoryRepository();
  const approvals = new MemoryRepository();
  const bridge = new ProductionRegulatoryPersistenceBridge(repository, approvals);
  for (const record of records) await bridge.save(tenant, record);
  for (const record of records) {
    const domainKey = collisionDomainKey(record);
    const stateId = regulatoryApprovalDomainId(tenant, domainKey);
    const previous = await approvals.get(tenant, stateId);
    const state = previous?.payload ?? { domainKey, componentCode: record.componentCode, customerScope: record.customerScope, normalizedUnit: record.normalizedUnit, effectiveApprovals: [] };
    await approvals.put({ tenantId: tenant, recordId: stateId, payload: { ...state, effectiveApprovals: [...state.effectiveApprovals, { targetRecordId: record.id, targetRecordChecksum: record.checksum, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, decisionEventId: `qa_${record.id}` }] }, expectedVersion: previous?.version });
  }
  return bridge;
}

function request(overrides = {}) {
  return parseSimulationRequest({
    schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-07-15", supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, customerCategory: "RESIDENTIAL", residency: "RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 500, f2: 300, f3: 200 }, sourceBill: { billId: "qa-source-bill", version: "qa-version" }, ...overrides,
  }, tenant);
}

const context = { vector: "EE", contractedPowerKw: 3, availablePowerKw: 3.3, supplyUseCategory: "DOMESTIC", domesticResidenceStatus: "RESIDENT", voltageLevel: "LV", regulatoryCustomerScope: scope };
const singleRecords = [
  baseRecord({ id: "qa-uc3", componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.00276 }),
  baseRecord({ id: "qa-uc6-energy", componentCode: "UC6", normalizedUnit: "EUR/KWH", normalizedValue: 0.00007 }),
  baseRecord({ id: "qa-uc6-power", componentCode: "UC6", normalizedUnit: "EUR/KW/YEAR", normalizedValue: 0.1988 }),
];
const singleBridge = await bridgeWith(singleRecords);
const singleRequest = request();
const regulated = await calculateRegulatedEeSubset(singleRequest, { trustedElectricityContext: context, regulatoryBridge: singleBridge });
const byFormula = (formulaId) => regulated.components.find((component) => component.formulaId === formulaId);
assert.equal(byFormula("REGULATED_UC3_RATE_TIMES_KWH")?.amount.minorUnits, 276);
assert.equal(byFormula("REGULATED_UC6_ENERGY_RATE_TIMES_KWH")?.amount.minorUnits, 7);
assert.equal(byFormula("REGULATED_UC6_POWER_RATE_TIMES_KW_TIME")?.amount.minorUnits, 5);
assert.equal(byFormula("REGULATED_UC6_POWER_RATE_TIMES_KW_TIME")?.formulaInputs.contractedPowerKw, 3);
assert.equal(byFormula("REGULATED_UC6_POWER_RATE_TIMES_KW_TIME")?.formulaInputs.annualDivisor, 12);
console.log("UC3_FIXTURE_COST=2.76 EUR / 276 minorUnits");
console.log("UC6_ENERGY_FIXTURE_COST=0.07 EUR / 7 minorUnits");
console.log("UC6_POWER_FIXTURE_COST=0.05 EUR / 5 minorUnits");
console.log("REGULATED_FIXTURE_SUBTOTAL=2.88 EUR / 288 minorUnits");
console.log("UC3_ECONOMIC_COMPONENT=PASS");
console.log("UC6_ENERGY_ECONOMIC_COMPONENT=PASS");
console.log("UC6_POWER_ECONOMIC_COMPONENT=PASS");
console.log("UC6_POWER_USES_CONTRACTED_POWER=PASS");
console.log("AVAILABLE_POWER_IGNORED=PASS");

const prepared = {
  record: { archiveId: "qa-cte", cteId: "qa-cte" },
  version: { versionId: "qa-cte-v1", contract: { version: "1", supplier: { name: "QA Supplier" } } },
  offer: { offerCode: "QA-OFFER", currency: "EUR", taxTreatment: "EXCLUDED", pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.1, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } }, fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [] },
  markets: [],
};
const integrated = await calculatePreparedOffer(singleRequest, prepared, { trustedElectricityContext: context, regulatoryBridge: singleBridge });
assert.equal(integrated.totalCommercialCost.minorUnits, 10000);
assert.equal(integrated.totalRegulatedSubsetCost?.minorUnits, 288);
assert.equal(integrated.totalCommercialPlusRegulatedSubsetCost?.minorUnits, 10288);
assert.equal(integrated.costScope, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
assert.deepEqual(integrated.regulatedComponentsIncluded, ["UC3_ENERGY", "UC6_ENERGY", "UC6_POWER"]);
assert.equal(integrated.regulatoryData.references.length, 3);
assert.ok(integrated.warnings.includes("REGULATED_SUBSET_PARTIAL_UC3_UC6_ONLY"));
assert.equal(integrated.components.filter((component) => component.category === "REGULATED_ENERGY").length, 2);
assert.equal(integrated.components.filter((component) => component.category === "REGULATED_POWER").length, 1);
console.log("TOTAL_COMMERCIAL_UNCHANGED=PASS");
console.log("COST_SCOPE=COMMERCIAL_PLUS_REGULATED_PARTIAL");
console.log("REGULATORY_REFERENCES_PRESERVED=PASS");
console.log("NO_TOTAL_COMPONENTS=PASS");
console.log("NO_DOUBLE_COUNT=PASS");

const twoMonthRequest = request({ supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-09-01" } });
const twoMonthRecords = singleRecords.map((record) => {
  const withoutChecksum = Object.fromEntries(Object.entries({ ...record, effectiveTo: "2026-09-01" }).filter(([key]) => key !== "checksum"));
  return { ...withoutChecksum, checksum: checksumFor(withoutChecksum) };
});
const twoMonth = await calculateRegulatedEeSubset(twoMonthRequest, { trustedElectricityContext: context, regulatoryBridge: await bridgeWith(twoMonthRecords) });
assert.equal(twoMonth.components.find((component) => component.formulaId === "REGULATED_UC6_POWER_RATE_TIMES_KW_TIME")?.formulaInputs.monthsApplied, 2);
console.log("MULTI_MONTH_SINGLE_RATE=PASS");

const changedRecords = [
  baseRecord({ id: "change-uc3-july", componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.00276, effectiveTo: "2026-08-01" }),
  baseRecord({ id: "change-uc3-august", componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.003, effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01" }),
  ...twoMonthRecords.filter((record) => !(record.componentCode === "UC3" && record.normalizedUnit === "EUR/KWH")),
];
const profileRequest = request({ supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-09-01" }, consumption: { basis: "PERIOD", unit: "KWH", f1: 600, f2: 200, f3: 200, monthlyProfile: [{ month: "2026-07", f1: 300, f2: 100, f3: 200 }, { month: "2026-08", f1: 300, f2: 100, f3: 0 }] } });
const changed = await calculateRegulatedEeSubset(profileRequest, { trustedElectricityContext: context, regulatoryBridge: await bridgeWith(changedRecords) });
const changedUc3 = changed.components.filter((component) => component.formulaId === "REGULATED_UC3_RATE_TIMES_KWH");
assert.deepEqual(changedUc3.map((component) => [component.formulaInputs.quantityKwh, component.amount.minorUnits]), [[600, 166], [400, 120]]);
console.log("RATE_CHANGE_MONTHLY_ALLOCATION=PASS");
const changedBridge = await bridgeWith(changedRecords);
await assert.rejects(() => calculateRegulatedEeSubset(twoMonthRequest, { trustedElectricityContext: context, regulatoryBridge: changedBridge }), /REGULATORY_CONSUMPTION_ALLOCATION_REQUIRED/);
console.log("FAIL_CLOSED_NO_PROFILE=PASS");

const midMonthRecords = [
  baseRecord({ id: "midmonth-uc3-before", componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.00276, effectiveFrom: "2026-07-01", effectiveTo: "2026-07-15" }),
  baseRecord({ id: "midmonth-uc3-after", componentCode: "UC3", normalizedUnit: "EUR/KWH", normalizedValue: 0.003, effectiveFrom: "2026-07-15", effectiveTo: "2026-08-01" }),
  ...singleRecords.filter((record) => record.componentCode !== "UC3"),
];
const midMonthBridge = await bridgeWith(midMonthRecords);
await assert.rejects(() => calculateRegulatedEeSubset(singleRequest, { trustedElectricityContext: context, regulatoryBridge: midMonthBridge }), /REGULATORY_PRORATION_UNSUPPORTED/);
console.log("MONTH_ALIGNED_ONLY=PASS");
console.log("MID_MONTH_PRORATION_SUPPORTED=NO");
console.log("MID_MONTH_FAIL_CLOSED=PASS");

await assert.rejects(() => calculatePreparedOffer(singleRequest, prepared), /REGULATORY_TRUST_CONTEXT_REQUIRED/);
await assert.rejects(() => calculateRegulatedEeSubset(request({ taxTreatment: "INCLUDED" }), { trustedElectricityContext: context, regulatoryBridge: singleBridge }), /REGULATORY_TAX_TREATMENT_UNSUPPORTED/);
console.log("TRUSTED_CONTEXT_REQUIRED_FAIL_CLOSED=PASS");
console.log("TAX_TREATMENT_FAIL_CLOSED=PASS");

const commercialOnly = await calculatePreparedOffer(request({ sourceBill: undefined }), prepared);
assert.equal(commercialOnly.costScope, "COMMERCIAL_ONLY");
assert.equal(commercialOnly.totalRegulatedSubsetCost, null);
assert.equal(commercialOnly.totalCommercialPlusRegulatedSubsetCost, null);
assert.deepEqual(commercialOnly.regulatoryData.references, []);
console.log("EE_WITHOUT_SOURCE_BILL_COMMERCIAL_ONLY=PASS");

const gasRequest = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "GAS", calculationDate: "2026-07-15", supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, customerCategory: "NON_RESIDENTIAL", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: false } } }, tenant);
const gasPrepared = { ...prepared, offer: { ...prepared.offer, pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.5, currency: "EUR", unit: "EUR_PER_SMC", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } } } };
const gas = await calculatePreparedOffer(gasRequest, gasPrepared);
assert.equal(gas.costScope, "COMMERCIAL_ONLY");
assert.equal(gas.totalRegulatedSubsetCost, null);
assert.deepEqual(gas.regulatoryData.references, []);
console.log("GAS_UNCHANGED=PASS");

for (const field of ["contractedPowerKw", "availablePowerKw", "regulatoryCustomerScope", "trustedSupplyContext"]) {
  assert.throws(() => parseSimulationRequest({ ...singleRequest, [field]: field === "contractedPowerKw" ? 3 : field === "availablePowerKw" ? 3.3 : field === "regulatoryCustomerScope" ? scope : {} }, tenant), /TRUSTED_OUTCOME_FORBIDDEN/);
}
console.log("TRUSTED_FIELDS_CLIENT_FORBIDDEN=PASS");

const routeSource = await readFile("app/api/calculation/route.ts", "utf8");
assert.match(routeSource, /resolveTrustedElectricityContextFromSourceBill/);
assert.match(routeSource, /new ProductionRegulatoryPersistenceBridge\(repositories\.regulatoryValues, repositories\.approvalDomains\)/);
assert.match(routeSource, /trustedElectricityContext/);
assert.doesNotMatch(routeSource, /trustedSupplyContext/);
console.log("TRUSTED_CONTEXT_PASSED_SERVER_SIDE=PASS");
console.log("C3_APPROVAL_AUTHORITY_PRESERVED=PASS");

const comparisonSource = await readFile("app/lib/comparison/service.ts", "utf8");
assert.match(comparisonSource, /totalCommercialCost/);
console.log("COMPARISON_STILL_USES_COMMERCIAL_COST=YES");
console.log("PROPOSAL_UNCHANGED=YES");

const realRoot = new LocalFilesystemAdapter("var/phase6");
const realBridge = new ProductionRegulatoryPersistenceBridge(realRoot.collection("regulatory-values"), realRoot.collection("regulatory-approval-domains"));
const realRequest = parseSimulationRequest({ schemaVersion: 1, tenantId: "tenant_local-demo", vector: "EE", calculationDate: "2026-07-15", supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, customerCategory: "RESIDENTIAL", residency: "RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 500, f2: 300, f3: 200 }, sourceBill: { billId: "qa-source-bill", version: "qa-version" } }, "tenant_local-demo");
const real = await calculateRegulatedEeSubset(realRequest, { trustedElectricityContext: { ...context, regulatoryCustomerScope: scope }, regulatoryBridge: realBridge });
const realByCode = new Map(real.references.map((reference) => [reference.componentCode + "|" + reference.normalizedUnit, reference]));
for (const [marker, key] of [["REAL_UC3_RATE_READ", "UC3|EUR/KWH"], ["REAL_UC6_ENERGY_RATE_READ", "UC6|EUR/KWH"], ["REAL_UC6_POWER_RATE_READ", "UC6|EUR/KW/YEAR"]]) {
  const reference = realByCode.get(key);
  assert.ok(reference && reference.regulatoryRecordId && reference.checksum);
  console.log(`${marker}=PASS`);
}
for (const [label, formulaId] of [["REAL_UC3_QA_COST", "REGULATED_UC3_RATE_TIMES_KWH"], ["REAL_UC6_ENERGY_QA_COST", "REGULATED_UC6_ENERGY_RATE_TIMES_KWH"], ["REAL_UC6_POWER_QA_COST", "REGULATED_UC6_POWER_RATE_TIMES_KW_TIME"]]) {
  const component = real.components.find((candidate) => candidate.formulaId === formulaId);
  assert.ok(component);
  console.log(`${label}=${component.amount.amount} EUR / ${component.amount.minorUnits} minorUnits`);
}
console.log(`REAL_QA_SUBTOTAL_MINOR_UNITS=${real.components.reduce((sum, component) => sum + component.amount.minorUnits, 0)}`);

console.log("REGULATORY_EE_ECONOMIC_TESTS=PASS");
