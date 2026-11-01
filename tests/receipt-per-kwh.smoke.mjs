import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (1/11, "mancano i kwh sulla quale si calcola il costo, serve anche il costo per kwh"): the scontrino states the kWh of
// the period (same for both columns) and the cost per kWh of every line priced per kWh.
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /per entrambe le colonne` : "stessi consumi per entrambe le colonne"/, "caption carries the kWh of the period");
assert.match(flow, /PER_UNIT_KEYS = new Set\(\["ENERGY"[^\n]*"IMBALANCE", "CONSUMPTION"\]\)/, "per-kWh lines");
assert.match(flow, /\{euro\(item\.current\)\}\{perUnit\(item\.key, item\.current\)\}/);
assert.match(flow, /\{euro\(item\.offer\)\}\{perUnit\(item\.key, item\.offer\)\}/);
assert.match(flow, /UNIT_PRICE\.format\(amount \/ periodQuantity\)/, "cost per kWh = amount / kWh of the period");
console.log("RECEIPT_PER_KWH=PASS");
