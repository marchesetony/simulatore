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

assert.equal(estimateBillSpread(bill([line("Energia F1", "0,1350", 600)]), ["2026-10"], [record], official).status, "PUN_MISSING");
assert.equal(estimateBillSpread(bill([line("Trasporto", "0,01", 1000)]), ["2026-09"], [record], official).status, "PRICE_MISSING");
assert.equal(estimateBillSpread({ ...bill([]), vector: found("GAS"), f1Consumption: missing }, ["2026-09"], [record], official), null);
console.log("BILL_CURRENT_SPREAD=PASS");
