import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (29/10): "non si vede il nome dell'intestatario della bolletta, deve esserci". The bill summary shown before the
// offers starts with the holder's name read from the bill.
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
const summary = flow.slice(flow.indexOf("function BillSummary"), flow.indexOf("function offersFrom"));
assert.match(summary, /\["Intestatario", bill\.fields\.customerName\?\.value/);
assert.ok(summary.indexOf("\"Intestatario\"") < summary.indexOf("\"Tipo fornitura\""));
console.log("quote bill summary holder ok");

// Tony (29/10, "la cte di questa è la BE SMILE ma non la vedo"): with offers shown, the CTEs left out still say why.
assert.match(flow, /<NoOfferReasons quote=\{quote\} shown=\{quote\.offers\.map/);
assert.match(flow, /CTE non utilizzabili per questa bolletta/);
console.log("excluded CTE reasons shown with offers ok");
