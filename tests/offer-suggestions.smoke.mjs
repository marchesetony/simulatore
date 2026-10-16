import assert from "node:assert/strict";

import { SUGGESTION_MAX_OFFERS, suggestOffers } from "../app/lib/comparison/suggestions.ts";

const money = (minorUnits) => ({ amount: minorUnits / 100, minorUnits, currency: "EUR" });
function offers(totals, baseline = null) {
  const results = totals.map((total, index) => ({ calculationId: `calc_${index}`, totalCommercialCost: money(total), savingsVsBaseline: baseline === null ? null : money(baseline - total) }));
  let rank = 0; let previous = null;
  const ranking = results.map((result, index) => { if (previous !== result.totalCommercialCost.minorUnits) rank = index + 1; previous = result.totalCommercialCost.minorUnits; return { rank, tieGroup: `tie-${rank}`, calculationId: result.calculationId, supplier: `S${index}`, offerCode: `O${index}`, cteVersion: "1", totalCommercialCost: result.totalCommercialCost }; });
  return { results, ranking };
}

// No eligible offers: nothing to suggest.
assert.deepEqual(suggestOffers([], []), []);

// One clear winner: only the best is suggested.
{ const { results, ranking } = offers([10000, 11000, 12000], 13000); const suggested = suggestOffers(results, ranking);
  assert.equal(suggested.length, 1); assert.equal(suggested[0].reason, "BEST"); assert.equal(suggested[0].savingsVsBaseline.amount, 30); assert.equal(suggested[0].differenceFromBest.minorUnits, 0); }

// Offers within 3% of the best are proposed together for the operator to choose; 3% boundary is inclusive.
{ const { results, ranking } = offers([10000, 10150, 10300, 10301]); const suggested = suggestOffers(results, ranking);
  assert.deepEqual(suggested.map((item) => item.calculationId), ["calc_0", "calc_1", "calc_2"]);
  assert.deepEqual(suggested.map((item) => item.reason), ["BEST", "WITHIN_TOLERANCE", "WITHIN_TOLERANCE"]);
  assert.equal(suggested[2].differenceFromBest.amount, 3); assert.equal(suggested[0].savingsVsBaseline, null); }

// Ties share the BEST reason; the list is capped.
{ const { results, ranking } = offers([10000, 10000, 10010, 10020, 10030]); const suggested = suggestOffers(results, ranking);
  assert.equal(suggested.length, SUGGESTION_MAX_OFFERS); assert.deepEqual(suggested.map((item) => item.reason), ["BEST", "BEST", "WITHIN_TOLERANCE"]); }

console.log("offer-suggestions smoke passed");
