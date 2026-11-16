import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt, reconcileSellerFixed, sameCteHeadline, sameOfferDifferences } from "../app/lib/quote/receipt.ts";

// Tony (16/11/2026, "Correzione definitiva riconciliazione scontrino"), bill BPower 070789E (CINE ART, October 2026) on its
// own CTE Be Smile FLEX 25: the bill prints one quota fissa di vendita of 18,00 € (quota business 15,00 + Opzione Flex 3,00),
// the energy price bundles the charges the CTE lists apart, and the gap is a recalculation gap within tolerance. Real engine
// result and bill lines, no customer data. Only the presentation changes: totals and formulas stay as they are.
const engine = JSON.parse(readFileSync(new URL("./fixtures/receipt-070789E-engine-result.json", import.meta.url), "utf8"));
const { lines } = JSON.parse(readFileSync(new URL("./fixtures/receipt-070789E-bill-lines.json", import.meta.url), "utf8"));
const analysis = buildCurrentBillEconomicAnalysis(lines.map((l) => ({ code: l.code, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount, period: l.periodRaw, rawDescription: l.rawDescription, status: l.status, documentEvidence: l.documentEvidence })), 205.03, { billingPeriodStart: "2026-10-01" });
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: engine.totalCommercialCost, analysis, domestic: false, validUntil: null,
  offerComponents: engine.components.map((c) => ({ category: c.category, sign: c.sign, label: c.label, formulaId: c.formulaId, amount: { amount: c.amount }, formulaInputs: c.formulaInputs })), warnings: engine.warnings });

// Economic results preserved: bill 205,03, simulation 203,98, gap −1,05 (−0,51%), reactive energy 5,48 on both sides.
assert.equal(receipt.status, "COMPLETE");
assert.equal(receipt.currentTotal, 205.03);
assert.equal(receipt.offerTotal, 203.98);
assert.equal(receipt.savings, 1.05);
assert.equal(receipt.savingsPercent, 0.5, "shown with one decimal");
assert.equal(Math.round(receipt.savings / receipt.currentTotal * 10000) / 100, 0.51);
const row = (key) => receipt.rows.find((item) => item.key === key);
const detail = (rowKey, key) => row(rowKey).details.find((item) => item.key === key);
assert.deepEqual([detail("NETWORK", "REACTIVE").current, detail("NETWORK", "REACTIVE").offer], [5.48, 5.48]);
// Aggregate vendita kept: 121,75 against 120,89.
assert.deepEqual([row("ENERGY").current, row("ENERGY").offer, row("ENERGY").difference], [121.75, 120.89, -0.86]);
// Subtotal of the engine (vendita + rete e oneri) is 158,07; with reactive energy and taxes the scontrino reaches 203,98.
assert.equal(engine.totalCommercialPlusRegulatedSubsetCost, 158.07);
assert.equal(Math.round((158.07 + 5.48 + row("TAXES").offer) * 100) / 100, 203.98, "subtotal and final total agree");

// PCV and Flex: business 15,00 and Flex 3,00 recognized in the bill's 18,00, total 18,00 against 18,00, no false gap.
const pcv = detail("ENERGY", "PCV"); const flex = detail("ENERGY", "OPTIONS"); const fixed = detail("ENERGY", "SELLER_FIXED_TOTAL");
assert.deepEqual([pcv.current, pcv.offer, pcv.difference], [15, 15, 0]);
assert.deepEqual([flex.current, flex.offer, flex.difference], [3, 3, 0]);
assert.deepEqual([fixed.current, fixed.offer, fixed.difference], [18, 18, 0]);
assert.match(pcv.currentDerived, /ripartizione dei 18,00 € di quota fissa di vendita/, "a split, never shown as a read value");
// A bill quota that is not the sum stays a difference.
const unmatched = reconcileSellerFixed([{ key: "PCV", label: "PCV", current: 20, offer: 15, difference: 5 }, { key: "OPTIONS", label: "Flex", current: null, offer: 3, difference: 3 }]);
assert.equal(unmatched.some((item) => item.key === "SELLER_FIXED_TOTAL"), false);
assert.equal(unmatched[0].current, 20);

// Energy on homogeneous bases: the bundled energy line has no gap of its own; the comparison line carries −0,86.
assert.equal(detail("ENERGY", "ENERGY").difference, null);
assert.equal(detail("ENERGY", "ENERGY_COMPARISON").difference, -0.86);
const differences = sameOfferDifferences(receipt);
assert.equal(differences.filter((item) => !item.accepted && !item.consequence).length, 0, JSON.stringify(differences));
assert.ok(!differences.some((item) => /PCV|Opzioni|Prezzo energia/.test(item.label)), "no false gap on PCV, Flex or the bundled energy line");
assert.ok(differences.some((item) => item.accepted && /Confronto energia/.test(item.label) && item.difference === -0.86));

// Same CTE within the internal 1% tolerance; beyond it, a gap to check, never "billed more than due" by itself.
assert.equal(sameCteHeadline(receipt.savingsPercent), "Stessa CTE — scostamento di ricalcolo entro tolleranza");
assert.doesNotMatch(sameCteHeadline(5.5), /addebita|più del dovuto/);
assert.doesNotMatch(sameCteHeadline(null), /entro tolleranza/);
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /Subtotale nuova offerta: vendita, rete e oneri \(esclusi energia reattiva e imposte\)/);
assert.match(flow, /const headline = same \? sameCteHeadline\(receipt\.savingsPercent\)/);
assert.doesNotMatch(flow, /la bolletta addebita più di quanto prevede la CTE/);
const pdf = readFileSync(new URL("../app/lib/export/receipt-pdf.ts", import.meta.url), "utf8");
assert.doesNotMatch(pdf, /in più di quanto prevede la CTE/);
console.log("receipt reconciliation 070789E ok");
