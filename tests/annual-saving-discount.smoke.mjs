import assert from "node:assert/strict";
import { annualSaving, annualSavingUnderDiscount } from "../app/lib/quote/annual-saving.ts";

// Tony (1/11, "come scrivi risparmio e sotto costo in più sulla be smile flex che in ogni caso costa più della azienda
// protetta"): the discounted Be Smile FLEX card showed "Risparmio 1%" and "Costo in più annuo 25,37 €". Synthetic numbers:
// one-month bill of 1.121,85 €, quote discounted to 1% under it, PCV 18 €/mese against the bill's 13,50 €/mese.
const projected = annualSaving({ savings: 11.22, currentTotal: 1121.85, billFixed: 13.5, offerFixed: 18, oneOff: 0, vat: 1.22, months: 1, factor: 0.5 });
assert.ok(projected.saving < 0, "without the rule the fixed fee turns the saving into a cost");
const fixed = annualSavingUnderDiscount(projected, true, 1);
assert.ok(fixed.saving > 0, "a discounted quote never shows a cost in più next to its saving");
assert.equal(fixed.saving, Math.round(projected.current * 1) / 100);
assert.deepEqual(annualSavingUnderDiscount(projected, false, 1), projected, "a quote without the discount keeps its own projection");
console.log("ANNUAL_SAVING_DISCOUNT=PASS");
