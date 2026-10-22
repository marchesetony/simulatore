import assert from "node:assert/strict";
import { annualConsumptionOf } from "../app/lib/calculation/bill-driven.ts";

// CTE candidates are chosen on the annual consumption; a bill without it gets the billed period averaged over a year.
const period = { periodStart: "2026-06-01", periodEnd: "2026-07-31" };
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: period, consumption: { annual: 17520, period: { f1: 1, f2: 1, f3: 1, smc: null } } }), 17520);
assert.equal(annualConsumptionOf({ vector: "EE", billingPeriod: period, consumption: { annual: null, period: { f1: 500, f2: 300, f3: 331.12, smc: null } } }), 6768);
assert.equal(annualConsumptionOf({ vector: "GAS", billingPeriod: { periodStart: "2026-09-01", periodEnd: "2026-09-05" }, consumption: { annual: null, period: { f1: null, f2: null, f3: null, smc: 40 } } }), null);
console.log("bill-driven annual consumption: ok");
