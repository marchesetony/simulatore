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

// Tony (1/11, "il risparmio sulla bolletta risulta maggiore di quello annuo cosi come la percentuale"): with a heavy month
// (2.642 kWh of 6.034 a year) and a higher PCV (15,00 against 13,50 €/mese) the annual saving is lower than the bill's,
// and the card says why.
{
  const bill = 7.53; const months = 1; const vat = 1.22;
  const annual = annualSaving({ savings: bill, currentTotal: 1121.85, billFixed: 13.5 * months, offerFixed: 15 * months, oneOff: 0, vat, months, factor: 6034 / 2642 });
  assert.ok(annual.saving < bill, "the year has 12 PCVs but only 2,28 bills' worth of consumption");
  const { readFileSync } = await import("node:fs");
  const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /Il risparmio annuo è più basso di quello sulla bolletta perché/);
  console.log("ANNUAL_GAP_NOTE=PASS");
}
