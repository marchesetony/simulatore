import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (30/10): "su questa bolletta ci sono queste voci che dovresti vedere accorpate anche nella versione sintetica.
// Quota variabile smart (CVS) Euro/kWh 0,025000 378,05 9,45 / Quota variabile voci di trasporto Euro/kWh 0,010000 378,05
// 3,78". Both are the seller's per-kWh charges: CVS was left out as an unclassified item, the second taken as ARERA transport.
const line = (description, amount, unit, quantity, unitPrice, code = null) => ({ code, description, amount, quantity, unitPrice, unit, period: null });
for (const code of [null, "NETWORK_ENERGY"]) {
  const bill = buildCurrentBillEconomicAnalysis([
    line("Energia F0", "80,00", "Euro/kWh", "378,05", "0,211613", "SELLER_ENERGY_FEE"),
    line("Quota variabile smart (CVS)", "9,45", "Euro/kWh", "378,05", "0,025000"),
    line("Quota variabile voci di trasporto", "3,78", "Euro/kWh", "378,05", "0,010000", code),
  ], null);
  assert.equal(bill.totals.sellerCommercializationTotal, 9.45);
  assert.equal(bill.totals.sellerOtherTotal, 3.78);
  assert.equal(bill.totals.regulatedNetworkTotal, null, `not ARERA transport (${code})`);
  const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 93.23, analysis: bill, domestic: true, validUntil: null, offerComponents: [] });
  assert.equal(receipt.rows.find((row) => row.key === "ENERGY").current, 93.23, "vendita 80,00 + 9,45 + 3,78");
}
console.log("BILL_SELLER_VARIABLE_QUOTAS=PASS");
