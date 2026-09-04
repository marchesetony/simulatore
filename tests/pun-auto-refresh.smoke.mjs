import assert from "node:assert/strict";
import { parseGmeCompletePublication } from "../app/lib/market/gme-pun-source.ts";
import { closedPunTargetMonths } from "../app/lib/market-refresh/service.ts";

const sourceReference = "https://gme.mercatoelettrico.org/qa/pun-2026-08.pdf";
const record = parseGmeCompletePublication({
  tenantId: "tenant_pun-refresh",
  referenceMonth: "2026-08",
  publicationText: "agosto 2026 PUNop 179,999 EUR/MWh",
  monthlyPublicationText: "agosto 2026 PUNop 179,999 EUR/MWh",
  bandsPublicationText: "agosto 2026 F1 (1 ore) 174,516 F2 (1 ore) 204,353 F3 (1 ore) 171,716 EUR/MWh",
  sourceReference,
  retrievedAt: "2026-09-04T00:00:00.000Z",
});

assert.deepEqual([record.monthly?.value, record.f1?.value, record.f2?.value, record.f3?.value], [179.999, 174.516, 204.353, 171.716]);
assert.deepEqual(closedPunTargetMonths("2026-09-04T00:00:00.000Z"), ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]);
console.log("PUN_AUTO_REFRESH_COMPLETE_MONTH=PASS");
console.log("PUN_AUTO_REFRESH_CLOSED_MONTH_BACKFILL=PASS");
console.log("pun auto refresh smoke: ok");
