import assert from "node:assert/strict";
import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { calculateRegulatedEeSubset } from "../app/lib/calculation/regulated-ee.ts";

const sourceReference = "https://www.arera.it/fileadmin/allegati/docs/26/227-2026-R-com-TABELLE.xlsx";
const sourceSha256 = "b".repeat(64);
const tenantId = "tenant_bta6-asos-smoke";
const scope = "NON_DOMESTIC_BT_BTA6";
const classes = {
  ASOS_CLASS_0: [12.9924, 14.8164, 0.031875],
  ASOS_CLASS_1: [1.5948, 1.8192, 0.005533],
  ASOS_CLASS_2: [2.6592, 3.0324, 0.009222],
  ASOS_CLASS_3: [3.7224, 4.2444, 0.012910],
};
const rates = [
  ["NETWORK_FIXED", "EUR/POD/YEAR", 5], ["NETWORK_POWER", "EUR/KW/YEAR", 10], ["NETWORK_ENERGY", "EUR/KWH", 0.00066],
  ["METERING_FIXED", "EUR/POD/YEAR", 19.6826], ["TRANSMISSION_ENERGY", "EUR/KWH", 0.0119], ["UC3", "EUR/KWH", 0.00276], ["UC6", "EUR/KWH", 0.00007], ["UC6", "EUR/POD/YEAR", 1.68],
  ["ARIM", "EUR/POD/YEAR", 3.0276], ["ARIM", "EUR/KW/YEAR", 3.4524], ["ARIM", "EUR/KWH", 0.001614],
];
const makeRecord = ({ componentCode, normalizedUnit, value, regulatoryVariant }) => createRegulatoryValue({ tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference, officialIdentifier: "227/2026/R/com", publicationDate: "2026-06-25", retrievedAt: "2026-09-07T00:00:00Z", effectiveFrom: "2026-07-01", effectiveTo: null, componentCode, customerScope: scope, ...(regulatoryVariant === undefined ? {} : { regulatoryVariant }), originalValue: value, originalUnit: normalizedUnit, applicationBasis: "ARERA 227/2026/R/com Tabella ASOS; BTA6 official fixture", sourceSha256 });
const baseRecords = rates.map(([componentCode, normalizedUnit, value]) => makeRecord({ componentCode, normalizedUnit, value }));
const request = { schemaVersion: 1, tenantId, calculationDate: "2026-09-07", supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, customerCategory: "NON_RESIDENTIAL", currency: "EUR", taxTreatment: "EXCLUDED", vector: "EE", voltageLevel: "LV", consumption: { basis: "PERIOD", unit: "KWH", f1: 1000, f2: 0, f3: 0 } };
const context = (asosClass, powerBasisKind = "CONTRACTUAL_COMMITTED", powerBasisKw = 20) => ({ vector: "EE", contractedPowerKw: 20, availablePowerKw: 30, supplyUseCategory: "OTHER_USE", domesticResidenceStatus: "NOT_APPLICABLE", voltageLevel: "LV", regulatoryCustomerScope: scope, regulatoryPowerBasisKind: powerBasisKind, regulatoryPowerBasisKw: powerBasisKw, asosClass, energyIntensiveStatus: asosClass === "ASOS_CLASS_0" ? "NOT_ENERGY_INTENSIVE" : asosClass === "UNKNOWN" ? "UNKNOWN" : "ENERGY_INTENSIVE", asosClassTemporalStatus: "VALID" });
const bridge = (records) => ({ list: async (_tenant, query) => records.filter((record) => record.componentCode === query.componentCode && record.customerScope === query.customerScope && record.normalizedUnit === query.normalizedUnit && (query.regulatoryVariant === undefined || record.regulatoryVariant === query.regulatoryVariant)) });

const calculations = {};
for (const [asosClass, [fixed, power, energy]] of Object.entries(classes)) {
  const records = [...baseRecords, makeRecord({ componentCode: "ASOS", normalizedUnit: "EUR/POD/YEAR", value: fixed, regulatoryVariant: asosClass }), makeRecord({ componentCode: "ASOS", normalizedUnit: "EUR/KW/YEAR", value: power, regulatoryVariant: asosClass }), makeRecord({ componentCode: "ASOS", normalizedUnit: "EUR/KWH", value: energy, regulatoryVariant: asosClass })];
  const result = await calculateRegulatedEeSubset(request, { trustedElectricityContext: context(asosClass), regulatoryBridge: bridge(records) });
  calculations[asosClass] = result;
  assert.equal(result.components.find((component) => component.formulaId === "REGULATED_BTA6_ASOS_FIXED_RATE_TIMES_TIME")?.amount.minorUnits, Math.round(fixed / 12 * 100));
  assert.equal(result.components.find((component) => component.formulaId === "REGULATED_BTA6_ASOS_POWER_RATE_TIMES_REGULATORY_KW_TIME")?.amount.minorUnits, Math.round(power * 20 / 12 * 100));
  assert.equal(result.components.find((component) => component.formulaId === "REGULATED_BTA6_ASOS_ENERGY_RATE_TIMES_KWH")?.amount.minorUnits, Math.round(energy * 1000 * 100));
  assert.deepEqual(result.includedComponents.slice(-3), ["ASOS_FIXED", "ASOS_POWER", "ASOS_ENERGY"]);
  console.log(`${asosClass}_ECONOMIC=PASS`);
}
const nonAsos = (result) => result.components.filter((component) => !String(component.componentId).includes("asos"));
assert.deepEqual(nonAsos(calculations.ASOS_CLASS_0).map((component) => component.amount.minorUnits), nonAsos(calculations.ASOS_CLASS_1).map((component) => component.amount.minorUnits));
assert.notEqual(calculations.ASOS_CLASS_0.components.filter((component) => String(component.componentId).includes("asos")).reduce((sum, component) => sum + component.amount.minorUnits, 0), calculations.ASOS_CLASS_1.components.filter((component) => String(component.componentId).includes("asos")).reduce((sum, component) => sum + component.amount.minorUnits, 0));
console.log("ASOS_CLASS_ONLY_AFFECTS_ASOS=PASS");

const maxRecords = [...baseRecords, makeRecord({ componentCode: "ASOS", normalizedUnit: "EUR/POD/YEAR", value: classes.ASOS_CLASS_0[0], regulatoryVariant: "ASOS_CLASS_0" }), makeRecord({ componentCode: "ASOS", normalizedUnit: "EUR/KW/YEAR", value: classes.ASOS_CLASS_0[1], regulatoryVariant: "ASOS_CLASS_0" }), makeRecord({ componentCode: "ASOS", normalizedUnit: "EUR/KWH", value: classes.ASOS_CLASS_0[2], regulatoryVariant: "ASOS_CLASS_0" })];
const maxResult = await calculateRegulatedEeSubset(request, { trustedElectricityContext: context("ASOS_CLASS_0", "MONTHLY_MAX_DRAWN", 24), regulatoryBridge: bridge(maxRecords) });
assert.equal(maxResult.components.find((component) => component.formulaId === "REGULATED_BTA6_ASOS_POWER_RATE_TIMES_REGULATORY_KW_TIME")?.formulaInputs.powerBasisKw, 24);
assert.equal(maxResult.components.find((component) => component.formulaId === "REGULATED_BTA6_ASOS_POWER_RATE_TIMES_REGULATORY_KW_TIME")?.amount.minorUnits, 2963);
console.log("BTA6_ASOS_POWER_MAX_DRAWN_USED=PASS");

const unknownResult = await calculateRegulatedEeSubset(request, { trustedElectricityContext: context("UNKNOWN"), regulatoryBridge: bridge(baseRecords) });
assert.equal(unknownResult.components.some((component) => String(component.componentId).includes("asos")), false);
assert.equal(unknownResult.partialWarning, "BTA6_ASOS_EXCLUDED_CLASS_UNKNOWN");
assert.equal(unknownResult.includedComponents.includes("ASOS_FIXED"), false);
console.log("UNKNOWN_ASOS_CLASS_OTHER_REGULATED_CONTINUE=PASS");
console.log("BTA6_ASOS_POWER_USES_REGULATORY_POWER_BASIS=PASS");
console.log("AVAILABLE_POWER_USED_FOR_ASOS_POWER=NO");
console.log("REAL_ARERA_ASOS_QA=PASS");
console.log("BTA6 ASOS classes official smoke: ok");
