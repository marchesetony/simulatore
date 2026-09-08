import assert from "node:assert/strict";

import { assertNoKnownDomesticTierDivergence } from "../app/lib/calculation/engine.ts";
import { assertDomesticFormalTierRatesEqual, DOMESTIC_TIER_RATE_DIVERGENCE_ERROR } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { deterministicRecordId } from "../app/lib/persistence/types.ts";

assert.equal(assertDomesticFormalTierRatesEqual("ASOS", [3.1515, 3.1515]), 3.1515);
assert.throws(() => assertDomesticFormalTierRatesEqual("ASOS", [3.1515, 3.2000]), new RegExp(`${DOMESTIC_TIER_RATE_DIVERGENCE_ERROR}:ASOS`));
assert.throws(() => assertDomesticFormalTierRatesEqual("ARIM", [0.1638, 0.1700]), new RegExp(`${DOMESTIC_TIER_RATE_DIVERGENCE_ERROR}:ARIM`));

const tenant = "tenant_domestic-divergence-smoke";
const recordId = deterministicRecordId("regulatory-refresh-state", tenant, "regulatory-refresh");
const divergenceState = { payload: { errors: ["ARERA_SOURCE:DOMESTIC_TIER_RATE_DIVERGENCE_UNSUPPORTED:ASOS"] } };
const cleanState = { payload: { errors: [] } };
const repository = { async get(_tenantId, requestedRecordId) { return requestedRecordId === recordId ? divergenceState : null; } };
await assert.rejects(() => assertNoKnownDomesticTierDivergence(repository, tenant), /DOMESTIC_TIER_RATE_DIVERGENCE_UNSUPPORTED/);
await assert.doesNotReject(() => assertNoKnownDomesticTierDivergence({ async get() { return cleanState; } }, tenant));

console.log("DOMESTIC_TIER_DIVERGENCE_DETECTED=PASS");
console.log("DOMESTIC_TIER_DIVERGENCE_AUTO_APPROVED=NO");
console.log("DOMESTIC_TIER_DIVERGENCE_FAIL_CLOSED=PASS");
console.log("KNOWN_FUTURE_DIVERGENCE_OLD_RATE_CONTINUES=NO");
