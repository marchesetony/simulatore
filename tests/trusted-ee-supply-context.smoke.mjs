import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { buildTrustedElectricitySupplyContext, parseAvailablePowerKw, parseContractedPowerKw } from "../app/lib/calculation/trusted-ee-supply-context.ts";

const tenant = "tenant_trusted-context";
const fact = (code, value, status = "FOUND") => ({ code, value, status });

function profile({ residence = "residente", supplyUse = "domestico", committed = "3 kW", available = "6 kW", maximumDrawn = null, billingBasis = null, powerStatus = "FOUND", voltage = "BT" } = {}) {
  return buildBillSupplyProfile([
    fact("SUPPLY_USE_CATEGORY_RAW", supplyUse),
    fact("DOMESTIC_RESIDENCE_STATUS_RAW", residence),
    fact("VOLTAGE_CLASS_RAW", voltage),
    ...(committed === null ? [] : [fact("POWER_COMMITTED", committed, powerStatus)]),
    ...(available === null ? [] : [fact("POWER_AVAILABLE", available)]),
    ...(maximumDrawn === null ? [] : [fact("POWER_MAXIMUM_DRAWN", maximumDrawn)]),
    ...(billingBasis === null ? [] : [fact("POWER_BILLING_BASIS_RAW", billingBasis)]),
  ]);
}

function assertCode(action, code) { assert.throws(action, (error) => error?.code === code, `expected ${code}`); }

assert.equal(parseContractedPowerKw({ rawValue: "3 kW", normalizedValue: null, status: "FOUND" }), 3);
assert.equal(parseContractedPowerKw({ rawValue: "4,5 kW", normalizedValue: null, status: "FOUND" }), 4.5);
assertCode(() => parseContractedPowerKw({ rawValue: "-1 kW", normalizedValue: null, status: "FOUND" }), "CONTRACTED_POWER_INVALID");
assertCode(() => parseContractedPowerKw({ rawValue: "0 kW", normalizedValue: null, status: "FOUND" }), "CONTRACTED_POWER_INVALID");
assertCode(() => parseContractedPowerKw({ rawValue: "3 kW / 4 kW", normalizedValue: null, status: "FOUND" }), "CONTRACTED_POWER_INVALID");
assertCode(() => parseContractedPowerKw({ rawValue: "3", normalizedValue: null, status: "FOUND" }), "CONTRACTED_POWER_INVALID");

const resident = buildTrustedElectricitySupplyContext(profile());
assert.equal(resident.contractedPowerKw, 3);
assert.equal(resident.availablePowerKw, 6);
assert.equal(resident.regulatoryCustomerScope, "DOMESTIC_RESIDENT_BT");
assert.equal(parseAvailablePowerKw(profile().powerAvailable), 6);

const nonResident = buildTrustedElectricitySupplyContext(profile({ residence: "non residente", committed: "4,5 kW" }));
assert.equal(nonResident.contractedPowerKw, 4.5);
assert.equal(nonResident.regulatoryCustomerScope, "DOMESTIC_NON_RESIDENT_BT");

const bta6 = buildTrustedElectricitySupplyContext(profile({ supplyUse: "altri usi", committed: "17 kW", available: "18,7 kW", billingBasis: "Potenza contrattualmente impegnata" }));
assert.equal(bta6.contractedPowerKw, 17);
assert.equal(bta6.availablePowerKw, 18.7);
assert.equal(bta6.regulatoryCustomerScope, "NON_DOMESTIC_BT_BTA6");
assert.equal(bta6.regulatoryPowerBasisKind, "CONTRACTUAL_COMMITTED");
assert.equal(bta6.regulatoryPowerBasisKw, 17);
const bta6MaxDrawn = buildTrustedElectricitySupplyContext(profile({ supplyUse: "altri usi", committed: "20 kW", available: "30 kW", maximumDrawn: "24 kW", billingBasis: "Massimo valore della potenza prelevata nel mese" }));
assert.equal(bta6MaxDrawn.regulatoryPowerBasisKind, "MONTHLY_MAX_DRAWN");
assert.equal(bta6MaxDrawn.regulatoryPowerBasisKw, 24);
assertCode(() => buildTrustedElectricitySupplyContext(profile({ supplyUse: "altri usi", committed: "20 kW", available: "30 kW" })), "BTA6_POWER_BILLING_BASIS_REQUIRED");
assertCode(() => buildTrustedElectricitySupplyContext(profile({ supplyUse: "altri usi", committed: "20 kW", available: "30 kW", billingBasis: "Massimo valore della potenza prelevata nel mese" })), "BTA6_MAXIMUM_DRAWN_POWER_REQUIRED");
assert.equal(buildTrustedElectricitySupplyContext(profile({ supplyUse: "altri usi", committed: "17 kW", available: "16,5 kW" })).regulatoryCustomerScope, "NON_DOMESTIC_BT");
assertCode(() => buildTrustedElectricitySupplyContext(profile({ supplyUse: "altri usi", committed: "25 kW", available: null })), "AVAILABLE_POWER_REQUIRED_FOR_BT_TARIFF_CLASS");
assert.equal(buildTrustedElectricitySupplyContext(profile({ supplyUse: "pubblica illuminazione", committed: "17 kW", available: "18,7 kW" })).regulatoryCustomerScope, "NON_DOMESTIC_BT");
assert.equal(buildTrustedElectricitySupplyContext(profile({ supplyUse: "ricarica veicoli elettrici", committed: "17 kW", available: "18,7 kW" })).regulatoryCustomerScope, "NON_DOMESTIC_BT");

assertCode(() => buildTrustedElectricitySupplyContext(profile({ residence: "domestico" })), "DOMESTIC_RESIDENCE_INVALID");
assertCode(() => buildTrustedElectricitySupplyContext(profile({ committed: null, available: "6 kW" })), "CONTRACTED_POWER_REQUIRED");
assert.equal(buildTrustedElectricitySupplyContext(profile({ committed: "3 kW", available: "9 kW" })).contractedPowerKw, 3);
assertCode(() => buildTrustedElectricitySupplyContext(profile({ supplyUse: "domestico", voltage: "MT" })), "REGULATORY_SCOPE_UNRESOLVED");

const baseRequest = {
  schemaVersion: 1,
  tenantId: tenant,
  vector: "EE",
  calculationDate: "2026-08-01",
  supplyPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" },
  customerCategory: "RESIDENTIAL",
  residency: "RESIDENT",
  voltageLevel: "LV",
  currency: "EUR",
  taxTreatment: "EXCLUDED",
  consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 25 },
};
assertCode(() => parseSimulationRequest({ ...baseRequest, customerScope: "NON_DOMESTIC_BT" }, tenant), "TRUSTED_OUTCOME_FORBIDDEN");
assertCode(() => parseSimulationRequest({ ...baseRequest, regulatoryCustomerScope: "NON_DOMESTIC_BT_BTA6" }, tenant), "TRUSTED_OUTCOME_FORBIDDEN");
assertCode(() => parseSimulationRequest({ ...baseRequest, contractedPowerKw: 3 }, tenant), "TRUSTED_OUTCOME_FORBIDDEN");
assertCode(() => parseSimulationRequest({ ...baseRequest, availablePowerKw: 3.3 }, tenant), "TRUSTED_OUTCOME_FORBIDDEN");
assertCode(() => parseSimulationRequest({ ...baseRequest, trustedSupplyContext: {} }, tenant), "TRUSTED_OUTCOME_FORBIDDEN");
for (const [field, value] of [["powerMaximumDrawn", 24], ["powerBillingBasis", "MONTHLY_MAX_DRAWN"], ["regulatoryPowerBasisKw", 24], ["regulatoryPowerBasisKind", "MONTHLY_MAX_DRAWN"]]) assertCode(() => parseSimulationRequest({ ...baseRequest, [field]: value }, tenant), "TRUSTED_OUTCOME_FORBIDDEN");

const gas = parseSimulationRequest({ ...baseRequest, vector: "GAS", residency: undefined, consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: false } } }, tenant);
assert.equal(gas.vector, "GAS");
assert.equal(gas.consumption.smc, 100);

let networkCalled = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { networkCalled = true; throw new Error("NETWORK_FORBIDDEN"); };
try { buildTrustedElectricitySupplyContext(profile()); } finally { globalThis.fetch = originalFetch; }
assert.equal(networkCalled, false);

const source = await readFile(new URL("../app/lib/calculation/trusted-ee-supply-context.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /(?:ARERA|TERNA|GME|PUN|ASOS|ARIM|UC3|UC6|CAPACITY_MARKET|DISPATCHING|EUR\/KWH|EUR\/KW)/);
assert.doesNotMatch(source, /(?:fetch\s*\(|https?:\/\/)/);

console.log("CONTRACTED_POWER_TESTS=PASS");
console.log("CUSTOMER_CLASSIFICATION_TESTS=PASS");
console.log("BTA6_CLASSIFICATION=PASS");
console.log("BTA6_THRESHOLD_STRICT=PASS");
console.log("OTHER_USE_MISSING_AVAILABLE_POWER_FAIL_CLOSED=PASS");
console.log("PUBLIC_LIGHTING_NOT_BTA6=PASS");
console.log("PUBLIC_EV_CHARGING_NOT_BTA6=PASS");
console.log("CLIENT_SCOPE_REJECTED=PASS");
console.log("BTA6_CLIENT_SCOPE_FORBIDDEN=PASS");
console.log("TRUSTED_POWER_FIELDS_CLIENT_FORBIDDEN=PASS");
console.log("GAS_REGRESSION=PASS");
console.log("NO_NETWORK=PASS");
console.log("NO_TARIFF_HARDCODE=PASS");
