import assert from "node:assert/strict";

import { QUOTE_WINDOW_MONTHS, quoteWindowStart, supplyPeriodAdmission, supplyPeriodTooOld } from "../app/lib/calculation/quote-window.ts";

// Rule changed by Tony on 17/11/2026 (binding, "intero periodo"): the whole supply period must lie in the last five months.
// It replaces the 4-month window and the 2/11 rule that only looked at the end of the period.
assert.equal(QUOTE_WINDOW_MONTHS, 5);
assert.equal(quoteWindowStart("2026-11-17"), "2026-06-17");
assert.equal(quoteWindowStart("2026-02-15"), "2025-09-15", "crosses the year boundary");
assert.equal(quoteWindowStart("2026-07-31"), "2026-02-28", "clamps to the shorter month");
assert.equal(quoteWindowStart("2028-07-31"), "2028-02-29", "keeps leap days");
assert.equal(quoteWindowStart("2026-10-19", 4), "2026-06-19", "the month count is still a parameter");

const today = "2026-11-17";
const code = (period) => { const result = supplyPeriodAdmission(period, today); return result.admitted ? "ADMITTED" : result.code; };
// Monthly and bimonthly bills inside the window.
assert.equal(code({ periodStart: "2026-10-01", periodEnd: "2026-10-31" }), "ADMITTED", "monthly");
assert.equal(code({ periodStart: "2026-08-01", periodEnd: "2026-09-30" }), "ADMITTED", "bimonthly");
// Boundaries, both inclusive: first day of the window and today.
assert.equal(code({ periodStart: "2026-06-17", periodEnd: "2026-08-16" }), "ADMITTED", "starts on the first day of the window");
assert.equal(code({ periodStart: "2026-06-16", periodEnd: "2026-08-15" }), "SOURCE_BILL_TOO_OLD", "one day before the window");
assert.equal(code({ periodStart: "2026-10-18", periodEnd: "2026-11-17" }), "ADMITTED", "ends today");
assert.equal(code({ periodStart: "2026-10-19", periodEnd: "2026-11-18" }), "SOURCE_BILL_PERIOD_FUTURE", "ends tomorrow");
// A bimonthly bill starting before the threshold is refused even though it ends inside (the 2/11 rule no longer applies).
assert.equal(code({ periodStart: "2026-05-01", periodEnd: "2026-06-30" }), "SOURCE_BILL_TOO_OLD");
assert.equal(code({ periodStart: "2026-06-01", periodEnd: "2026-07-31" }), "SOURCE_BILL_TOO_OLD", "end inside, start outside");
// Missing, impossible and inverted dates.
assert.equal(code({ periodStart: "2026-09-01" }), "SOURCE_BILL_PERIOD_MISSING");
assert.equal(code({ periodEnd: "2026-09-30" }), "SOURCE_BILL_PERIOD_MISSING");
assert.equal(code(null), "SOURCE_BILL_PERIOD_MISSING");
assert.equal(code({ periodStart: "2026-09-31", periodEnd: "2026-10-30" }), "SOURCE_BILL_PERIOD_INVALID", "31 September does not exist");
assert.equal(code({ periodStart: "01/09/2026", periodEnd: "30/09/2026" }), "SOURCE_BILL_PERIOD_INVALID", "not an ISO date");
assert.equal(code({ periodStart: "2026-10-31", periodEnd: "2026-10-01" }), "SOURCE_BILL_PERIOD_INVALID", "inverted");
assert.equal(code({ periodStart: "2026-12-01", periodEnd: "2026-12-31" }), "SOURCE_BILL_PERIOD_FUTURE", "wholly in the future");
// The issue date plays no part: only the supply period is passed in.
assert.equal(supplyPeriodTooOld({ periodStart: "2026-04-01", periodEnd: "2026-05-31" }, today), true, "recent issue date, old consumption");
assert.equal(supplyPeriodTooOld({ periodStart: "2026-09-01", periodEnd: "2026-09-30" }, today), false);
// The window moves with the date it is measured on.
assert.equal(supplyPeriodAdmission({ periodStart: "2026-06-17", periodEnd: "2026-07-16" }, "2026-11-18").admitted, false);
assert.equal(supplyPeriodAdmission({ periodStart: "2026-06-17", periodEnd: "2026-07-16" }, "2026-11-18").windowStart, "2026-06-18");

console.log("quote window smoke passed");
