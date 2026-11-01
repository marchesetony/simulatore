import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (1/11, screenshot of the offers grid with "Più cara 1%"): "bisogna mostrare solo le più vantaggiose non quelle più
// care, tranne se scelte con motivazione". Offers costing more than the bill are hidden from the grid and listed apart; one
// shows only after the agent writes the reason. The bill's own CTE (billing check) and a CTE authorized with a reason stay.
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /function costlierThanBill\(offer: Offer, context: Context, bill: BillDocumentModel\): boolean \{/);
assert.match(flow, /savingsPercent === null \|\| offer\.receipt\.savingsPercent >= 0\) return false;/);
assert.match(flow, /finalStatus === "ELIGIBLE_BY_OVERRIDE"\) return false;/);
assert.match(flow, /!costlierThanBill\(offer, quote\.context, quote\.bill\) \|\| chosen\[offer\.calculation\.calculationId\] !== undefined/);
assert.match(flow, /\{visibleOffers\.length \? <div className="quote-offers">\{visibleOffers\.map\(/);
assert.doesNotMatch(flow, /quote\.offers\.map\(\(offer, index\) =>/, "the grid never lists every offer");
assert.match(flow, /Offerte più care della bolletta \(\{hiddenOffers\.length\}\)/);
assert.match(flow, /disabled=\{!reason\.trim\(\)\} onClick=\{\(\) => onChoose\(reason\.trim\(\)\)\}/, "no reason, no offer");
assert.match(flow, /Scelta con motivazione: /);
console.log("costlier offers hidden ok");
