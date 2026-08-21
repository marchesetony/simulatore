import assert from "node:assert/strict";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";

const fact = (code, value, status = "FOUND") => ({ code, value, status });
const resident = buildBillSupplyProfile([
  fact("SUPPLY_USE_CATEGORY_RAW", "Domestico residente"),
  fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Domestico residente"),
  fact("CONTRACTUAL_TARIFF_CATEGORY_RAW", "TD"),
  fact("MARKET_REGIME_RAW", "Mercato libero"),
  fact("VOLTAGE_CLASS_RAW", "Bassa tensione (BT)"),
  fact("NOMINAL_VOLTAGE", "230 V"),
  fact("POWER_COMMITTED", "3 kW"),
  fact("POWER_AVAILABLE", "3,3 kW"),
]);
assert.equal(resident.supplyUseCategory.rawValue, "Domestico residente");
assert.equal(resident.supplyUseCategory.normalizedValue, "DOMESTIC");
assert.equal(resident.domesticResidenceStatus.normalizedValue, "RESIDENT");
assert.equal(resident.contractualTariffCategory.normalizedValue, "TD");
assert.equal(resident.marketRegime.normalizedValue, "MERCATO_LIBERO");
assert.equal(resident.voltageClass.normalizedValue, "LV");
assert.equal(resident.nominalVoltage.rawValue, "230 V");
assert.equal(resident.powerCommitted.rawValue, "3 kW");
assert.equal(resident.powerAvailable.rawValue, "3,3 kW");

const otherUse = buildBillSupplyProfile([fact("SUPPLY_USE_CATEGORY_RAW", "Altri usi")]);
assert.equal(otherUse.supplyUseCategory.normalizedValue, "OTHER_USE");
assert.equal(otherUse.domesticResidenceStatus.normalizedValue, "NOT_APPLICABLE");

const equivalentPhrase = buildBillSupplyProfile([fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Domestico residente")]);
assert.equal(equivalentPhrase.supplyUseCategory.rawValue, "Domestico residente");
assert.equal(equivalentPhrase.supplyUseCategory.normalizedValue, "DOMESTIC");
assert.equal(equivalentPhrase.domesticResidenceStatus.normalizedValue, "RESIDENT");

const noInference = buildBillSupplyProfile([fact("SUPPLY_USE_CATEGORY_RAW", "RESIDENTIAL")]);
assert.equal(noInference.supplyUseCategory.normalizedValue, "UNKNOWN");
assert.equal(noInference.domesticResidenceStatus.normalizedValue, "UNKNOWN");

console.log("BILL_SUPPLY_PROFILE_NORMALIZATION=OK");
console.log("BILL_SUPPLY_PROFILE_RAW_PRESERVED=OK");
console.log("BILL_SUPPLY_PROFILE_NO_INFERENCE=OK");
