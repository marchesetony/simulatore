import assert from "node:assert/strict";
import { analyticalMonthlyTotalKwh, reconcileAnalyticalToDisplay, selectMonthlyBandsForBillingPeriod } from "../app/lib/ingestion/monthly-bands.ts";
import { normalizeStoredStructuredBillExtraction, structuredBillAnalyticalMonthlyTotal, structuredBillMonthlyDisplayReconciliation, validateStructuredBillExtraction } from "../app/lib/ingestion/structured-bill.ts";
import { BILL_WIRE_FIELD_NAMES, mapBillWireToStructuredBill } from "../app/lib/ingestion/bill-wire.ts";

function bandsFor(months) {
  return months.map((month) => month === "2026-07"
    ? { month, f1: 77.26, f2: 58.73, f3: 73.41 }
    : month === "2026-08"
      ? { month, f1: 105.62, f2: 73.44, f3: 88.86 }
      : { month, f1: 1, f2: 2, f3: 3 });
}

const detected = bandsFor(["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
const scoped = selectMonthlyBandsForBillingPeriod({ from: "2026-07-01", to: "2026-09-01" }, detected);
assert.deepEqual(scoped.map((band) => band.month), ["2026-07", "2026-08"]);
assert.equal(scoped.length, 2);
assert.equal(analyticalMonthlyTotalKwh(scoped), 477.32);
assert.equal(reconcileAnalyticalToDisplay(analyticalMonthlyTotalKwh(scoped), 477), "PASS");

assert.deepEqual(selectMonthlyBandsForBillingPeriod({ from: "2026-07-01", to: "2026-08-31" }, detected).map((band) => band.month), ["2026-07", "2026-08"]);
assert.deepEqual(selectMonthlyBandsForBillingPeriod({ from: "2026-12-01", to: "2027-02-01" }, bandsFor(["2026-12", "2027-01"])).map((band) => band.month), ["2026-12", "2027-01"]);
assert.throws(() => selectMonthlyBandsForBillingPeriod({ from: "2026-07-15", to: "2026-08-15" }, detected), /PARTIAL_MONTH_PERIOD/);
assert.throws(() => selectMonthlyBandsForBillingPeriod({ from: "2026-07-01", to: "2026-08-15" }, detected), /PARTIAL_MONTH_PERIOD/);
assert.throws(() => selectMonthlyBandsForBillingPeriod(undefined, detected), /billingPeriod.*REQUIRED/);
assert.throws(() => selectMonthlyBandsForBillingPeriod({ from: "2026-07-01", to: "not-a-date" }, detected), /VALID_FULL_MONTH_PERIOD_REQUIRED/);
assert.throws(() => selectMonthlyBandsForBillingPeriod({ from: "2026-07-01", to: "2026-09-01" }, detected.slice(0, -1)), /MISSING_BILLING_PERIOD_MONTH/);
assert.throws(() => selectMonthlyBandsForBillingPeriod({ from: "2026-07-01", to: "2026-09-01" }, [...detected, detected[0]]), /DUPLICATE_MONTH/);

function field(value, status = "FOUND") { return { value, status }; }
function missing() { return field("NOT_FOUND", "NOT_FOUND"); }
const wire = { schemaVersion: 1 };
for (const name of BILL_WIRE_FIELD_NAMES) wire[name] = missing();
Object.assign(wire, { vector: field("EE"), supplier: field("Supplier"), customerType: field("RESIDENTIAL"), billingPeriod: field("01/07/2026 - 31/08/2026"), billedConsumption: field("477"), annualConsumption: field("1779.70"), pod: field("IT001E12345678"), voltageLevel: field("LV"), f1Consumption: field("183"), f2Consumption: field("132"), f3Consumption: field("162") });
const base = mapBillWireToStructuredBill(wire);
const evidenceFor = (month, f1, f2, f3) => ({ month, f1: { rawLexeme: String(f1).replace(".", ","), normalizedValue: f1, sourcePage: 3, locator: { section: "CONSUMI", table: "MONTHLY_BANDS", row: month, column: "F1" }, provenance: "DOCUMENT_TEXT_LAYER", sourceSha256: "a".repeat(64) }, f2: { rawLexeme: String(f2).replace(".", ","), normalizedValue: f2, sourcePage: 3, locator: { section: "CONSUMI", table: "MONTHLY_BANDS", row: month, column: "F2" }, provenance: "DOCUMENT_TEXT_LAYER", sourceSha256: "a".repeat(64) }, f3: { rawLexeme: String(f3).replace(".", ","), normalizedValue: f3, sourcePage: 3, locator: { section: "CONSUMI", table: "MONTHLY_BANDS", row: month, column: "F3" }, provenance: "DOCUMENT_TEXT_LAYER", sourceSha256: "a".repeat(64) } });
const canonical = [{ month: "2026-07", f1: 77.26, f2: 58.73, f3: 73.41 }, { month: "2026-08", f1: 105.62, f2: 73.44, f3: 88.86 }];
const canonicalEvidence = [evidenceFor("2026-07", 77.26, 58.73, 73.41), evidenceFor("2026-08", 105.62, 73.44, 88.86)];
const withAllDetected = { ...base, monthlyBands: canonical, monthlyBandEvidence: canonicalEvidence, detectedMonthlyBandEvidence: [evidenceFor("2025-03", 1, 2, 3), ...canonicalEvidence], monthlyBandDocumentEvidenceStatus: "DOCUMENT_GROUNDED", monthlyBandPrecisionMismatch: true };
assert.doesNotThrow(() => validateStructuredBillExtraction(withAllDetected));
const roundTrip = normalizeStoredStructuredBillExtraction(JSON.parse(JSON.stringify(withAllDetected)));
assert.equal(roundTrip.detectedMonthlyBandEvidence.length, 3);
assert.equal(roundTrip.monthlyBands.length, 2);
assert.equal(roundTrip.monthlyBandPrecisionMismatch, true);

const unscopedDocumentGrounded = { ...base, monthlyBands: detected, monthlyBandDocumentEvidenceStatus: "DOCUMENT_GROUNDED", monthlyBandPrecisionMismatch: true };
assert.equal(structuredBillAnalyticalMonthlyTotal(unscopedDocumentGrounded), null, "unscoped document-grounded bands must not be totaled");
assert.equal(structuredBillMonthlyDisplayReconciliation(unscopedDocumentGrounded), "FAIL_CLOSED", "unscoped document-grounded bands must fail closed");

console.log("monthly billing-period scoping smoke: ok (18-month evidence, complete-month boundaries, partial-period fail-closed, scoped total, evidence preservation and legacy validation)");
