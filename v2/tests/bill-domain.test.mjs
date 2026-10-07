import test from "node:test";
import assert from "node:assert/strict";
import { billInput, supplyInput } from "../modules/bills/schema.ts";
import { reconcile, compareExactCents } from "../modules/bills/reconciliation.ts";
import { cents, eurosToCents, MAX_CENTS } from "../modules/bills/values.ts";
import { snapshot } from "../modules/bills/snapshot.ts";
import { input, line, consumption, period } from "./bill-fixtures.mjs";

test("money is exact signed integer cents; decimal boundary does not round silently", () => {
  assert.equal(eurosToCents("108,34"), 10834); assert.equal(eurosToCents("-0.01"), -1);
  assert.equal(eurosToCents(""), null); assert.equal(eurosToCents("0"), 0);
  for (const value of [NaN, Infinity, 0.01, MAX_CENTS + 1, "100"]) assert.throws(() => cents(value));
  for (const value of ["1.001", "1e3", "1.000,00"]) assert.throws(() => eurosToCents(value));
});
test("missing monetary values never become zero", () => {
  const result = reconcile(input({ lines: [line({ amount: null })] }));
  assert.equal(result.reconstructedTotal, null); assert.equal(result.categories.currentCharges, null);
  assert.equal(reconcile(input({ lines: [line({ amount: 0 })], declaredDocumentTotal: 0 })).categories.currentCharges, 0);
});
test("missing consumption remains null; incomplete bands do not invent TOTAL", () => {
  const bill = billInput(input({ consumptions: [consumption("F1", null), consumption("F2", "0")] }));
  assert.deepEqual(bill.consumptions.map(c => c.energyKwh), [null, "0"]);
  assert.equal(bill.consumptions.some(c => c.band === "TOTAL"), false);
});
test("TOTAL equals F1+F2+F3 exactly at 0.001 kWh precision", () => {
  const bands = [consumption("TOTAL", "0.6"), consumption("F1", "0.1"), consumption("F2", "0.2"), consumption("F3", "0.3")];
  assert.equal(billInput(input({ consumptions: bands })).consumptions.length, 4);
  assert.throws(() => billInput(input({ consumptions: [consumption("TOTAL", "0.601"), ...bands.slice(1)] })));
});
test("bands of different periods are never combined; duplicates rejected", () => {
  assert.doesNotThrow(() => billInput(input({ consumptions: [consumption("TOTAL", "10"), consumption("F1", "100", { periodEnd: "2026-07-15" })] })));
  assert.throws(() => billInput(input({ consumptions: [consumption("TOTAL", "1"), consumption("TOTAL", "1")] })));
});
test("periods inclusive: one day accepted, reversed and invalid dates rejected", () => {
  assert.doesNotThrow(() => billInput(input({ periodEnd: period.periodStart })));
  for (const patch of [{ periodStart: "2026-08-01" }, { periodEnd: "2026-02-30" }, { issueDate: "2026-13-01" }, { issueDate: "01/08/2026" }]) {
    assert.throws(() => billInput(input(patch)));
  }
});
test("line subperiod and historical recalculation period preserved", () => {
  const rows = [line({ periodEnd: "2026-07-15" }), line({ kind: "RECALCULATION", periodStart: "2025-01-01", periodEnd: "2025-01-31" })];
  assert.deepEqual(billInput(input({ lines: rows })).lines, rows);
  assert.throws(() => billInput(input({ lines: [line({ periodStart: "2027-01-01" })] })));
});
test("aggregate and detail are never double counted and parentage is not invented", () => {
  const r = reconcile(input({ lines: [line({ level: "AGGREGATE" }), line()] }));
  assert.equal(r.status, "NOT_DETERMINABLE"); assert.equal(r.reconstructedTotal, null);
  assert.equal(r.reason, "AMBIGUOUS_AGGREGATION"); assert.equal(r.categories.currentCharges, null);
});
test("reconstruction requires complete source coverage and explicit participation", () => {
  for (const patch of [{ lines: [] }, { lines: [line({ documentTotalParticipation: "UNKNOWN" })] },
    { lines: [line({ kind: "UNKNOWN" })] }, { declaredDocumentTotal: null }, { lines: [line({ documentTotalParticipation: "EXCLUDED" })] }]) {
    assert.equal(reconcile(input(patch)).reconstructedTotal, null);
  }
});
test("exact cents: one cent difference is DIFFERENCE in either direction", () => {
  assert.deepEqual(compareExactCents(1000, 1000), { status: "MATCH", difference: 0 });
  assert.deepEqual(compareExactCents(1000, 999), { status: "DIFFERENCE", difference: 1 });
  assert.deepEqual(compareExactCents(1000, 1001), { status: "DIFFERENCE", difference: -1 });
  const result = reconcile(input({ declaredDocumentTotal: 999 }));
  assert.equal(result.reconstructedTotal, null);
  assert.equal(result.status, "NOT_DETERMINABLE");
});
test("current, TV, prior and other stay separate; membership in document total is explicit", () => {
  const bill = input({ declaredDocumentTotal: 1100, lines: [line(), line({ kind: "TV_LICENSE", amount: 100 }),
    line({ kind: "PREVIOUS_BALANCE", amount: 900, documentTotalParticipation: "EXCLUDED" }),
    line({ kind: "OTHER_AMOUNTS", amount: 500, documentTotalParticipation: "EXCLUDED" })] });
  const r = reconcile(bill);
  assert.deepEqual(r.categories, { currentCharges: 1000, tvLicense: 100, previousBalance: 900, otherAmounts: 500 });
  assert.equal(r.reconstructedTotal, null); assert.equal(r.status, "NOT_DETERMINABLE");
  assert.equal(reconcile(input()).categories.tvLicense, null);
});
test("arithmetic MATCH or DIFFERENCE never establishes completeness or validation", () => {
  const ownership = { id: "id", tenantId: "tenant_test", customerId: "c", supplyId: "s" };
  for (const declaredDocumentTotal of [1000, 1001]) {
    assert.equal(compareExactCents(1000, declaredDocumentTotal).status, declaredDocumentTotal === 1000 ? "MATCH" : "DIFFERENCE");
    const bill = snapshot(input({ declaredDocumentTotal }), ownership);
    assert.equal(bill.completenessStatus, "INCOMPLETE");
    assert.equal(bill.validationStatus, "UNVALIDATED");
    assert.equal(bill.reconciliation.status, "NOT_DETERMINABLE");
  }
});
test("client completeness assertion is rejected, never grants COMPLETE", () => {
  assert.throws(() => billInput(input({ detailCoverage: "COMPLETE_NON_OVERLAPPING" })), { code: "INVALID_INPUT" });
});
test("duplicable DETAIL of the same period cannot reconstruct or sum a category", () => {
  const r = reconcile(input({ declaredDocumentTotal: 2000, lines: [line(), line()] }));
  assert.equal(r.status, "NOT_DETERMINABLE"); assert.equal(r.reason, "AMBIGUOUS_DETAILS");
  assert.equal(r.reconstructedTotal, null); assert.equal(r.categories.currentCharges, null);
});
test("partially overlapping DETAIL cannot reconstruct", () => {
  const r = reconcile(input({ lines: [line({ periodEnd: "2026-07-20" }), line({ periodStart: "2026-07-15" })] }));
  assert.equal(r.status, "NOT_DETERMINABLE"); assert.equal(r.reason, "AMBIGUOUS_DETAILS");
  assert.equal(r.reconstructedTotal, null);
});
test("non-overlapping known DETAIL still cannot prove whole document coverage", () => {
  const r = reconcile(input({ lines: [line({ periodEnd: "2026-07-15" }), line({ periodStart: "2026-07-16" })] }));
  assert.equal(r.status, "NOT_DETERMINABLE"); assert.equal(r.reason, "UNPROVEN_COVERAGE");
  assert.equal(r.reconstructedTotal, null);
});
test("overlapping consumption is preserved, never summed or converted to TOTAL", () => {
  const consumptions = [consumption("F1", "10", { periodEnd: "2026-07-20" }), consumption("F1", "20", { periodStart: "2026-07-15" })];
  const bill = snapshot(input({ consumptions }), { id: "b", tenantId: "t", customerId: "c", supplyId: "s" });
  assert.deepEqual(bill.consumptions.map(({ band, energyKwh, periodStart, periodEnd }) => ({ band, energyKwh, periodStart, periodEnd })), consumptions);
  assert.equal(bill.consumptions.some(row => row.band === "TOTAL"), false);
  assert.equal(bill.completenessStatus, "INCOMPLETE");
});
test("malformed schema, enums, ranges and unknown nested keys are rejected", () => {
  for (const value of [null, [], {}, input({ currency: "USD" }), input({ detailCoverage: "COMPLETE" }),
    input({ lines: [line({ kind: "NEW_REGULATORY_COMPONENT" })] }), input({ lines: [line({ level: "TOTAL" })] }),
    input({ lines: [line({ parentId: "guessed" })] }), input({ lines: [line({ unitPrice: "NaN" })] }),
    input({ lines: [line({ quantity: "1000000000" })] }), input({ consumptions: [consumption("F1", "-1")] }),
    input({ consumptions: [consumption("UNKNOWN", "1")] }), input({ consumptions: [consumption("F1", "0.0001")] }),
    input({ lines: Array(101).fill(line()) })]) assert.throws(() => billInput(value));
});
test("POD normalization deterministic, syntactic only and id-independent", () => {
  const customerId = "00000000-0000-4000-8000-000000000001";
  assert.equal(supplyInput({ customerId, pod: " it001 e12345678 " }).pod, "IT001E12345678");
  assert.throws(() => supplyInput({ customerId, pod: "not-a-pod" }));
});
