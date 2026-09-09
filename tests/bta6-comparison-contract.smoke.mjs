import assert from "node:assert/strict";

import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { buildComparisonResult, comparisonCompletenessKey } from "../app/lib/comparison/service.ts";

const tenant = "tenant_bta6-comparison-4d2";
const COMPLETE = "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE";
const PARTIAL = "COMMERCIAL_PLUS_REGULATED_PARTIAL";
const regulated = ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "METERING_FIXED", "TRANSMISSION_ENERGY", "UC3_ENERGY", "UC6_ENERGY", "UC6_FIXED", "ARIM_FIXED", "ARIM_POWER", "ARIM_ENERGY", "ASOS_FIXED", "ASOS_POWER", "ASOS_ENERGY"];
const money = (minorUnits) => ({ amount: minorUnits / 100, minorUnits, currency: "EUR" });
const request = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-07-15", supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 600, f2: 300, f3: 100 } }, tenant);
const states = (dispatching, capacity) => [
  { kind: "DISPATCHING", state: dispatching, effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01" },
  { kind: "CAPACITY_MARKET", state: capacity, effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01" },
];
const result = (id, costScope, contractualStates, total = 20000) => ({ calculationId: id, costScope, vector: "EE", totalCommercialCost: money(total - 5000), totalCommercialPlusRegulatedSubsetCost: money(total), regulatedComponentsIncluded: regulated, contractualPassThroughCompleteness: contractualStates.every((state) => state.state.startsWith("RESOLVED")) ? "COMPLETE" : "PARTIAL", contractualPassThroughStates: contractualStates, bta6NetOfTaxCompleteCandidate: costScope === COMPLETE, sourceCte: { archiveId: id, cteId: id, versionId: `${id}-v`, version: "1", supplier: id, offerCode: `${id}-offer` } });

const completeIncludedExplicit = result("complete-a", COMPLETE, states("RESOLVED_INCLUDED", "RESOLVED_EXPLICIT"), 20000);
const completeExplicitIncluded = result("complete-b", COMPLETE, states("RESOLVED_EXPLICIT", "RESOLVED_INCLUDED"), 20000);
assert.equal(comparisonCompletenessKey(completeIncludedExplicit), comparisonCompletenessKey(completeExplicitIncluded));
const completeComparison = buildComparisonResult(request, [completeIncludedExplicit, completeExplicitIncluded]);
assert.equal(completeComparison.ranking.length, 2);
assert.equal(completeComparison.ranking[0].tieGroup, completeComparison.ranking[1].tieGroup);
console.log("BTA6_COMPLETE_RESOLVED_STRUCTURE_NORMALIZED=PASS");

const partialKnownScopeA = result("partial-a", PARTIAL, states("RESOLVED_EXPLICIT", "UNRESOLVED_NOT_DECLARED"), 20000);
const partialKnownScopeB = result("partial-b", PARTIAL, states("RESOLVED_INCLUDED", "UNRESOLVED_NOT_DECLARED"), 19000);
assert.doesNotThrow(() => buildComparisonResult(request, [partialKnownScopeA, partialKnownScopeB]));
const partialAsymmetricA = result("partial-c", PARTIAL, states("RESOLVED_EXPLICIT", "UNRESOLVED_NOT_DECLARED"));
const partialAsymmetricB = result("partial-d", PARTIAL, states("UNRESOLVED_NOT_DECLARED", "RESOLVED_EXPLICIT"));
assert.notEqual(comparisonCompletenessKey(partialAsymmetricA), comparisonCompletenessKey(partialAsymmetricB));
assert.throws(() => buildComparisonResult(request, [partialAsymmetricA, partialAsymmetricB]), /COMPARISON_INCOMPATIBLE/);
console.log("BTA6_PARTIAL_CONTRACTUAL_COVERAGE_GUARD=PASS");

const lower = result("lower", COMPLETE, states("RESOLVED_INCLUDED", "RESOLVED_INCLUDED"), 18000);
const higher = result("higher", COMPLETE, states("RESOLVED_EXPLICIT", "RESOLVED_EXPLICIT"), 22000);
const ranking = buildComparisonResult(request, [higher, lower]).ranking;
assert.equal(ranking[0].calculationId, "lower");
assert.equal(ranking[0].comparisonCost.minorUnits, 18000);
console.log("BTA6_RANKING_USES_COMPARISON_COST=PASS");

const partial = result("partial", PARTIAL, states("RESOLVED_EXPLICIT", "UNRESOLVED_NOT_DECLARED"));
assert.throws(() => buildComparisonResult(request, [lower, partial]), /COMPARISON_INCOMPATIBLE/);
console.log("BTA6_COMPLETE_PARTIAL_GROUP_BLOCKED=PASS");
console.log("bta6-comparison-contract smoke: ok");
