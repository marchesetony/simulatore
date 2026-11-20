import assert from "node:assert/strict";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11, bolletta Elios CER SMART1 CASA, 378,05 kWh): "Quota variabile smart (CVS) Euro/kWh 0,025000 378,05 9,45 …
// Quota variabile voci di trasporto Euro/kWh 0,010000 378,05 3,78 … dove li hai inseriti". Each keeps its own line with the
// bill's name: the CVS is commercializzazione, priced inside the household CTE spread; the other is not in the CTE.
const line = (classification, group, amount, description, unit = "kWh") => ({ classification, group, amount, description, rawDescription: description, unit, unitPrice: null, rawUnitPrice: "", rawValue: "", aggregate: false, includedInReconciliation: true });
const components = [
  line("ENERGY_PRICE", "ENERGY_PRICE", "83,78", "Componente energia"),
  line("COMMERCIALIZATION_VARIABLE_FEE", "COMMERCIALIZATION", "9,45", "Quota variabile smart (CVS)"),
  line("OTHER_SELLER_ENERGY_CHARGE", "OTHER_SELLER_CHARGES", "3,78", "Quota variabile voci di trasporto"),
  line("PCV", "COMMERCIALIZATION", "6,35", "Quota fissa", "POD/mese"),
];
const totals = { sellerEnergyTotal: 97.01, sellerCommercializationTotal: 6.35, sellerOtherTotal: 0, regulatedNetworkTotal: 0, systemChargesTotal: 0, taxTotal: 0 };
const offer = [
  { category: "ENERGY", sign: "CHARGE", amount: { amount: 90.21 }, label: "Energia" },
  { category: "FIXED_FEE", sign: "CHARGE", amount: { amount: 11.9 }, label: "PCV", formulaInputs: { feeUnit: "EUR_PER_MONTH" } },
];
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 102.11, analysis: { components, totals }, domestic: true, validUntil: null, offerComponents: offer, householdSpread: true });
const details = receipt.rows.find((row) => row.key === "ENERGY").details;
const named = (text) => details.find((item) => item.label.includes(text));
const cvs = named("Quota variabile smart (CVS)");
assert.ok(cvs, JSON.stringify(details.map((item) => item.label)));
assert.equal(cvs.current, 9.45);
assert.match(cvs.offerNote, /compreso nello spread/);
const transport = named("Quota variabile voci di trasporto");

assert.equal(transport.current, 3.78);
assert.equal(transport.offer, null);
const energy = details.find((item) => item.key === "ENERGY");
assert.equal(energy.current, 83.78);
assert.equal(energy.difference, Math.round((90.21 - 83.78 - 9.45) * 100) / 100, "the spread is compared with energy plus the CVS");
console.log("receipt seller names ok");
