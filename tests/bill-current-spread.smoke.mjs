import assert from "node:assert/strict";

import { estimateBillSpread } from "../app/lib/market/bill-spread.ts";

// The spread is never printed on the bill: applied energy price minus the official GME PUN of the same month.
const found = (value) => ({ value, status: "FOUND" });
const missing = { value: null, status: "NOT_FOUND" };
const line = (description, unitPrice, quantity) => ({ code: "UNKNOWN", description, quantity: String(quantity), unit: "€/kWh", unitPrice, amount: "", periodRaw: "", status: "FOUND" });
const bill = (lines, facts = []) => ({ vector: found("EE"), f1Consumption: found(600), f2Consumption: found(300), f3Consumption: found(100), extendedFacts: facts, economicChargeLines: lines });
const record = { status: "APPROVED", vector: "EE", index: "PUN", month: "2026-09", updatedAt: "2026-10-02T00:00:00Z", record: { vector: "EE", index: "PUN", f1: { value: 120 }, f2: { value: 110 }, f3: { value: 100 }, monthly: { value: 114 } } };
const official = () => true;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

const bands = estimateBillSpread(bill([line("Energia F1", "0,1350", 600), line("Energia F2", "0,1250", 300), line("Energia F3", "0,1150", 100), line("Trasporto e gestione contatore", "0,0100", 1000)]), ["2026-09"], [record], official);
assert.equal(bands.status, "CALCULATED");
assert.equal(bands.structure, "F1_F2_F3");
close(bands.spread, 0.015);
assert.deepEqual(bands.lines.map((item) => item.band), ["F1", "F2", "F3"]);

const biorario = estimateBillSpread(bill([line("Prezzo energia F1", "0,1400", 600), line("Prezzo energia F23", "0,1250", 400)]), ["2026-09"], [record], official);
assert.equal(biorario.structure, "F1_F23");
close(biorario.lines[1].officialPun, (0.110 * 300 + 0.100 * 100) / 400);
close(biorario.lines[0].spread, 0.02);

const mono = estimateBillSpread(bill([], [{ code: "MONORARIO_PRICE", value: "0,1290 €/kWh", status: "FOUND" }]), ["2026-09"], [record], official);
assert.equal(mono.structure, "MONO");
close(mono.spread, 0.015);

assert.equal(estimateBillSpread(bill([line("Energia F1", "0,1350", 600)]), ["2026-10"], [record], official, "2026-11-20").status, "PUN_MISSING");
assert.equal(estimateBillSpread(bill([line("Trasporto", "0,01", 1000)]), ["2026-09"], [record], official).status, "PRICE_MISSING");
assert.equal(estimateBillSpread({ ...bill([]), vector: found("GAS"), f1Consumption: missing }, ["2026-09"], [record], official), null);
console.log("BILL_CURRENT_SPREAD=PASS");
// September's official PUN is published by 10 October; months older than five are no longer archived.
const sept = bill([line("Energia F1", "0,1350", 600)]);
assert.deepEqual([estimateBillSpread(sept, ["2026-09"], [], official, "2026-10-05").status, estimateBillSpread(sept, ["2026-09"], [], official, "2026-10-05").publishedBy], ["PUN_NOT_PUBLISHED", "2026-10-10"]);
assert.equal(estimateBillSpread(sept, ["2026-09"], [], official, "2026-10-20").status, "PUN_MISSING");
assert.equal(estimateBillSpread(sept, ["2026-03"], [], official, "2026-10-20").status, "PUN_EXPIRED");
console.log("BILL_SPREAD_PUN_TIMING=PASS");
// When the sale-of-energy table prints index and markup as separate rows, the spread is read from the bill.
const printed = estimateBillSpread(bill([{ ...line("PUN Index GME F1", "0,1200", 600), code: "PUN_F1" }, { ...line("Spread F1", "0,0180", 600), code: "SPREAD" }, line("Dispacciamento", "0,0090", 1000)]), ["2026-09"], [], official, "2026-10-20");
assert.equal(printed.status, "CALCULATED"); assert.equal(printed.source, "BILL"); close(printed.spread, 0.018);
console.log("BILL_PRINTED_SPREAD=PASS");
// HERA-style formula table: hourly PUN Index GME, consumption in F1/F2/F3, rows with the unit only in the header.
const row = (description, unitPrice) => ({ code: "UNKNOWN", description, quantity: "", unit: "", unitPrice, amount: "", periodRaw: "09/2026", status: "FOUND" });
const hera = { ...bill([row("Prezzo Netto", "+0,225353"), row("Contributo sui consumi", "+0,015900"), row("Dispacciamento fascia F1", "+0,011551"), row("Dispacciamento fascia F2", "+0,011551"), row("Dispacciamento fascia F3", "+0,011551"), row("Corrispettivo mercato capacità", "+0,003517"), row("Sbilanciamento", "+0,006000"), { ...row("Spesa per la vendita di energia", "0,265331"), quantity: "1658,683", amount: "440,10" }], [{ code: "PRICE_TIME_STRUCTURE_RAW", value: "Tipologia di prezzo: Orario", status: "FOUND" }, { code: "PRICE_F23", value: "0,2413", status: "FOUND" }]), f1Consumption: found(674.054), f2Consumption: found(399.716), f3Consumption: found(584.913) };
const hourly = estimateBillSpread(hera, ["2026-09"], [record], official);
assert.equal(hourly.status, "CALCULATED");
assert.equal(hourly.structure, "HOURLY");
const profile = (0.120 * 674.054 + 0.110 * 399.716 + 0.100 * 584.913) / 1658.683;
close(hourly.lines[0].billPrice, 0.225353 + 0.0159);
close(hourly.spread, 0.225353 + 0.0159 - profile);
assert.deepEqual(hourly.lines[0].components.map((item) => item.label), ["Prezzo Netto", "Contributo sui consumi"]);
console.log("BILL_HOURLY_FORMULA_TABLE=PASS");
