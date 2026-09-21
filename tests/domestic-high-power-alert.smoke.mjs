import assert from "node:assert/strict";
import {
  DOMESTIC_HIGH_COMMITTED_POWER_MESSAGE,
  DOMESTIC_HIGH_COMMITTED_POWER_THRESHOLD_KW,
  deriveBillDrivenContextAlerts,
} from "../app/lib/calculation/bill-driven.ts";

const alerts = (contractedPowerKw, domestic = true, vector = "EE") => deriveBillDrivenContextAlerts({ vector, domestic, contractedPowerKw });

assert.equal(DOMESTIC_HIGH_COMMITTED_POWER_THRESHOLD_KW, 15);
for (const power of [3, 10, 15]) assert.deepEqual(alerts(power), []);

for (const power of [15.01, 20]) {
  assert.deepEqual(alerts(power), [{
    code: "DOMESTIC_HIGH_COMMITTED_POWER",
    severity: "WARNING",
    requiresReview: true,
    message: DOMESTIC_HIGH_COMMITTED_POWER_MESSAGE,
  }]);
}

assert.deepEqual(alerts(20, false), []);
assert.deepEqual(alerts(20, true, "GAS"), []);
assert.deepEqual(alerts(null), []);

console.log("DOMESTIC_3KW_NO_ALERT=PASS");
console.log("DOMESTIC_10KW_NO_ALERT=PASS");
console.log("DOMESTIC_15KW_NO_ALERT=PASS");
console.log("DOMESTIC_15_01KW_ALERT=PASS");
console.log("DOMESTIC_20KW_ALERT=PASS");
console.log("NONDOM_20KW_NO_DOMESTIC_ALERT=PASS");
console.log("DOMESTIC_ALERT_NO_AUTO_RECLASSIFICATION=PASS");
