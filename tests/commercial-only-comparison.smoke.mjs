import assert from "node:assert/strict";

import { comparisonCompletenessKey } from "../app/lib/comparison/service.ts";

// Competitor bill without the regulated context: CTEs that declare dispatching differently still rank together.
const money = (minorUnits) => ({ amount: minorUnits / 100, minorUnits, currency: "EUR" });
const states = (dispatching) => [
  { kind: "DISPATCHING", state: dispatching, effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01" },
  { kind: "CAPACITY_MARKET", state: "UNRESOLVED_NOT_DECLARED", effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01" },
];
const result = (costScope, dispatching) => ({ costScope, totalCommercialCost: money(10000), totalCommercialPlusRegulatedSubsetCost: costScope === "COMMERCIAL_ONLY" ? null : money(20000), regulatedComponentsIncluded: [], contractualPassThroughCompleteness: "PARTIAL", contractualPassThroughStates: states(dispatching) });

assert.equal(comparisonCompletenessKey(result("COMMERCIAL_ONLY", "RESOLVED_EXPLICIT")), comparisonCompletenessKey(result("COMMERCIAL_ONLY", "UNRESOLVED_NOT_DECLARED")));
assert.notEqual(comparisonCompletenessKey(result("COMMERCIAL_PLUS_REGULATED_PARTIAL", "RESOLVED_EXPLICIT")), comparisonCompletenessKey(result("COMMERCIAL_PLUS_REGULATED_PARTIAL", "UNRESOLVED_NOT_DECLARED")));
console.log("COMMERCIAL_ONLY_COMPARISON=PASS");
