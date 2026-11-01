import assert from "node:assert/strict";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildTrustedElectricitySupplyContext } from "../app/lib/calculation/trusted-ee-supply-context.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";

const fact = (code, value, status = "FOUND") => ({ code, value, status });
const profile = ({ basis = "Potenza contrattualmente impegnata", maximum = "24 kW" } = {}) => buildBillSupplyProfile([
  fact("SUPPLY_USE_CATEGORY_RAW", "Altri usi"), fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Non applicabile"), fact("VOLTAGE_CLASS_RAW", "BT"),
  fact("POWER_COMMITTED", "20 kW"), fact("POWER_AVAILABLE", "30 kW"), ...(maximum === null ? [] : [fact("POWER_MAXIMUM_DRAWN", maximum)]), ...(basis === null ? [] : [fact("POWER_BILLING_BASIS_RAW", basis)]),
]);
// Tony (1/11, "la potenza si calcola come da norma sulla potenza impegnata sino a 16,5 oltre 16,5 sul massimo picco del
// mese"): above 16,5 kW the month's maximum drawn power is the basis whenever the bill prints it.
const contractual = buildTrustedElectricitySupplyContext(profile());
assert.equal(contractual.regulatoryCustomerScope, "NON_DOMESTIC_BT_BTA6");
assert.equal(contractual.regulatoryPowerBasisKind, "MONTHLY_MAX_DRAWN");
assert.equal(contractual.regulatoryPowerBasisKw, 24);
// Without a printed maximum the committed power stays the basis.
const unprinted = buildTrustedElectricitySupplyContext(profile({ maximum: null }));
assert.equal(unprinted.regulatoryPowerBasisKind, "CONTRACTUAL_COMMITTED");
assert.equal(unprinted.regulatoryPowerBasisKw, 20);
const maxDrawn = buildTrustedElectricitySupplyContext(profile({ basis: "Massimo valore della potenza prelevata nel mese" }));
assert.equal(maxDrawn.regulatoryPowerBasisKind, "MONTHLY_MAX_DRAWN");
assert.equal(maxDrawn.regulatoryPowerBasisKw, 24);
// Tony (27/10): "il criterio di calcolo non lo devi vedere dalla bolletta, ma devi leggere le delibere". TIT art. 1: committed
// power where a limiter is fitted (only up to 30 kW), otherwise the monthly maximum drawn. Up to 30 kW with no stated
// basis -> committed power; above 30 kW -> maximum drawn whatever the bill says, and without that reading it fails closed.
const limited = buildTrustedElectricitySupplyContext(profile({ basis: "Potenza rilevata" }));
assert.equal(limited.regulatoryPowerBasisKind, "MONTHLY_MAX_DRAWN"); // Tony 1/11: printed maximum wins above 16,5 kW
assert.equal(limited.regulatoryPowerBasisKw, 24);
const large = (maximum) => buildBillSupplyProfile([
  fact("SUPPLY_USE_CATEGORY_RAW", "Altri usi"), fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Non applicabile"), fact("VOLTAGE_CLASS_RAW", "BT"),
  fact("POWER_COMMITTED", "85 kW"), fact("POWER_AVAILABLE", "85 kW"), ...(maximum === null ? [] : [fact("POWER_MAXIMUM_DRAWN", maximum)]), fact("POWER_BILLING_BASIS_RAW", "Potenza contrattualmente impegnata"),
]);
const repower = buildTrustedElectricitySupplyContext(large("151,80 kW"));
assert.equal(repower.regulatoryPowerBasisKind, "MONTHLY_MAX_DRAWN");
assert.equal(repower.regulatoryPowerBasisKw, 151.8);
assert.throws(() => buildTrustedElectricitySupplyContext(large(null)), /BTA6_MAXIMUM_DRAWN_POWER_REQUIRED/);
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

// Tony (1/11, "sino a 16,5 oltre 16,5 sul massimo picco del mese"): the regulated engine keeps a multi-month bill up to 30 kW
// on the committed power instead of blocking it; above 30 kW the monthly maxima stay required. The scontrino shows the same kW.
{
  const { readFileSync } = await import("node:fs");
  const engine = readFileSync(new URL("../app/lib/calculation/regulated-ee.ts", import.meta.url), "utf8");
  assert.match(engine, /months > 1 && context\.contractedPowerKw > 30\) return fail\("BTA6_MONTHLY_MAX_POWER_PROFILE_REQUIRED"\)/);
  const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /above && maximumDrawnPowerKw \? maximumDrawnPowerKw : contractedPowerKw/);
  assert.match(flow, /powerKw: powerQuotaKw\(context\)/);
  console.log("BTA6_SCONTRINO_KW=PASS");
}
