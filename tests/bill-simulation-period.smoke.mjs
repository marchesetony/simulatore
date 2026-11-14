import assert from "node:assert/strict";

import { simulationPeriodOf } from "../app/lib/calculation/bill-driven.ts";

// Bills print the last billed day (1-30 September); the calculation runs on whole months.
const cases = [
  [["2026-09-01", "2026-09-30"], ["2026-09-01", "2026-10-01"]],
  [["2026-08-01", "2026-09-01"], ["2026-08-01", "2026-09-01"]],
  [["2026-07-01", "2026-08-31"], ["2026-07-01", "2026-09-01"]],
  [["2026-08-15", "2026-09-14"], ["2026-08-01", "2026-09-01"]],
  [["2026-09-20", "2026-09-30"], ["2026-09-01", "2026-10-01"]],
];
for (const [[periodStart, periodEnd], [start, end]] of cases) assert.deepEqual(simulationPeriodOf({ periodStart, periodEnd }), { periodStart: start, periodEnd: end });
console.log("BILL_SIMULATION_PERIOD=PASS");
