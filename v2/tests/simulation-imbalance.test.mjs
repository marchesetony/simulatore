import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../modules/simulations/engine.ts";
import { snapshot, terms, indexed, market, rate, feeTerms } from "./simulation-fixtures.mjs";

const imbalance = () => feeTerms("IMBALANCE", "0.002", "EUR_PER_KWH");
function unavailable(result) {
  assert.deepEqual(result.comparison, { status: "NOT_AVAILABLE", reason: "AMBIGUOUS_COMPONENT",
    savingAmountCents: null, savingPercentage: null });
}
function candidateBlocked(input) {
  const result = calculate(input);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockReason, "AMBIGUOUS_COMPONENT");
  assert.equal(result.candidate, null);
  assert.equal(result.current, null);
  unavailable(result);
}

test("indexed candidate with declared imbalance has no commercial total", () => {
  candidateBlocked(snapshot({ candidateCommercialTerms: { ...indexed(), fees: imbalance().fees }, marketSnapshot: market() }));
});
test("explicit non-applicable imbalance adds no component and permits comparison", () => {
  const result = calculate(snapshot({ currentCommercialTerms: terms() }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.candidate.commercialTotalCents, 4000);
  assert.deepEqual(result.candidate.components.map(row => row.kind), ["ENERGY"]);
  assert.equal(result.comparison.status, "COMPARABLE");
});
test("ambiguous current preserves valid candidate and removes comparison and savings", () => {
  const result = calculate(snapshot({ currentCommercialTerms: { ...imbalance(), spread: rate("0.01") } }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.candidate.commercialTotalCents, 4000);
  assert.equal(result.current, null);
  unavailable(result);
});
test("valid current cannot authorize an ambiguous candidate", () => {
  candidateBlocked(snapshot({ currentCommercialTerms: terms(), candidateCommercialTerms: imbalance() }));
});
test("both sides declaring imbalance never become comparable", () => {
  candidateBlocked(snapshot({ currentCommercialTerms: imbalance(), candidateCommercialTerms: imbalance() }));
});
test("fixed spread and imbalance are never added into a partial or complete total", () => {
  candidateBlocked(snapshot({ candidateCommercialTerms: { ...imbalance(), spread: rate("0.01") } }));
});
test("different IDs descriptions or client separation flags cannot authorize imbalance", () => {
  for (const extra of [{ id: "different-component" }, { description: "separate balancing cost" },
    { isSeparate: true }, { includedInSpread: false }, { distinctFromSpread: true }, { verifiedDistinct: true }]) {
    const candidate = imbalance();
    candidate.fees = candidate.fees.map(row => row.kind === "IMBALANCE" ? { ...row, ...extra } : row);
    assert.throws(() => calculate(snapshot({ candidateCommercialTerms: candidate })), { code: "INVALID_INPUT" });
  }
});
test("zero amount and fee order do not prove imbalance disjointness", () => {
  const candidate = feeTerms("IMBALANCE", "0", "EUR_PER_KWH");
  candidate.fees.reverse();
  candidateBlocked(snapshot({ candidateCommercialTerms: candidate }));
});
test("unknown imbalance applicability remains missing instead of becoming zero", () => {
  const candidate = terms();
  candidate.fees = candidate.fees.map(row => row.kind === "IMBALANCE" ? { ...row, applicability: "UNKNOWN" } : row);
  const result = calculate(snapshot({ candidateCommercialTerms: candidate }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockReason, "MISSING_COMMERCIAL_COMPONENT");
  assert.equal(result.candidate, null);
});
test("declared imbalance with missing amount or unit is still ambiguous", () => {
  for (const [amount, unit] of [[null, "EUR_PER_KWH"], ["0.002", null]]) {
    candidateBlocked(snapshot({ candidateCommercialTerms: feeTerms("IMBALANCE", amount, unit) }));
  }
});
