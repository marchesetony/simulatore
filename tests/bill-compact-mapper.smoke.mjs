import assert from "node:assert/strict";
import { BILL_WIRE_FIELD_NAMES, mapBillWireToStructuredBill } from "../app/lib/ingestion/bill-wire.ts";

const found = (value) => ({ value, status: "FOUND" });
const missing = () => ({ value: "NOT_FOUND", status: "NOT_FOUND" });
const wire = { schemaVersion: 1 };
for (const name of BILL_WIRE_FIELD_NAMES) {
  if (name === "customerId") continue;
  wire[name] = name === "vector" ? found("EE") : name === "supplier" ? found("Supplier sintetico") : name === "customerType" ? found("RESIDENTIAL") : name === "voltageLevel" ? found("LV") : name === "billingPeriod" ? missing() : name === "pod" ? found("IT001E12345678") : name === "pdr" ? missing() : name === "f1Consumption" ? found("80") : name === "f2Consumption" ? found("70") : name === "f3Consumption" ? found("70") : name === "billedConsumption" ? found("220") : name === "annualConsumption" ? found("2700") : name === "powerKw" ? found("3") : missing();
}

const factCodes = [
  ["SUPPLY_ADDRESS", "Via sintetica 1"], ["SUPPLY_CITY", "Roma sintetica"], ["SUPPLY_POSTAL_CODE", "00100"], ["SUPPLY_PROVINCE", "RM"],
  ["NOMINAL_VOLTAGE", "230"], ["POWER_COMMITTED", "3"], ["POWER_AVAILABLE", "3"], ["BILLING_PERIOD_RAW", "01/07/2026 - 31/07/2026"],
  ["BILL_ISSUE_DATE", "02/08/2026"], ["BILL_DUE_DATE", "20/08/2026"], ["ECONOMIC_EXPIRY", "31/12/2026"], ["CONTRACT_EXPIRY", "31/12/2027"], ["CONTRACT_INDEFINITE", "NO"],
  ["PAYMENT_METHOD", "Addebito diretto"], ["PAYMENT_REGULARITY", "Regolari"], ["OUTSTANDING_AMOUNT", "0"],
  ["PUN_SINGLE", "0,15000"], ["PUN_F1", "0,15000"], ["PUN_F2", "0,15000"], ["PUN_F3", "0,15000"], ["SPREAD", "0,01000"], ["UNKNOWN", "future"] ,
].map(([code, value]) => ({ kind: "FACT", code, value, unit: code.startsWith("PUN") || code === "SPREAD" ? "EUR/kWh" : "", description: "", period: "", status: "FOUND" }));
const chargeCodes = ["DISPATCHING", "IMBALANCE", "CAPACITY_MARKET", "SELLER_FIXED", "COMMERCIALIZATION", "NETWORK_SYSTEM", "NETWORK_FIXED", "POWER_CHARGE", "ASOS", "ARIM", "EXCISE", "VAT", "DISCOUNT", "BONUS", "RECALCULATION", "OTHER_CHARGE"];
const chargeItems = chargeCodes.map((code) => ({ kind: "CHARGE", code, value: "1,00", unit: "EUR", description: code, period: "07/2026", status: "FOUND" }));
const extraction = mapBillWireToStructuredBill({ ...wire, analystItems: [...factCodes, ...chargeItems] });

const fact = (code) => extraction.extendedFacts.find((item) => item.code === code);
const charge = (code) => extraction.economicChargeLines.find((item) => item.code === code);
for (const code of ["SUPPLY_ADDRESS", "NOMINAL_VOLTAGE", "BILLING_PERIOD_RAW", "BILL_DUE_DATE", "ECONOMIC_EXPIRY", "CONTRACT_EXPIRY", "CONTRACT_INDEFINITE", "PAYMENT_METHOD", "PAYMENT_REGULARITY", "PUN_SINGLE", "PUN_F1", "PUN_F2", "PUN_F3", "SPREAD"]) assert.equal(fact(code)?.status, "FOUND", code);
for (const code of chargeCodes) assert.equal(charge(code)?.status, "FOUND", code);
assert.deepEqual(extraction.billingPeriod.value, { from: "2026-07-01", to: "2026-07-31", raw: "01/07/2026 - 31/07/2026" });
assert.equal(extraction.voltageLevel.value, "LV");
assert.equal(extraction.f1Consumption.value, 80);
assert.equal(fact("PUN_F1").value, "0,15000");
assert.equal(charge("DISPATCHING").amount, "1,00");
console.log("COMPACT_MAPPER_SUPPLY_ADDRESS=OK");
console.log("COMPACT_MAPPER_NOMINAL_VOLTAGE=OK");
console.log("COMPACT_MAPPER_BILLING_PERIOD=OK");
console.log("COMPACT_MAPPER_DATES=OK");
console.log("COMPACT_MAPPER_PAYMENT=OK");
console.log("COMPACT_MAPPER_ECONOMICS=OK");
console.log("COMPACT_MAPPER_PUN_CONSUMPTION_SEPARATION=OK");
console.log("bill compact mapper smoke: ok");
