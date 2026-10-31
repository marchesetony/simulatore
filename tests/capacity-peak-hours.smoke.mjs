import assert from "node:assert/strict";

import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculatePreparedOffer } from "../app/lib/calculation/engine.ts";
import { peakEnergyOf } from "../app/lib/calculation/source-bill-context.ts";
import { mergeTernaCapacityQuarters, ternaCapacityMonthMax } from "../app/lib/foundation/terna-capacity-peak.ts";
import { normalizeAnalystItemCode } from "../app/lib/ingestion/bill-extended-contract.ts";
import { ANALYST_STAGE_PROMPT } from "../app/lib/ingestion/bill-two-stage.ts";

// Tony (30/10): errore su come calcolare il capacity. BT above 55 kW, MT, AT pay the regulated capacity charge (TIV comma
// 34.8 bis, Terna) as kWh in Terna's peak hours x peak rate + the other kWh x off-peak rate, both grossed up for losses.
// Synthetic values only: no customer data, Terna rates invented for the test.
const tenant = "tenant_capacity-peak-hours";
const request = ({ voltageLevel = "LV", periodEnd = "2026-10-01", monthlyProfile } = {}) => parseSimulationRequest({
  schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-09-15", supplyPeriod: { periodStart: "2026-09-01", periodEnd },
  customerCategory: "NON_RESIDENTIAL", voltageLevel, currency: "EUR", taxTreatment: "EXCLUDED",
  consumption: { basis: "PERIOD", unit: "KWH", f1: monthlyProfile ? 1500 : 1000, f2: 0, f3: 0, ...(monthlyProfile ? { monthlyProfile } : {}) }, sourceBill: { billId: "bill-synthetic", version: "v1" },
}, tenant);
const prepared = {
  record: { archiveId: "archive-cap", cteId: "cte-cap" },
  version: { versionId: "version-cap", contract: { tenantId: tenant, vector: "EE", version: "1", supplier: { name: "Fornitore Test" }, offer: { code: "TEST", name: "Offerta Test" }, commercialTerms: {} } },
  offer: {
    schemaVersion: 1, tenantId: tenant, sourceCteId: "cte-cap", sourceCteVersion: "1", approval: { status: "APPROVED" }, offerId: "offer-cap", supplierId: "test", offerCode: "TEST", offerName: "Offerta Test",
    currency: "EUR", taxTreatment: "EXCLUDED", validity: { periodStart: "2026-08-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
    fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [], vector: "EE",
    pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.1, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
  },
  markets: [],
};
// Terna's records are stored for the registry scopes only (resident, BTA6): an MT supply reads them all the same.
const terna = (componentCode, value, effectiveFrom, effectiveTo, customerScope = "NON_DOMESTIC_BT_BTA6") => ({ authority: "TERNA", componentCode, customerScope, normalizedUnit: "EUR/KWH", normalizedValue: value, effectiveFrom, effectiveTo, officialIdentifier: `TERNA_CAPACITY_MARKET_${effectiveFrom.slice(0, 7)}`, sourceReference: "https://dati.terna.it/corrispettivi", retrievedAt: "2026-10-01T00:00:00.000Z" });
const records = [
  terna("CAPACITY_MARKET_PEAK", 0.02, "2026-07-01", "2026-10-01"), terna("CAPACITY_MARKET_OFF_PEAK", 0.004, "2026-07-01", "2026-10-01"),
  terna("CAPACITY_MARKET_PEAK", 0.02, "2026-07-01", "2026-10-01", "DOMESTIC_RESIDENT_BT"), terna("CAPACITY_MARKET_OFF_PEAK", 0.004, "2026-07-01", "2026-10-01", "DOMESTIC_RESIDENT_BT"),
  terna("CAPACITY_MARKET_PEAK", 0.03, "2026-10-01", "2027-01-01"), terna("CAPACITY_MARKET_OFF_PEAK", 0.005, "2026-10-01", "2027-01-01"),
];
const bridge = (stored) => ({ list: async (_tenant, query = {}) => stored.filter((record) => (query.componentCode === undefined || record.componentCode === query.componentCode) && (query.customerScope === undefined || record.customerScope === query.customerScope) && (query.normalizedUnit === undefined || record.normalizedUnit === query.normalizedUnit)) });
const context = { vector: "EE", contractedPowerKw: 98, availablePowerKw: 98, supplyUseCategory: "NON_DOMESTIC", domesticResidenceStatus: "NOT_APPLICABLE", voltageLevel: "LV", regulatoryCustomerScope: "NON_DOMESTIC_BT", asosClass: "UNKNOWN", energyIntensiveStatus: "UNKNOWN", asosClassTemporalStatus: "UNKNOWN" };
const deps = ({ stored = records, peak, withContext = true } = {}) => ({ regulatoryBridge: bridge(stored), regulatoryRuntimeResolver: { resolveDispatching: async () => null, resolveCapacity: async () => null, resolveLoss: async () => null }, ...(withContext ? { trustedElectricityContext: context } : {}), ...(peak ? { billPeakEnergy: peak } : {}) });
const capacity = (result) => result.components.filter((component) => component.formulaInputs?.kind === "CAPACITY_MARKET").map((component) => ({ label: component.label, amount: component.amount.amount, basis: component.formulaInputs.basisQuantity, rate: component.formulaInputs.officialRate }));

// 1. BT 98 kW, the bill prints 100 kWh peak and 300 off-peak (25% peak); the simulation has 1.000 kWh, so 250 + 750.
// Peak 0,02 x 1,10 x 250 = 5,50; off-peak 0,004 x 1,10 x 750 = 3,30.
const split = await calculatePreparedOffer(request(), structuredClone(prepared), deps({ peak: { peakKwh: 100, offPeakKwh: 300 } }));
assert.deepEqual(capacity(split), [{ label: "Mercato della capacità · ore di picco", amount: 5.5, basis: 250, rate: 0.02 }, { label: "Mercato della capacità · fuori picco", amount: 3.3, basis: 750, rate: 0.004 }]);
const peakLine = split.components.find((component) => component.label === "Mercato della capacità · ore di picco");
assert.equal(peakLine.formulaId, "CTE_PASS_THROUGH_RATE_TIMES_KWH"); assert.equal(peakLine.formulaInputs.feeUnit, "EUR_PER_KWH"); assert.equal(peakLine.formulaInputs.feeRate, 0.022); assert.equal(peakLine.formulaInputs.lossFactor, 0.1); assert.equal(peakLine.formulaInputs.source, "TERNA_CAPACITY_MARKET_2026-07");
assert.ok(!split.warnings.some((warning) => /CAPACITY_MARKET:/.test(warning)), split.warnings.join(","));

// 2. Tony (30/10): "la regola dovrebbe esssere il prezzo massimo del mese su tutto il mese di riferimento". Without the
// peak kWh on the bill every kWh of the month takes the month's highest rate: 0,02 x 1,10 x 1.000 = 22.
const fallback = await calculatePreparedOffer(request(), structuredClone(prepared), deps());
assert.deepEqual(capacity(fallback), [{ label: "Mercato della capacità · prezzo massimo del mese (kWh di picco non in bolletta)", amount: 22, basis: 1000, rate: 0.02 }]);
assert.ok(!fallback.warnings.includes("OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:PEAK_HOUR_KWH_MISSING"));

// One line per month: September 1.000 kWh x 0,02 x 1,10 = 22; October 500 kWh x 0,03 x 1,10 = 16,50.
const twoMonths = request({ periodEnd: "2026-11-01", monthlyProfile: [{ month: "2026-09", f1: 1000, f2: 0, f3: 0 }, { month: "2026-10", f1: 500, f2: 0, f3: 0 }] });
const monthly = await calculatePreparedOffer(twoMonths, structuredClone(prepared), deps());
assert.deepEqual(capacity(monthly).map((line) => [line.amount, line.basis, line.rate]), [[22, 1000, 0.02], [16.5, 500, 0.03]]);
assert.deepEqual(monthly.components.filter((component) => component.formulaInputs?.kind === "CAPACITY_MARKET").map((component) => component.formulaInputs.month), ["2026-09", "2026-10"]);

// 3. MT, no trusted context (its scope is outside the ARERA registry), Terna records of the BTA6 scope only: losses 3,8%.
// Peak 0,02 x 1,038 x 250 = 5,19; off-peak 0,004 x 1,038 x 750 = 3,114 -> 3,11.
const mt = await calculatePreparedOffer(request({ voltageLevel: "MV" }), structuredClone(prepared), deps({ stored: records.filter((record) => record.customerScope === "NON_DOMESTIC_BT_BTA6"), peak: { peakKwh: 100, offPeakKwh: 300 }, withContext: false }));
assert.deepEqual(capacity(mt).map((line) => line.amount), [5.19, 3.11]);

// 4. No Terna value in the archive: nothing is estimated, the receipt says the official value is missing.
const none = await calculatePreparedOffer(request(), structuredClone(prepared), deps({ stored: [], peak: { peakKwh: 100, offPeakKwh: 300 } }));
assert.deepEqual(capacity(none), []);
assert.ok(none.warnings.includes("OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:OFFICIAL_VALUE_MISSING"));

// 5. BT up to 55 kW keeps the monthly ARERA value: no peak split.
const small = await calculatePreparedOffer(request(), structuredClone(prepared), { ...deps({ peak: { peakKwh: 100, offPeakKwh: 300 } }), trustedElectricityContext: { ...context, contractedPowerKw: 30, availablePowerKw: 30 } });
assert.deepEqual(capacity(small).map((line) => line.label), ["Mercato della capacità"]);

// Terna helpers: the latest reading wins; the month's maximum covers peak and off-peak.
assert.equal(mergeTernaCapacityQuarters(records).length, 2);
assert.equal(ternaCapacityMonthMax("2026-10", mergeTernaCapacityQuarters(records))?.eurPerKwh, 0.03);
assert.equal(ternaCapacityMonthMax("2027-01", mergeTernaCapacityQuarters(records)), null);
// A quarter whose peak rate was not read: its off-peak rate is not the month's maximum (Tony 30/10, "prezzo massimo del mese").
assert.equal(ternaCapacityMonthMax("2026-10", mergeTernaCapacityQuarters(records.filter((record) => record.componentCode !== "CAPACITY_MARKET_PEAK"))), null);

// Bill reading: the analyst catalog and prompt name the facts, and only the approved bill's facts are read.
assert.equal(normalizeAnalystItemCode("ENERGY_PEAK_KWH"), "ENERGY_PEAK_KWH");
assert.equal(normalizeAnalystItemCode("energy off peak kwh"), "ENERGY_OFF_PEAK_KWH");
assert.match(ANALYST_STAGE_PROMPT, /ENERGY_PEAK_KWH e ENERGY_OFF_PEAK_KWH/);
assert.deepEqual(peakEnergyOf({ extendedFacts: [{ code: "ENERGY_PEAK_KWH", value: "1.234,5", unit: "kWh", status: "FOUND" }, { code: "ENERGY_OFF_PEAK_KWH", value: "3.702 kWh", status: "FOUND" }] }), { billPeakEnergy: { peakKwh: 1234.5, offPeakKwh: 3702 } });
assert.deepEqual(peakEnergyOf({ extendedFacts: [{ code: "ENERGY_PEAK_KWH", value: "100", status: "FOUND" }] }), {});
assert.deepEqual(peakEnergyOf({ extendedFacts: [{ code: "ENERGY_PEAK_KWH", value: "100", status: "NEEDS_REVIEW" }, { code: "ENERGY_OFF_PEAK_KWH", value: "300", status: "FOUND" }] }), {});
// Never from the browser request.
assert.throws(() => parseSimulationRequest({ ...JSON.parse(JSON.stringify(request())), billPeakEnergy: { peakKwh: 1, offPeakKwh: 1 } }, tenant), /TRUSTED_OUTCOME_FORBIDDEN/);

console.log("CAPACITY_PEAK_HOURS=PASS");
