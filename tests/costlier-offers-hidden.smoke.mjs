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
// Tony (1/11, "azienda protetta deve costare più di bsmart, ha uno spread più alto"): the offers are checked against each
// other, and the company admin sees a CTE with a higher spread and PCV that costs less than another of the same supplier.
assert.match(flow, /function incoherentOffers\(offers: readonly Offer\[\]\): readonly string\[\] \{/);
// Tony (1/11, "non è possibile devi verificare"): the spread alone flagged Azienda Protetta against Be Smile 11.25, which adds
// commercializzazione, sbilanciamento and capacity libero. The check compares the whole seller spend, since the regulated
// items are the same for every offer.
assert.match(flow, /if \(sa > sb \+ 0\.5 && ta < tb - 0\.5\) issues\.push/);
assert.doesNotMatch(flow, /a\.spread > b\.spread/);
assert.match(flow, /\{showExcluded && incoherentOffers\(quote\.offers\)\.length \? <div className="quote-check open" role="alert">/);
console.log("offer coherence check ok");
