import assert from "node:assert/strict";

import { QUOTE_WINDOW_MONTHS, quoteWindowStart, supplyPeriodTooOld } from "../app/lib/calculation/quote-window.ts";

assert.equal(QUOTE_WINDOW_MONTHS, 4);
assert.equal(quoteWindowStart("2026-10-19"), "2026-06-19");
assert.equal(quoteWindowStart("2026-02-15"), "2025-10-15", "crosses the year boundary");
assert.equal(quoteWindowStart("2026-06-30"), "2026-02-28", "clamps to the shorter month");
assert.equal(quoteWindowStart("2028-06-30"), "2028-02-29", "keeps leap days");

// The supply period counts, not the billing date: any part before the window discards the bill.
assert.equal(supplyPeriodTooOld({ periodStart: "2026-07-01" }, "2026-10-19"), false);
assert.equal(supplyPeriodTooOld({ periodStart: "2026-06-19" }, "2026-10-19"), false, "the first day of the window is still allowed");
assert.equal(supplyPeriodTooOld({ periodStart: "2026-06-18" }, "2026-10-19"), true);
assert.equal(supplyPeriodTooOld({ periodStart: "2026-05-01" }, "2026-10-19"), true, "a bill issued recently for an old period is still discarded");

console.log("quote window smoke passed");
