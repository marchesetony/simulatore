import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatKwh } from "../app/lib/ui/format.ts";
import { offerScontrino } from "../app/lib/quote/offer-scontrino.ts";

// Tony (11/11/2026, "visualizzazione consumi"): every consumption in kWh is shown without decimals, mathematically rounded;
// the data and the calculations keep the full value and no total is rebuilt from rounded values. Prices per unit keep their
// precision, amounts in euro two decimals. Synthetic values only.

assert.deepEqual([2672.07, 1791.02, 354.44, 526.62, 29306, 0.5, 1790.5].map(formatKwh), ["2.672 kWh", "1.791 kWh", "354 kWh", "527 kWh", "29.306 kWh", "1 kWh", "1.791 kWh"]);

// Scontrino of the offer (screen and proposal PDF): the kWh rounded, the €/kWh and the amount from the exact quantity.
const q = (key, offer, offerSeller = null) => ({ key, label: key, basis: "", current: null, offer, difference: null, currentSeller: null, offerSeller, details: [] });
const lines = offerScontrino({ quotas: [q("CONSUMPTION", 889.98, 711.96), q("FIXED", 14.2, 10.39)], offerTotal: null, taxesIncluded: false, vector: "EE", quantity: 2672.07, months: 1, powerKw: null });
const consumption = lines.find((line) => line.kind === "main");
assert.equal(consumption.quantity, "2.672 kWh");
assert.equal(consumption.price, "0,333068 €/kWh", "889,98 € ÷ 2.672,07 kWh, not ÷ 2.672");
assert.equal(consumption.amount, 889.98);
assert.equal(lines.find((line) => line.kind === "main" && /mes/.test(line.quantity ?? "")).price, "14,20 €/mese", "€/mese keeps its precision (2 to 4 decimals)");
// Gas keeps its Smc as before.
assert.equal(offerScontrino({ quotas: [q("CONSUMPTION", 120, 80)], offerTotal: null, taxesIncluded: false, vector: "GAS", quantity: 120.25, months: 1, powerKw: null }).find((line) => line.kind === "main").quantity, "120,25 Smc");

// Every screen that shows kWh uses the same format; the values passed are the exact ones.
const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
assert.match(flow, /const kwh = \(value: unknown\) => \{ const n = num\(value\); return n === null \? "—" : formatKwh\(n\); \};/, "kWh of each calculated line");
assert.match(flow, /unit === "EUR_PER_KWH" \? formatKwh\(quantity\)/, "kWh of the generic calculated lines");
assert.match(flow, /formatKwh\(\[period\.f1, period\.f2, period\.f3\]\[index\] \?\? 0\)/, "F1, F2, F3 of the comparison");
assert.match(flow, /: formatKwh\(periodQuantity\)\}/, "the period total, rounded from the exact sum");
assert.match(flow, /const periodQuantity = .*\(period\.f1 \?\? 0\) \+ \(period\.f2 \?\? 0\) \+ \(period\.f3 \?\? 0\);/, "the sum is made on the exact values");
// Tony (12/11/2026, "CONSUMO ANNUO STIMATO"): the reason shows the declared or the labelled estimate, whole kWh (quantityText).
assert.match(flow, /annualConsumptionLine\(annual, quote\.context\.vector === "EE" \? "kWh" : "Smc"\)/, "annual consumption in the CTE exclusion reason");
const panel = await readFile("app/components/BillOperationalPanel.tsx", "utf8");
assert.match(panel, /if \(unit === "kWh" && typeof field\.value === "number" && fieldValue\(field\)\) return \[\{ label, value: <>\{formatKwh\(field\.value\)/, "Bollette › consumi");
assert.match(panel, /"Non determinabile" : formatKwh\(review\.consumption\.billed\.value\)/);
assert.match(panel, /"Da verificare" : formatKwh\(consumption\)/);
const simulation = await readFile("app/components/BillDrivenSimulationPanel.tsx", "utf8");
for (const field of ["period.f1", "period.f2", "period.f3", "annual"]) assert.match(simulation, new RegExp(`formatKwh\\(context\\.consumption\\.${field.replace(".", "\\.")}\\)`), field);

console.log("kwh display OK");
