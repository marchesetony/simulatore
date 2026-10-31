import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Tony (31/10): "inserire un campo ricerca, e elencare in ordine alfabetico crescente"; the ARERA note must say how bill and
// simulation each stand against ARERA, not the gap between the two columns; "devo vedere anche la data in cui scade il
// contratto che è scritto in fattura".
const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
assert.match(flow, /type="search"[^>]*value=\{billQuery\}/);
assert.match(flow, /billChoices\(archive, billQuery\)\.map/);
assert.match(flow, /localeCompare\(b\.title, "it"/);
assert.match(flow, /Valori ARERA del periodo \{EURO\.format\(arera\)\}: la bolletta addebita/);
assert.doesNotMatch(flow, /La bolletta non corrisponde ai valori ARERA \(\{EURO/);
assert.match(flow, /\["Scadenza contratto", billExpiry\(bill\)/);
console.log("QUICK_QUOTE_BILL_SEARCH_EXPIRY=PASS");
