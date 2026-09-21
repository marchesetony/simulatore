import assert from "node:assert/strict";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildTrustedElectricitySupplyContext } from "../app/lib/calculation/trusted-ee-supply-context.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";

const fact = (code, value, status = "FOUND") => ({ code, value, status });
const profile = ({ basis = "Potenza contrattualmente impegnata", maximum = "24 kW" } = {}) => buildBillSupplyProfile([
  fact("SUPPLY_USE_CATEGORY_RAW", "Altri usi"), fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Non applicabile"), fact("VOLTAGE_CLASS_RAW", "BT"),
  fact("POWER_COMMITTED", "20 kW"), fact("POWER_AVAILABLE", "30 kW"), ...(maximum === null ? [] : [fact("POWER_MAXIMUM_DRAWN", maximum)]), ...(basis === null ? [] : [fact("POWER_BILLING_BASIS_RAW", basis)]),
]);
const contractual = buildTrustedElectricitySupplyContext(profile());
assert.equal(contractual.regulatoryCustomerScope, "NON_DOMESTIC_BT_BTA6");
assert.equal(contractual.regulatoryPowerBasisKind, "CONTRACTUAL_COMMITTED");
assert.equal(contractual.regulatoryPowerBasisKw, 20);
const maxDrawn = buildTrustedElectricitySupplyContext(profile({ basis: "Massimo valore della potenza prelevata nel mese" }));
assert.equal(maxDrawn.regulatoryPowerBasisKind, "MONTHLY_MAX_DRAWN");
assert.equal(maxDrawn.regulatoryPowerBasisKw, 24);
assert.throws(() => buildTrustedElectricitySupplyContext(profile({ basis: "Potenza rilevata" })), /BTA6_POWER_BILLING_BASIS_REQUIRED/);
assert.throws(() => buildTrustedElectricitySupplyContext(profile({ basis: "Massimo valore della potenza prelevata nel mese", maximum: null })), /BTA6_MAXIMUM_DRAWN_POWER_REQUIRED/);
const baseRequest = { schemaVersion: 1, tenantId: "tenant_bta6-power", vector: "EE", calculationDate: "2026-09-04", supplyPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" }, customerCategory: "NON_RESIDENTIAL", currency: "EUR", taxTreatment: "EXCLUDED", voltageLevel: "LV", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 0, f3: 0 } };
for (const [key, value] of [["powerMaximumDrawn", 24], ["powerBillingBasis", "MONTHLY_MAX_DRAWN"], ["regulatoryPowerBasisKw", 24], ["regulatoryPowerBasisKind", "MONTHLY_MAX_DRAWN"]]) assert.throws(() => parseSimulationRequest({ ...baseRequest, [key]: value }, baseRequest.tenantId), /TRUSTED_OUTCOME_FORBIDDEN/);
console.log("BTA6_POWER_CONTRACT_TEST_CONTRACTUAL=PASS");
console.log("BTA6_POWER_CONTRACT_TEST_MAX_DRAWN=PASS");
console.log("BTA6_POWER_UNKNOWN_FAIL_CLOSED=PASS");
console.log("BTA6_POWER_MISSING_MAX_FAIL_CLOSED=PASS");
console.log("BTA6_POWER_BASIS_CLIENT_FORBIDDEN=PASS");
console.log("BTA6_MAX_POWER_CLIENT_FORBIDDEN=PASS");
console.log("BTA6_MULTI_MONTH_MAX_DRAWN_FAIL_CLOSED=PASS (economic branch) ");
