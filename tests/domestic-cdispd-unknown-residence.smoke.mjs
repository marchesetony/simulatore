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

const tenant = "tenant_domestic-cdispd-unknown-residence";
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
const yearLong = fixed.map((record) => value({ componentCode: record.componentCode, normalizedUnit: record.normalizedUnit, normalizedValue: record.normalizedValue, effectiveTo: "2026-10-01", applicationBasis: record.applicationBasis }));
const septemberRequest = (sourceBill) => parseSimulationRequest({ ...request("2026-09-01", "2026-10-01"), ...(sourceBill ? { sourceBill: { billId: "bill-cdispd", version: "v1" } } : {}) }, tenant);
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
// Tony (24/11/2026, "DECISIONI REGOLATORIE", decisione A; delibera ARERA 386/2025/R/com, TIV comma 48.9): a household whose
// residence the bill does not state pays the month's CDISPD like any household. Bolletta Elios CER SMART2 CASA, settembre
// 2026: the three BPower offers had dispacciamento and capacity "non determinabili". ARERA CDISPD settembre 2026 0,015068
// €/kWh (Corrispettivi_libero_elettrico_domestico_2026.xlsx); 1.000 kWh -> 15,07 €.
const { savingDetermined, missingComponents } = await (async () => { const { register } = await import("node:module"); register("./node-tsx-render-loader.mjs", import.meta.url); return import("../app/components/QuickQuoteFlow.tsx"); })();
const septemberCdispd = value({ componentCode: "DISPATCHING_TOTAL", normalizedUnit: "EUR/KWH", normalizedValue: 0.015068, effectiveFrom: "2026-09-01", effectiveTo: "2026-10-01", applicationBasis: "CDISPD aggregate dispatching + capacity market" });
const kinds = (result, kind) => result.components.filter((component) => component.formulaInputs?.kind === kind);
const cdispdLines = (result) => result.components.filter((component) => /CDISPD/.test(component.label ?? "") || component.formulaId === "REGULATED_DOMESTIC_CDISPD_RATE_TIMES_KWH");
const notDeterminable = (result) => result.warnings.filter((warning) => warning.endsWith(":CTE_NOT_DETERMINABLE"));
const quoteRequest = (customerCategory, residency) => parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-09-09", supplyPeriod: { periodStart: "2026-09-01", periodEnd: "2026-10-01" }, customerCategory, ...(residency ? { residency } : {}), voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 1000, f2: 0, f3: 0 }, sourceBill: { billId: "bill-cdispd", version: "v1" } }, tenant);
const archive = [...yearLong, septemberCdispd];

// 1. Domestic resident: CDISPD inside the ARERA regulated tables, once; no seller dispatching or capacity line.
const resident = await calculatePreparedOffer(quoteRequest("RESIDENTIAL", "RESIDENT"), prepared, { regulatoryBridge: await bridgeWith(archive), trustedElectricityContext: context });
assert.deepEqual(cdispdLines(resident).map((component) => component.amount.amount), [15.07], "resident: one CDISPD 15,07 €");
assert.equal(kinds(resident, "DISPATCHING").length + kinds(resident, "CAPACITY_MARKET").length, 0);
assert.deepEqual(notDeterminable(resident), []);

// 2. Domestic non-resident: the same CDISPD of the month, as a pass-through line.
const nonResident = await calculatePreparedOffer(quoteRequest("RESIDENTIAL", "NON_RESIDENT"), prepared, { regulatoryBridge: await bridgeWith(archive), trustedElectricityContext: { ...context, domesticResidenceStatus: "NON_RESIDENT", regulatoryCustomerScope: "DOMESTIC_NON_RESIDENT_BT" } });
assert.deepEqual(cdispdLines(nonResident).map((component) => [component.label, component.amount.amount]), [["Dispacciamento e mercato della capacità (CDISPD)", 15.07]]);
assert.deepEqual(notDeterminable(nonResident), []);

// 3. Domestic, residence unknown: the supply context stopped on DOMESTIC_RESIDENCE_REQUIRED (use read as DOMESTIC in BT).
// The CDISPD of the month applies with its ARERA source; transport and oneri stay the bill's (REGULATED warning kept).
const unknownDeps = async (records, extra = {}) => ({ regulatoryBridge: await bridgeWith(records), regulatedUnavailableReason: "DOMESTIC_RESIDENCE_REQUIRED", ...extra });
const unknown = await calculatePreparedOffer(quoteRequest("RESIDENTIAL"), prepared, await unknownDeps(archive));
assert.deepEqual(cdispdLines(unknown).map((component) => [component.amount.amount, component.formulaInputs.officialRate, component.formulaInputs.source]), [[15.07, 0.015068, "ARERA CDISPD 2026-09"]], "unknown residence: CDISPD of September from ARERA");
assert.equal(kinds(unknown, "CAPACITY_MARKET").length, 0, "CDISPD includes capacity: no separate capacity line");
assert.deepEqual(notDeterminable(unknown), [], "dispatching and capacity no longer undetermined");
assert.ok(unknown.warnings.includes("OFFICIAL_VALUE_MISSING:REGULATED:DOMESTIC_RESIDENCE_REQUIRED"), "rete e oneri still say why they are the bill's");
// A month not in the archive: nothing invented, the total stays provisional.
const unknownUnpublished = await calculatePreparedOffer(quoteRequest("RESIDENTIAL"), prepared, await unknownDeps(yearLong));
assert.equal(cdispdLines(unknownUnpublished).length, 0);
assert.ok(unknownUnpublished.warnings.includes("OFFICIAL_VALUE_MISSING:DISPATCHING:CDISPD_MISSING"));

// 4. Business: never the household rule, even with the same missing-residence code; dispatching and capacity stay undetermined.
const business = await calculatePreparedOffer(quoteRequest("NON_RESIDENTIAL"), prepared, await unknownDeps(archive));
assert.equal(cdispdLines(business).length, 0, "business: no CDISPD");
assert.deepEqual(notDeterminable(business), ["OFFICIAL_VALUE_MISSING:DISPATCHING:CTE_NOT_DETERMINABLE", "OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:CTE_NOT_DETERMINABLE"]);
// A household whose use was not read is not a verified household either.
const unverified = await calculatePreparedOffer(quoteRequest("RESIDENTIAL"), prepared, { regulatoryBridge: await bridgeWith(archive), regulatedUnavailableReason: "SUPPLY_USE_CATEGORY_REQUIRED" });
assert.equal(cdispdLines(unverified).length, 0, "use not read: no CDISPD");

// 5. Charges the CTE already includes: dispatching in the energy price adds no CDISPD and nothing is reported missing.
const included = { ...prepared, offer: { ...prepared.offer, passThroughComponents: [{ kind: "DISPATCHING", declarationState: "INCLUDED_IN_ENERGY_PRICE" }] } };
const includedUnknown = await calculatePreparedOffer(quoteRequest("RESIDENTIAL"), included, await unknownDeps(archive));
assert.equal(cdispdLines(includedUnknown).length, 0, "CTE includes dispatching: no CDISPD");
assert.equal(includedUnknown.warnings.some((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:DISPATCHING")), false);
const includedNonResident = await calculatePreparedOffer(quoteRequest("RESIDENTIAL", "NON_RESIDENT"), included, { regulatoryBridge: await bridgeWith(archive), trustedElectricityContext: { ...context, domesticResidenceStatus: "NON_RESIDENT", regulatoryCustomerScope: "DOMESTIC_NON_RESIDENT_BT" } });
assert.equal(cdispdLines(includedNonResident).length, 0, "same rule for the non-resident");

// 6. Missing components block the saving and the proposal: undetermined by the CTE or official value missing.
const row = (details) => ({ status: "COMPLETE", savings: 10, undetermined: [], rows: [{ key: "ENERGY", label: "Vendita", current: 100, offer: 90, details }] });
assert.equal(savingDetermined(row([{ key: "DISPATCHING", label: "Dispacciamento", current: 15, offer: 15.07, difference: 0.07 }])), true);
const cdispdMissing = row([{ key: "DISPATCHING", label: "Dispacciamento", current: 15, offer: null, difference: null, missingReason: "CDISPD ARERA del mese non ancora in archivio" }]);
assert.equal(savingDetermined(cdispdMissing), false, "official value missing: no saving");
assert.deepEqual(missingComponents(cdispdMissing), ["dispacciamento (CDISPD ARERA del mese non ancora in archivio)"]);
assert.equal(savingDetermined({ ...row([]), undetermined: ["Capacity market"] }), false, "undetermined by the CTE: no saving");
const flow = (await import("node:fs")).readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
// Tony (25/11/2026, attività 01): the button is also disabled when the bill's indispensable fields are not verified.
assert.match(flow, /disabled=\{readonly \|\| Boolean\(pending\) \|\| \(selected\.receipt\.status === "COMPLETE" && !savingDetermined\(selected\.receipt\)\)( \|\| definitiveProposalBlock\(quote\.bill\.fieldTrace\) !== null)?\}/, "proposal PDF blocked");

// 7. No double count: every case has at most one CDISPD and never a separate capacity line beside it.
for (const result of [resident, nonResident, unknown, includedUnknown, includedNonResident]) {
  assert.ok(cdispdLines(result).length <= 1, "one CDISPD at most");
  assert.equal(kinds(result, "CAPACITY_MARKET").length, 0, "no capacity beside CDISPD");
}
console.log("CDISPD_UNKNOWN_RESIDENCE=PASS");
