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

// Tony (31/10): "dovresti raggruppare per fisse e variabili e sotto le voci arin, asos, ac3, ac6".
assert.match(flow, /Rete e oneri ARERA · quote fisse/);
assert.match(flow, /Rete e oneri ARERA · quote variabili/);
assert.match(flow, /\["NETWORK", "METERING", "TRANSMISSION", "UC3", "UC6", "ARIM", "ASOS"\]/);
console.log("QUICK_QUOTE_COST_GROUPS=PASS");

// Tony (31/10, fattura di dettaglio BPower: "cazzo ancora errori"): band prices equal to the PUN of the band plus one amount
// make the bill indexed, and what the detailed invoice does not print is said so, not "Non indicata".
assert.match(flow, /function indexedFromPrices/);
assert.match(flow, /Indicizzato \$\{index\} \(ricavato dai prezzi in bolletta\)/);
assert.match(flow, /la fattura di dettaglio non ha il box dell'offerta/);
console.log("QUICK_QUOTE_DETAILED_INVOICE=PASS");
