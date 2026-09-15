import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { extractDocumentMonthlyBandEvidence, normalizeDocumentNumericLexeme, reconcileMonthlyBandsWithDocumentEvidence } from "../app/lib/ingestion/document-numeric-evidence.ts";
import { BILL_WIRE_FIELD_NAMES, mapBillWireToStructuredBill } from "../app/lib/ingestion/bill-wire.ts";
import { normalizeStoredStructuredBillExtraction, structuredBillAnalyticalMonthlyTotal, structuredBillMonthlyDisplayReconciliation, validateStructuredBillExtraction } from "../app/lib/ingestion/structured-bill.ts";

function pdfFor(rows, { compress = true, headers = true } = {}) {
  const header = rows.length && headers ? ["1 0 0 1 40 80 Tm", "(F1)Tj", "1 0 0 1 60 80 Tm", "(F2)Tj", "1 0 0 1 80 80 Tm", "(F3)Tj"] : [];
  const content = [...header, ...rows.flatMap(({ month, values, y = 100 }) => [
    `1 0 0 1 10 ${y} Tm`, `(${month})Tj`,
    `1 0 0 1 20 ${y} Tm`, `(0)Tj`,
    ...values.flatMap((value, index) => [`1 0 0 1 ${40 + index * 20} ${y} Tm`, `(${value})Tj`]),
  ])].join("\n");
  const body = Buffer.from(content, "latin1");
  const stream = compress ? deflateSync(body) : body;
  const filter = compress ? "/Filter /FlateDecode\n" : "";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< ${filter}/Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream\nendobj\n`,
  ];
  return new Uint8Array(Buffer.from(`%PDF-1.7\n${objects.join("")}%%EOF`, "latin1"));
}

const precisePdf = pdfFor([
  { month: "07/2026", values: ["77,26", "58,73", "73,41", "209,40"] },
  { month: "08/2026", values: ["105.62", "73.44", "88.86", "267.92"], y: 120 },
]);
const evidenceResult = extractDocumentMonthlyBandEvidence(precisePdf);
assert.equal(evidenceResult.status, "AVAILABLE");
assert.deepEqual(evidenceResult.bands.map(({ month, f1, f2, f3 }) => ({ month, f1: f1.normalizedValue, f2: f2.normalizedValue, f3: f3.normalizedValue })), [
  { month: "2026-07", f1: 77.26, f2: 58.73, f3: 73.41 },
  { month: "2026-08", f1: 105.62, f2: 73.44, f3: 88.86 },
]);
assert.equal(evidenceResult.bands[0].f1.rawLexeme, "77,26");
assert.deepEqual(evidenceResult.bands[0].f1.locator, { section: "CONSUMI", table: "MONTHLY_BANDS", row: "2026-07", column: "F1" });
assert.equal(evidenceResult.bands[0].f1.sourcePage, 1);
assert.match(evidenceResult.bands[0].f1.sourceSha256, /^[a-f0-9]{64}$/);

assert.equal(normalizeDocumentNumericLexeme("77,26"), 77.26);
assert.equal(normalizeDocumentNumericLexeme("77.26"), 77.26);
assert.equal(normalizeDocumentNumericLexeme("1.234,56"), null, "ambiguous grouping must fail closed");
assert.equal(normalizeDocumentNumericLexeme("1.234"), null, "three-digit dot grouping must fail closed");
assert.equal(extractDocumentMonthlyBandEvidence(pdfFor([])).status, "NOT_AVAILABLE");
assert.equal(extractDocumentMonthlyBandEvidence(pdfFor([{ month: "07/2026", values: ["77,26"] }])).status, "FAIL_CLOSED");
assert.equal(extractDocumentMonthlyBandEvidence(pdfFor([{ month: "07/2026", values: ["77,26", "58,73", "73,41"] }], { headers: false })).status, "FAIL_CLOSED", "missing semantic band headers must fail closed");
assert.equal(extractDocumentMonthlyBandEvidence(pdfFor([{ month: "07/2026", values: ["77,26", "58,73", "73,41"] }, { month: "07/2026", values: ["77,26", "58,73", "73,41"], y: 120 }])).reason, "DUPLICATE_MONTH_ROW");
assert.equal(extractDocumentMonthlyBandEvidence(new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n1 0 obj\n<<>>\nendobj\n%%EOF", "latin1"))).status, "FAIL_CLOSED", "duplicate PDF object ids must fail closed");

const providerBands = evidenceResult.bands.map(({ month, f1, f2, f3 }) => ({ month, f1: Math.round(f1.normalizedValue), f2: Math.round(f2.normalizedValue), f3: Math.round(f3.normalizedValue) }));
const grounded = reconcileMonthlyBandsWithDocumentEvidence(providerBands, evidenceResult.bands);
assert.equal(grounded.status, "DOCUMENT_GROUNDED");
assert.equal(grounded.precisionMismatch, true);
assert.deepEqual(grounded.monthlyBands, [
  { month: "2026-07", f1: 77.26, f2: 58.73, f3: 73.41 },
  { month: "2026-08", f1: 105.62, f2: 73.44, f3: 88.86 },
]);

function field(value, status = "FOUND") { return { value, status }; }
function missing() { return field("NOT_FOUND", "NOT_FOUND"); }
const wire = { schemaVersion: 1 };
for (const name of BILL_WIRE_FIELD_NAMES) wire[name] = missing();
Object.assign(wire, { vector: field("EE"), supplier: field("Supplier"), customerType: field("RESIDENTIAL"), billingPeriod: field("01/07/2026 - 31/08/2026"), billedConsumption: field("477"), annualConsumption: field("1779.70"), pod: field("IT001E12345678"), voltageLevel: field("LV"), f1Consumption: field("183"), f2Consumption: field("132"), f3Consumption: field("162"), monthlyBands: grounded.monthlyBands });
delete wire.customerId;
const extraction = mapBillWireToStructuredBill(wire);
const withEvidence = { ...extraction, monthlyBands: grounded.monthlyBands, monthlyBandEvidence: grounded.evidence, monthlyBandDocumentEvidenceStatus: grounded.status, monthlyBandPrecisionMismatch: grounded.precisionMismatch };
validateStructuredBillExtraction(withEvidence);
assert.equal(structuredBillAnalyticalMonthlyTotal(withEvidence), 477.32);
assert.equal(structuredBillMonthlyDisplayReconciliation(withEvidence), "PASS");
const roundTrip = normalizeStoredStructuredBillExtraction(JSON.parse(JSON.stringify(withEvidence)));
assert.equal(roundTrip.monthlyBandEvidence[0].f1.rawLexeme, "77,26");
assert.equal(roundTrip.monthlyBandEvidence[1].f3.normalizedValue, 88.86);
assert.equal(roundTrip.monthlyBandPrecisionMismatch, true);

const degraded = { ...withEvidence, monthlyBands: providerBands, monthlyBandEvidence: undefined, monthlyBandDocumentEvidenceStatus: undefined, monthlyBandPrecisionMismatch: undefined };
assert.equal(structuredBillAnalyticalMonthlyTotal(degraded), 477);
assert.equal(structuredBillMonthlyDisplayReconciliation(degraded), "PASS", "legacy records retain their existing display rule");
assert.notEqual(structuredBillAnalyticalMonthlyTotal(withEvidence), structuredBillAnalyticalMonthlyTotal(degraded), "document evidence prevents degraded AI value from becoming canonical");
assert.equal(structuredBillMonthlyDisplayReconciliation({ ...withEvidence, monthlyBands: providerBands }), "FAIL_CLOSED", "document-grounded status cannot carry degraded bands");
assert.equal(reconcileMonthlyBandsWithDocumentEvidence(providerBands, evidenceResult.bands.slice(1)).status, "FAIL_CLOSED");

const legacy = structuredClone(withEvidence);
delete legacy.monthlyBands; delete legacy.monthlyBandEvidence; delete legacy.monthlyBandDocumentEvidenceStatus; delete legacy.monthlyBandPrecisionMismatch;
assert.doesNotThrow(() => validateStructuredBillExtraction(legacy));
console.log("document numeric evidence smoke: ok (bounded text-layer evidence, decimal normalization, semantic reconciliation, persistence round-trip and fail-closed guards)");
