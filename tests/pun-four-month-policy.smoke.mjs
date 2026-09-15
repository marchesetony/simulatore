import assert from "node:assert/strict";
import { closedPunTargetMonths } from "../app/lib/market-refresh/service.ts";
import { MINIMUM_PUN_HISTORY_MONTHS } from "../app/lib/market-refresh/registry.ts";

assert.equal(MINIMUM_PUN_HISTORY_MONTHS, 4);
assert.deepEqual(closedPunTargetMonths("2026-09-11T00:00:00.000Z"), ["2026-08", "2026-07", "2026-06", "2026-05"]);
assert.deepEqual(closedPunTargetMonths("2026-08-01T00:00:00.000Z"), ["2026-07", "2026-06", "2026-05", "2026-04"]);
assert.deepEqual(closedPunTargetMonths("2027-01-15T00:00:00.000Z"), ["2026-12", "2026-11", "2026-10", "2026-09"]);
console.log("PUN_HISTORY_REQUIRED_MONTHS=4");
console.log("CURRENT_PARTIAL_MONTH_INCLUDED=NO");
console.log("PUN_YEAR_BOUNDARY=PASS");
console.log("pun four-month policy smoke: ok");
