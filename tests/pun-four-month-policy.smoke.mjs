import assert from "node:assert/strict";
import { closedPunTargetMonths } from "../app/lib/market-refresh/service.ts";
import { MINIMUM_PUN_HISTORY_MONTHS } from "../app/lib/market-refresh/registry.ts";

assert.equal(MINIMUM_PUN_HISTORY_MONTHS, 6);
assert.deepEqual(closedPunTargetMonths("2026-09-11T00:00:00.000Z"), ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]);
assert.deepEqual(closedPunTargetMonths("2026-08-01T00:00:00.000Z"), ["2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02"]);
assert.deepEqual(closedPunTargetMonths("2027-01-15T00:00:00.000Z"), ["2026-12", "2026-11", "2026-10", "2026-09", "2026-08", "2026-07"]);
// Across New Year the six months span two GME yearly archives: each month is read from its own year.
const { createGmeHistoricalArchiveReader } = await import("../app/lib/market/gme-historical-archive.ts");
const requested = [];
const reader = createGmeHistoricalArchiveReader({ fetcher: async (url) => { requested.push(url); return { status: 503, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }; } });
for (const month of closedPunTargetMonths("2027-02-10T00:00:00.000Z")) await reader.load({ tenantId: "tenant_demo", referenceMonth: month, retrievedAt: "2027-02-10T00:00:00.000Z" }).catch(() => undefined);
assert.deepEqual(requested.map((url) => /fileName=(Anno\d{4})\.zip/.exec(url)[1]), ["Anno2027", "Anno2026"]);
console.log("PUN_HISTORY_REQUIRED_MONTHS=6");
console.log("CURRENT_PARTIAL_MONTH_INCLUDED=NO");
console.log("PUN_YEAR_BOUNDARY=PASS");
console.log("pun four-month policy smoke: ok");
