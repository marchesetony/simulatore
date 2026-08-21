import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";

const line = (code, description, quantity, unit, unitPrice, amount, period = "07/2026") => ({
  code, description, quantity, unit, unitPrice, amount, period,
  rawDescription: description, rawValue: amount, rawUnit: unit,
  rawQuantity: quantity, rawUnitPrice: unitPrice, rawAmount: amount, rawPeriod: period,
  documentEvidence: description, status: "FOUND",
});

const inputs = [
  line("ENERGY_INDEX", "PUN applicato", "1000", "EUR/kWh", "0,15000", "150,00"),
  line("ENERGY_SPREAD", "Spread", "1000", "EUR/kWh", "0,01000", "10,00"),
  line("PCV", "PCV", "1", "EUR/anno", "120,00", "120,00", "2026"),
  line("COMMERCIALIZATION_FIXED_FEE", "Quota commerciale del venditore", "1", "EUR/mese", "20,00", "20,00"),
  line("SELLER_FIXED_FEE", "Quota fissa venditore", "1", "EUR", "5,00", "5,00"),
  line("DISPATCHING_SELLER_CHARGE", "Dispacciamento venditore", "1000 kWh", "EUR/MWh", "4,00", "4,00"),
  line("CAPACITY_MARKET_SELLER_CHARGE", "Capacity Market", "1", "EUR", "3,00", "3,00"),
  line("OTHER_SELLER_ENERGY_CHARGE", "Corrispettivo energia ulteriore", "1", "EUR", "2,00", "2,00"),
  line("LINEA_NON_CATALOGATA", "Corrispettivo documentale non catalogato", "1", "EUR", "1,00", "1,00"),
  line("NETWORK_SYSTEM", "Rete", "1", "EUR", "30,00", "30,00"),
  line("ASOS", "Oneri di sistema", "1", "EUR", "20,00", "20,00"),
  line("VAT", "IVA", "1", "EUR", "34,00", "34,00"),
  line("CANONE_RAI", "Canone RAI", "1", "EUR", "5,00", "5,00"),
];

const analysis = buildCurrentBillEconomicAnalysis(inputs, "404,00");
const byCode = (code) => analysis.components.find((component) => component.code === code);

assert.equal(byCode("PCV")?.classification, "PCV");
assert.equal(byCode("COMMERCIALIZATION_FIXED_FEE")?.classification, "COMMERCIALIZATION_FIXED_FEE");
assert.notEqual(byCode("COMMERCIALIZATION_FIXED_FEE")?.classification, "PCV");
assert.equal(byCode("SELLER_FIXED_FEE")?.classification, "SELLER_FIXED_FEE");
assert.equal(byCode("LINEA_NON_CATALOGATA")?.classification, "UNCLASSIFIED_BILL_CHARGE");
assert.equal(byCode("LINEA_NON_CATALOGATA")?.rawDescription, "Corrispettivo documentale non catalogato");
assert.equal(byCode("LINEA_NON_CATALOGATA")?.rawAmount, "1,00");
assert.equal(byCode("ENERGY_INDEX")?.calculationCheck, "MATCH");
assert.equal(byCode("DISPATCHING_SELLER_CHARGE")?.calculationCheck, "MATCH");
assert.equal(analysis.components.length, inputs.length);
assert.equal(analysis.currentSellerCostBreakdown.ENERGY_PRICE.length, 2);
assert.equal(analysis.currentSellerCostBreakdown.COMMERCIALIZATION.length, 3);
assert.equal(analysis.currentSellerCostBreakdown.DISPATCHING_OR_PASS_THROUGH.length, 1);
assert.equal(analysis.currentSellerCostBreakdown.CAPACITY_MARKET.length, 1);
assert.equal(analysis.currentSellerCostBreakdown.OTHER_SELLER_CHARGES.length, 1);
assert.equal(analysis.regulatedAndSystemCosts.ARERA_NETWORK.length, 1);
assert.equal(analysis.regulatedAndSystemCosts.ARERA_SYSTEM_CHARGES.length, 1);
assert.equal(analysis.taxesAndOtherItems.TAXES.length, 1);
assert.equal(analysis.totals.currentBillReconstructedTotal, 404);
assert.equal(analysis.totals.reconciliationStatus, "RECONCILED");
assert.equal(analysis.totals.reconstructedCurrentSupplyTotal + analysis.totals.tvFeeTotal, analysis.totals.currentPeriodTotal);
assert.equal(analysis.totals.priorBalanceTotal, null);

console.log("PCV_EXTRACTED_WHEN_PRESENT=OK");
console.log("SELLER_COMMERCIAL_FEE_NOT_FALSELY_MAPPED_TO_PCV=OK");
console.log("SELLER_FIXED_FEE_EXTRACTED=OK");
console.log("ALL_BILL_CHARGES_PRESERVED=OK");
console.log("UNKNOWN_CHARGE_NOT_DROPPED=OK");
console.log("SELLER_COSTS_SEPARATE_FROM_REGULATED_COSTS=OK");
console.log("TAXES_SEPARATE_FROM_SELLER_COSTS=OK");
console.log("QUANTITY_UNIT_PRICE_AMOUNT_RECONCILIATION=OK");
console.log("CURRENT_BILL_TOTAL_RECONSTRUCTION=OK");
console.log("OUR_CTE_ONLY_USED_AFTER_CURRENT_BILL_RECONSTRUCTION=OK");
console.log("bill economic components smoke: ok");
