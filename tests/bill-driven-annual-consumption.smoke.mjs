import assert from "node:assert/strict";
import { annualConsumptionOf } from "../app/lib/calculation/bill-driven.ts";

// CTE candidates are chosen on the annual consumption; a bill without it gets the billed period averaged over a year.
const period = { periodStart: "2026-06-01", periodEnd: "2026-07-31" };
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: period, consumption: { annual: 17520, period: { f1: 1, f2: 1, f3: 1, smc: null } } }), 17520);
// Tony (29/10): "bisogna fare la media dei consumi che vengono menzionati in bolletta e moltiplicare per 12". Two months
// billed (1.131,12 kWh) are 565,56 kWh a month, 6.787 kWh a year (was 6.768 on days × 365).
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: period, consumption: { annual: null, period: { f1: 500, f2: 300, f3: 331.12, smc: null } } }), 6787);
// CAMELOT SRL: 52 kWh billed from 1 September to 1 October is one month, 624 kWh a year (was 612).
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: { periodStart: "2026-09-01", periodEnd: "2026-10-01" }, consumption: { annual: null, period: { f1: 21, f2: 15, f3: 16, smc: null } } }), 624);
// When the bill lists its months, their average is the monthly consumption.
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: period, consumption: { annual: null, period: { f1: 500, f2: 300, f3: 300, smc: null }, monthlyProfile: [{ month: "2026-06", f1: 300, f2: 100, f3: 100 }, { month: "2026-07", f1: 200, f2: 200, f3: 200 }] } }), 6600);
// Bimonthly bill: two months.
assert.equal(annualConsumptionOf({ vector: "GAS", billingPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-31" }, consumption: { annual: null, period: { f1: null, f2: null, f3: null, smc: 100 } } }), 600);
assert.equal(annualConsumptionOf({ vector: "GAS", billingPeriod: { periodStart: "2026-09-01", periodEnd: "2026-09-05" }, consumption: { annual: null, period: { f1: null, f2: null, f3: null, smc: 40 } } }), null);
console.log("bill-driven annual consumption: ok");

// Tony (30/10): "bisogna usare lo storico consumi". The history printed on the bill (latest 12 months, 40..51 kWh,
// average 45,5) sets the annual consumption at 546 kWh; the older month (999) is left out.
const history = [{ month: "2025-09", quantity: 999 }, ...Array.from({ length: 12 }, (_, index) => ({ month: `${index < 3 ? 2025 : 2026}-${String(((index + 9) % 12) + 1).padStart(2, "0")}`, quantity: 40 + index }))];
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: { periodStart: "2026-09-01", periodEnd: "2026-10-01" }, consumption: { annual: null, period: { f1: 21, f2: 15, f3: 16, smc: null }, history } }), 546);
// A printed annual consumption still comes first.
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: period, consumption: { annual: 17520, period: { f1: 1, f2: 1, f3: 1, smc: null }, history } }), 17520);

const { normalizeConsumptionHistory } = await import("../app/lib/ingestion/consumption-history.ts");
assert.deepEqual(normalizeConsumptionHistory([{ month: "2026-02", quantity: 10 }, { month: "2026-01", quantity: 5 }, { month: "2026-02", quantity: 99 }]), [{ month: "2026-01", quantity: 5 }, { month: "2026-02", quantity: 10 }]);
assert.throws(() => normalizeConsumptionHistory([{ month: "2026-13", quantity: 1 }]), /CONSUMPTION_HISTORY_INVALID/);

// The reading asks the AI for the history and keeps it on the bill.
const { ANALYST_STAGE_PROMPT, ANALYST_WIRE_SCHEMA } = await import("../app/lib/ingestion/bill-two-stage.ts");
assert.match(ANALYST_STAGE_PROMPT, /storico dei consumi/);
assert.ok(ANALYST_WIRE_SCHEMA.properties.consumptionHistory);
console.log("consumption history ok");
