import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
assert.match(panel, /label: "Fattura precedente insoluta", value: amount === null \? "Da verificare" : formatEuro\(amount\)/);
assert.match(panel, /"Inferiore al riferimento ARERA"/);
assert.match(panel, /"Conforme al riferimento ARERA"/);
assert.doesNotMatch(panel, /label: "Fattura precedente insoluta", value: fieldValue\(review\.receipt\.priorBalance\)/);

console.log("PRIOR_INVOICE_EURO_SYMBOL_VISIBLE=OK");
console.log("DISPATCHING_ARERA_LABEL_VISIBLE=OK");
console.log("CAPACITY_ARERA_LABEL_PRESERVED=OK");
console.log("bill final label fixes smoke: ok");
