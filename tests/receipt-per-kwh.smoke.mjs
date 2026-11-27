import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (1/11, "mancano i kwh sulla quale si calcola il costo, serve anche il costo per kwh"): the scontrino states the kWh of
// the period (same for both columns) and the cost per kWh of every line priced per kWh.
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
// Tony (1/11, "il consumo sullo scontrino è al netto delle perdite, ma il costo per kwh è comprensivo di perdite"): the caption
// says the kWh are net of losses and the €/kWh include them (electricity only).
assert.match(flow, /per entrambe le colonne\$\{context\.vector === "EE" \? ", al netto delle perdite; i prezzi per kWh comprendono le perdite" : ""\}` : "stessi consumi per entrambe le colonne"/, "caption carries the kWh of the period");
assert.match(flow, /item\.unitBasis \? perUnit\("ENERGY", item\.unitBasis\.offer\)/, "energy comparison shows the CTE €/kWh");
assert.match(flow, /PER_UNIT_KEYS = new Set\(\["ENERGY"[^\n]*"IMBALANCE", "CONSUMPTION"\]\)/, "per-kWh lines");
assert.match(flow, /\{euro\(item\.current\)\}\{perUnit\(item\.key, item\.current\)\}/);
assert.match(flow, /\{euro\(item\.offer\)\}\{perUnit\(item\.key, item\.offer\)\}/);
assert.match(flow, /UNIT_PRICE\.format\(amount \/ periodQuantity\)/, "cost per kWh = amount / kWh of the period");
console.log("RECEIPT_PER_KWH=PASS");
