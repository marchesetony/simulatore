import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (3/11): "busines sempre 22 con possibilita di variarla al 10 se rientra nelle categorie previste".
// Synthetic business bill printed at 10%: the new offer is priced at 22% unless the operator picks 10%.
const line = (description, amount, code = null, unit = "", quantity = "", unitPrice = "") => ({ code, description, amount, quantity, unitPrice, unit, period: null });
const analysis = buildCurrentBillEconomicAnalysis([
  line("Energia Attiva F1", "100,00", "SELLER_ENERGY_FEE", "€/kWh", "400", "0,25"),
  line("Imposte erariali", "10,00", "EXCISE"),
  line("IVA 10%", "11,00", "VAT"),
], null);
const base = { vector: "EE", offerSupplyCost: 100, analysis, validUntil: null, offerComponents: [] };

const business = buildQuoteReceipt({ ...base, domestic: false });
assert.equal(business.billVatRate, 0.1, "the bill's own rate is kept for the bill column");
assert.equal(business.vatRate, 0.22, "business offer defaults to 22%");
assert.equal(business.rows.find((row) => row.key === "TAXES").current, 21, "bill taxes as printed");
assert.equal(business.rows.find((row) => row.key === "TAXES").offer, 34.2, "10,00 excise + (100 + 10) x 22%");

const eligible = buildQuoteReceipt({ ...base, domestic: false, offerVatRate: 0.1 });
assert.equal(eligible.vatRate, 0.1, "the operator can lower it to 10% for an eligible business");
assert.equal(eligible.rows.find((row) => row.key === "TAXES").offer, 21, "same as the bill at 10%");

const household = buildQuoteReceipt({ ...base, domestic: true });
assert.equal(household.vatRate, 0.1, "households keep the bill's rate");
console.log("business vat default ok");
