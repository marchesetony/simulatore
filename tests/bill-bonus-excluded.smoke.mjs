import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (31/10, bolletta BPower settembre 2026 con "Bonus sociale disagio economico -12,00 €"): "il bonus non va considerato".
// The bill's IVA (15,31 € on 153,11 €) was charged after the bonus; the comparison uses the IVA on the supply alone.
const line = (description, amount, code = null, unit = "", quantity = "", unitPrice = "") => ({ code, description, amount, quantity, unitPrice, unit, period: null });
const analysis = buildCurrentBillEconomicAnalysis([
  line("Energia Attiva F1", "100,00", "SELLER_ENERGY_FEE", "€/kWh", "400", "0,25"),
  line("Bonus sociale disagio economico", "-12,00", "BONUS"),
  line("Imposte erariali", "8,85", "EXCISE"),
  line("IVA 10%", "9,69", "VAT"),
], null);
const bonus = analysis.components.filter((item) => item.classification === "BONUS");
assert.equal(bonus.length, 1, "the bonus is read as a bonus");
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 100, analysis, domestic: true, validUntil: null, offerComponents: [] });
const taxes = receipt.rows.find((row) => row.key === "TAXES");
assert.equal(taxes.current, 19.74, "8,85 + 9,69 + IVA 10% on the 12,00 € bonus");
assert.equal(receipt.currentTotal, 119.74, "no bonus in the current spend");
assert.equal(receipt.savings, 0, "same supply cost, same total: the bonus moves nothing");
console.log("bill bonus excluded ok");
