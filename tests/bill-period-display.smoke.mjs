import assert from "node:assert/strict";
import { formatBillDisplayPeriod, formatInclusivePeriodEnd } from "../app/lib/ui/format.ts";

assert.equal(formatInclusivePeriodEnd("2026-08-01"), "2026-07-31");
assert.equal(formatBillDisplayPeriod("2026-07-01", "2026-08-01"), "01/07/2026 – 31/07/2026");
assert.equal(formatBillDisplayPeriod("2026-07-15", "2026-08-01"), "15/07/2026 – 31/07/2026");
assert.doesNotMatch(formatBillDisplayPeriod("2026-07-01", "2026-08-01"), /01\/08\/2026/);

console.log("BILL_PERIOD_END_EXCLUSIVE_NOT_SHOWN=OK");
console.log("BILL_PERIOD_INCLUSIVE_END_DISPLAY=OK");
console.log("INTRAMONTH_START_PRESERVED=OK");
console.log("bill period display smoke: ok");
