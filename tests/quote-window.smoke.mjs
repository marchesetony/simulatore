import assert from "node:assert/strict";

import { QUOTE_WINDOW_MONTHS, quoteWindowStart, supplyPeriodTooOld } from "../app/lib/calculation/quote-window.ts";

assert.equal(QUOTE_WINDOW_MONTHS, 4);
assert.equal(quoteWindowStart("2026-10-19"), "2026-06-19");
assert.equal(quoteWindowStart("2026-02-15"), "2025-10-15", "crosses the year boundary");
assert.equal(quoteWindowStart("2026-06-30"), "2026-02-28", "clamps to the shorter month");
assert.equal(quoteWindowStart("2028-06-30"), "2028-02-29", "keeps leap days");

// Only the start known: it counts, not the billing date (see the Tony 2/11 cases below for a known end).
assert.equal(supplyPeriodTooOld({ periodStart: "2026-07-01" }, "2026-10-19"), false);
assert.equal(supplyPeriodTooOld({ periodStart: "2026-06-19" }, "2026-10-19"), false, "the first day of the window is still allowed");
assert.equal(supplyPeriodTooOld({ periodStart: "2026-06-18" }, "2026-10-19"), true);
assert.equal(supplyPeriodTooOld({ periodStart: "2026-05-01" }, "2026-10-19"), true, "a bill issued recently for an old period is still discarded");

// Tony (2/11, "perchè", bimonthly bill refused): the end of the supply period counts, as for the 4-month archive. A bill of
// luglio-agosto 2026 (01/07 - 01/09) is usable on 2 November; one that ended before the window is not.
assert.equal(supplyPeriodTooOld({ periodStart: "2026-07-01", periodEnd: "2026-09-01" }, "2026-11-02"), false);
assert.equal(supplyPeriodTooOld({ periodStart: "2026-05-01", periodEnd: "2026-07-01" }, "2026-11-02"), true);
assert.equal(supplyPeriodTooOld({ periodStart: "2026-06-01", periodEnd: "2026-07-31" }, "2026-11-02"), false, "the last days fall inside the window");

console.log("quote window smoke passed");
