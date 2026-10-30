import assert from "node:assert/strict";
import { parseAreraCapacityText } from "../app/lib/regulatory-refresh/arera-capacity.ts";
import { extractTernaTideTotal } from "../app/lib/foundation/terna-electricity-regulatory.ts";

// Tony (28/10): the refresh reported "2026-10:ARERA_CAPACITY_MONTH_NOT_FOUND". 338/2026 names the quarterly PD element
// ("corrispettivo mercato capacità ... 0,6193 c€/kWh") in its premises before art. 4.1: every mention is read.
const compact = ("DELIBERAZIONE29settembre2026338/2026/R/eel RITENUTONECESSARIO aggiornareilcorrispettivomercatocapacità,ponendolopariа0,6193c€/kWh" + "x".repeat(2000)
  + "4.1Ivaloridelcorrispettivodicapacitàdicuiaicommi34.8,41.9e48.9delTIVsono:a)0,3423c€/kWhperilmesediottobre2026;b)0,3423c€/kWhperilmesedinovembre2026;c)0,9243c€/kWhperilmesedidicembre2026").replace(/\s+/g, "");
const parsed = parseAreraCapacityText(compact);
assert.deepEqual(parsed.months, [{ month: "2026-10", centsPerKwh: 0.3423 }, { month: "2026-11", centsPerKwh: 0.3423 }, { month: "2026-12", centsPerKwh: 0.9243 }]);
assert.equal(parsed.publicationDate, "2026-09-29");
console.log("ARERA_CAPACITY_ART_4_1_AFTER_PREMISES=PASS");

// "2026Q4:TERNA_TIDE_VALUE_NOT_FOUND": a quarter printed with six decimals is read like one printed with seven (invented values).
assert.equal(extractTernaTideTotal("Uplift 0,412345 Unità essenziali 0,301234 Totale 1,102345 c€/kWh"), 1.102345);
assert.equal(extractTernaTideTotal("Uplift 0,4123456 Totale 1,0501000"), 1.0501);
console.log("TERNA_TIDE_SIX_DECIMALS=PASS");
// Tony (30/10): October 2026 still not found. The text layer may give "c€" as "cEUR" or drop the euro sign.
assert.deepEqual(parseAreraCapacityText("Ilvaloredelcorrispettivocapacitàèparia:a)0,3423cEUR/kWhperilmesediottobre2026;b)0,3423c/kWhperilmesedinovembre2026").months, [{ month: "2026-10", centsPerKwh: 0.3423 }, { month: "2026-11", centsPerKwh: 0.3423 }]);
assert.throws(() => extractTernaTideTotal("Documento 2026 con 1,5 e 2,25"), /TERNA_TIDE_VALUE_NOT_FOUND:len=\d+:1,5 2,25/);
console.log("ARERA_CAPACITY_EURO_SIGN=PASS");
