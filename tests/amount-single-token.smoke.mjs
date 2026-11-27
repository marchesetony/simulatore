import assert from "node:assert/strict";
import { amountToken } from "../app/lib/foundation/amount-token.ts";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";

// Tony (1/11, "lette 8.290.000.923.000.068,00 € su 333,96 €": "incomprensibile quello che hai scritto, errore"). An amount is one
// number: several numbers in the text are never glued together.
assert.equal(amountToken("8,29 €"), "8,29");
assert.equal(amountToken("1.234,56 €"), "1.234,56");
assert.equal(amountToken("0,000923 €/kWh × 68 kWh = 8,29 €"), "8,29");
assert.equal(amountToken("0,000923 0,068"), null, "no money amount: nothing invented");
assert.equal(amountToken("F1 120,50 €"), "120,50", "the digit of F1 is not a number");
assert.equal(amountToken("22%"), "22%");
const analysis = buildCurrentBillEconomicAnalysis([
  { lineId: "a", description: "Quota energia", amount: "300,00", classification: "ENERGY_INDEX" },
  { lineId: "b", description: "Altre partite", amount: "8,29 0,000923 0,068 €", classification: "ALTRE_PARTITE" },
], "308,29");
assert.ok(analysis.totals.reconstructedCurrentSupplyTotal < 1000, String(analysis.totals.reconstructedCurrentSupplyTotal));
console.log("amount single token ok");
import { readFileSync } from "node:fs";
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /> Math\.max\(1000, Math\.abs\(totals\.billTotal\) \* 5\)\) return " \(una voce della bolletta è stata letta male/);
console.log("impossible gap hidden ok");
