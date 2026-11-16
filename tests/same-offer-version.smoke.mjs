import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSameOffer } from "../app/lib/quote/same-offer.ts";

// Tony (31/10, BPower): "come fa a costare meno con la stessa cte?". Then, the same day, with the two bills side by side
// (MACRI on 003888ESVFL01 with dispacciamento + capacità + commercializzazione + sbilanciamento in the Box; Montevarchi on
// 003888ESVFL02 with PUN + 0,02 + CDISPD), Tony chose "Versioni diverse": a CTE with another version number is another CTE.
const base = { billSupplier: "BPower Energia S.p.A.", billOffer: "003888ESVFL01XXXXXXXCASAPROTETTA", offerSupplier: "BPower Energia S.p.A." };
assert.equal(isSameOffer({ ...base, offerCode: "003888ESVFL02XXXXXXXCASAPROTETTA", offerName: "BE Family CASA PROTETTA" }), false, "other version, other CTE");
assert.equal(isSameOffer({ ...base, offerCode: "003888ESVFL01XXXXXXXCASAPROTETTA", offerName: "BE Family CASA PROTETTA" }), true, "same code, same CTE");
assert.equal(isSameOffer({ ...base, billOffer: "003888ESVFL02XXXXXXXCASAPROTETTA", offerCode: "003888ESVFL02XXXXXXXCASAPROTETTA", offerName: "BE Family CASA PROTETTA" }), true, "Montevarchi bill and its CTE");
assert.equal(isSameOffer({ ...base, offerCode: null, offerName: "BE Family CASA PROTETTA" }), true, "matched on the commercial name");
assert.equal(isSameOffer({ ...base, offerCode: "003888ESVFL03XXXXXXXXXSMILFLEX26", offerName: "SMILE FLEX 26" }), false, "another BPower offer");
assert.equal(isSameOffer({ ...base, offerSupplier: "Duferco Energia SpA", offerCode: "003888ESVFL02XXXXXXXCASAPROTETTA", offerName: "BE Family CASA PROTETTA" }), false, "another supplier");
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
// Tony (16/11/2026): the same-CTE headline speaks of a recalculation gap, never by itself of an overcharge.
assert.match(flow, /const headline = same \? sameCteHeadline\(receipt\.savingsPercent\)/);
assert.match(flow, /annualSaving !== null && basis && !same/);
// Cost detail: yearly POD fee as months and monthly amount; the footer is the sum of every line.
assert.match(flow, /€\/mese \(\$\{CENTS\.format\(rate\)\} €\/POD all'anno\)/);
// Tony (16/11/2026): the footer is a subtotal that leaves out reactive energy and taxes.
assert.match(flow, /Subtotale nuova offerta: vendita, rete e oneri \(esclusi energia reattiva e imposte\)/);
console.log("same offer version ok");
