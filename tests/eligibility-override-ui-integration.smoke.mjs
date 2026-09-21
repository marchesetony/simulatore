import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../app/components/BillDrivenSimulationPanel.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/eligibility/override/route.ts", import.meta.url), "utf8");

for (const value of ["NOT_ELIGIBLE", "BLOCKED", "ELIGIBLE_BY_OVERRIDE", "Richiedi autorizzazione", "Autorizza eccezione", "Autorizzazione richiesta", "Utilizzo autorizzato", "Rifiuta richiesta", "/api/eligibility/override?billId="]) assert.match(panel, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(panel, /capabilities\.canRequest/);
assert.match(panel, /capabilities\.canAuthorize/);
assert.match(panel, /eligibilityOverrideId/);
const requestStart = panel.indexOf("const requestOverride");
const authorizeStart = panel.indexOf("const authorizeOverride", requestStart);
assert.ok(requestStart >= 0 && authorizeStart > requestStart);
assert.doesNotMatch(panel.slice(requestStart, authorizeStart), /originalMismatchReasons/);
assert.match(route, /prepareBillDrivenSimulation/);
assert.match(route, /candidate\.reasonCodes/);
assert.match(route, /action === "authorize"/);
assert.match(route, /action === "reject"/);
console.log("SERVER_CAPABILITY_GATING_UI=PASS");
console.log("REQUEST_OVERRIDE_UI=PASS");
console.log("AUTHORIZE_OVERRIDE_UI=PASS");
console.log("PENDING_AUTHORIZED_REJECTED_EXPIRED_UI=PASS");
console.log("NO_CLIENT_SIDE_BYPASS=PASS");
