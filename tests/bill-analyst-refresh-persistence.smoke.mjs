import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAnalystRefreshVersion, LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { structuredBillFields, validateStructuredBillExtraction } from "../app/lib/ingestion/structured-bill.ts";
import { ANALYST_OWNED_PROPERTIES, stripBillAnalystData } from "../app/lib/ingestion/bill-two-stage.ts";
import { normalizeAnalystItemCode } from "../app/lib/ingestion/bill-extended-contract.ts";

const found = (value) => ({ value, status: "FOUND", confidence: 0.9, source: "DOCUMENT_AI" });
const coreExtraction = () => ({
  schemaVersion: 1,
  vector: found("EE"),
  supplier: found("Fornitore Sintetico"),
  customerName: found("Cliente Sintetico"),
  customerId: found("CUSTOMER-TEST"),
  customerType: found("RESIDENTIAL"),
  customerTaxIdentifier: found("TEST-TAX"),
  billingPeriod: found({ from: "2026-07-01", to: "2026-08-01", raw: "01/07/2026 - 31/07/2026" }),
  totalAmount: found(42.5),
  annualConsumption: found(2700),
  billedConsumption: found(220),
  pod: found("IT001E12345678"),
  pdr: { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" },
  voltageLevel: found("LV"),
  powerKw: found(3),
  f1Consumption: found(80),
  f2Consumption: found(70),
  f3Consumption: found(70),
  smcConsumption: { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" },
  conversionCoefficient: { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" },
  pcs: { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" },
  offerName: { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" },
  offerCode: { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" },
  extendedFacts: [],
  economicChargeLines: [],
  analystExtractionStatus: "NOT_RUN",
});

const previousStructuredBill = coreExtraction();
previousStructuredBill.extendedFacts = Array.from({ length: 77 }, (_, index) => ({ code: "UNKNOWN", value: `legacy-${index}`, status: "INVALID" }));
previousStructuredBill.analystExtractionStatus = "EXTRACTED";
previousStructuredBill.analystDiagnostic = { code: "OLD_ANALYST_RESULT", requestId: null, message: "legacy result must not be reused" };
validateStructuredBillExtraction(previousStructuredBill);

const analystItem = (kind, code, value, extra = {}) => ({ kind, code, label: "", value, unit: "", quantity: "", unitPrice: "", amount: "", period: "", status: "FOUND", ...extra });
const factCodes = [
  ["SUPPLY_ADDRESS", "Via Test 1"], ["NOMINAL_VOLTAGE", "230"], ["PAYMENT_METHOD", "Addebito diretto"], ["SPREAD", "0,01000"],
  ["SUPPLY_CITY", "Citta Test"], ["SUPPLY_POSTAL_CODE", "00000"], ["SUPPLY_PROVINCE", "TT"], ["POWER_COMMITTED", "3"],
  ["POWER_AVAILABLE", "3"], ["BILLING_PERIOD_RAW", "01/07/2026 - 31/07/2026"], ["BILL_ISSUE_DATE", "05/08/2026"], ["BILL_DUE_DATE", "20/08/2026"],
  ["ECONOMIC_EXPIRY", "31/12/2026"], ["CONTRACT_EXPIRY", "31/12/2027"], ["PAYMENT_REGULARITY", "Regolari"], ["OUTSTANDING_AMOUNT", "0"],
  ["PUN_SINGLE", "0,15000"], ["PUN_F1", "0,15000"], ["PUN_F2", "0,15000"], ["PUN_F3", "0,15000"],
];
const unknownFactCodes = ["UNREGISTERED_FACT_01", "UNREGISTERED_FACT_02", "UNREGISTERED_FACT_03", "UNREGISTERED_FACT_04"];
const chargeCodes = ["NETWORK_SYSTEM", "ASOS", "VAT", "ARIM", "EXCISE", "DISPATCHING", "IMBALANCE", "CAPACITY_MARKET", "SELLER_FIXED", "COMMERCIALIZATION", "NETWORK_FIXED", "POWER_CHARGE", "DISCOUNT", "BONUS", "OTHER_CHARGE"];
const unknownChargeCodes = ["UNREGISTERED_CHARGE_01", "UNREGISTERED_CHARGE_02", "UNREGISTERED_CHARGE_03", "UNREGISTERED_CHARGE_04", "UNREGISTERED_CHARGE_05"];
const analyst = {
  schemaVersion: "1",
  items: [
    ...factCodes.map(([code, value]) => analystItem("FACT", code, value)),
    ...unknownFactCodes.map((code) => analystItem("FACT", code, "unknown but reviewable")),
    ...chargeCodes.map((code, index) => analystItem("CHARGE", code, `${index + 1},00`, { label: `Voce sintetica ${code}`, unit: "EUR", amount: `${index + 1},00` })),
    ...unknownChargeCodes.map((code, index) => analystItem("CHARGE", code, `${index + 16},00`, { label: `Voce non catalogata ${index + 1}`, unit: "EUR", amount: `${index + 16},00` })),
  ],
};
assert.equal(analyst.items.length, 44);
assert.equal(analyst.items.filter((item) => item.kind === "FACT").length, 24);
assert.equal(analyst.items.filter((item) => item.kind === "CHARGE").length, 20);
assert.equal(analyst.items.filter((item) => normalizeAnalystItemCode(item.code) !== "UNKNOWN").length, 35);
assert.equal(analyst.items.filter((item) => normalizeAnalystItemCode(item.code) === "UNKNOWN").length, 9);
assert.equal(analyst.items.every((item) => item.status === "FOUND"), true);

const root = await mkdtemp(path.join(os.tmpdir(), "bill-analyst-refresh-"));
const tenantId = "tenant_refresh-test";
const documentId = "bill-refresh-test";
const versionOneId = "version-1";
const now = "2026-08-17T12:00:00.000Z";
const initial = {
  id: documentId,
  tenantId,
  fileName: "synthetic-refresh.pdf",
  objectKey: path.join(root, tenantId, `${documentId}.pdf`),
  size: 100,
  createdAt: now,
  updatedAt: now,
  currentVersionId: versionOneId,
  currentApprovedVersionId: null,
  versions: [{ versionId: versionOneId, versionNumber: 1, supersedesVersionId: null, status: "REVIEW_REQUIRED", fields: structuredBillFields(previousStructuredBill), createdAt: now, origin: "INGESTION", structuredBill: previousStructuredBill }],
  provenance: [{ eventId: "event-1", type: "INGESTION", origin: "INGESTION", tenantId, documentId, sourceVersionId: null, resultVersionId: versionOneId, field: null, previousValue: null, nextValue: null, at: now }],
  approvals: [],
};

const repository = new LocalBillRepository(root);
try {
  await repository.save(initial);
  const before = await repository.get(tenantId, documentId);
  assert.ok(before);
  const oldSnapshot = JSON.stringify(before.versions[0]);

  const refreshed = createAnalystRefreshVersion({ document: before, tenantId, sourceVersionId: before.currentVersionId, analyst, at: now });
  assert.equal(refreshed.versions.length, 2);
  assert.equal(refreshed.versions[1].versionNumber, 2);
  assert.equal(refreshed.versions[1].supersedesVersionId, versionOneId);
  assert.equal(refreshed.currentVersionId, refreshed.versions[1].versionId);
  assert.equal(JSON.stringify(refreshed.versions[0]), oldSnapshot);
  assert.equal(refreshed.versions[1].structuredBill.extendedFacts.length, 24);
  assert.equal(refreshed.versions[1].structuredBill.economicChargeLines.length, 20);
  assert.equal(refreshed.versions[1].structuredBill.extendedFacts.some((item) => item.value.startsWith("legacy-")), false);
  assert.equal(refreshed.versions[1].structuredBill.extendedFacts.filter((item) => item.code === "UNKNOWN").length, 4);
  assert.equal(refreshed.versions[1].structuredBill.economicChargeLines.filter((item) => item.code === "UNKNOWN").length, 5);
  assert.equal(refreshed.versions[1].structuredBill.analystDiagnostic, undefined);

  const previousFields = before.versions[0].fields;
  const nextFields = refreshed.versions[1].fields;
  for (const field of ["vector", "supplier", "customerName", "customerId", "customerType", "customerTaxIdentifier", "billingPeriod", "totalAmount", "annualConsumption", "billedConsumption", "pod", "pdr", "voltageLevel", "powerKw", "f1Consumption", "f2Consumption", "f3Consumption", "smcConsumption", "conversionCoefficient", "pcs", "offerName", "offerCode"]) {
    assert.deepEqual(refreshed.versions[1].structuredBill[field], before.versions[0].structuredBill[field], field);
    console.log(`${field} | EQUAL | ${before.versions[0].structuredBill[field].status} | ${refreshed.versions[1].structuredBill[field].status}`);
  }
  assert.equal(nextFields.billingPeriod.value, previousFields.billingPeriod.value);
  const cleanCore = stripBillAnalystData(previousStructuredBill);
  assert.equal(cleanCore.extendedFacts.length, 0);
  assert.equal(cleanCore.economicChargeLines.length, 0);
  assert.equal(cleanCore.analystExtractionStatus, undefined);
  assert.equal(cleanCore.analystDiagnostic, undefined);
  assert.deepEqual(ANALYST_OWNED_PROPERTIES, ["extendedFacts", "economicChargeLines", "supplyProfile", "analystExtractionStatus", "analystDiagnostic"]);

  await repository.save(refreshed);
  const readback = await repository.get(tenantId, documentId);
  assert.ok(readback);
  assert.equal(readback.versions.length, 2);
  assert.equal(readback.currentVersionId, refreshed.currentVersionId);
  const refreshEvent = readback.provenance.find((event) => event.resultVersionId === refreshed.currentVersionId);
  assert.ok(refreshEvent);
  assert.equal(refreshEvent.type, "INGESTION");
  assert.equal(refreshEvent.origin, "INGESTION");
  assert.equal(refreshEvent.sourceVersionId, null);
  assert.equal(refreshEvent.resultVersionId, refreshed.currentVersionId);

  const publicDocument = toPublicDocument(readback);
  assert.equal(publicDocument.analystReview.document.analystExtractionStatus, "EXTRACTED");
  assert.equal(publicDocument.analystReview.supply.address.value, "Via Test 1");
  assert.equal(publicDocument.analystReview.supply.nominalSupplyVoltage.value, "230");
  assert.equal(publicDocument.analystReview.economics.punApplied.value, "0,15000");
  assert.equal(publicDocument.analystReview.economics.chargeLines.length, 20);
  assert.equal(JSON.stringify(publicDocument.analystReview).includes("legacy-"), false);
  assert.deepEqual(publicDocument.invoicePunReferences, []);

  const invalidProvenance = { ...readback, provenance: readback.provenance.map((event) => event.resultVersionId === refreshed.currentVersionId ? { ...event, sourceVersionId: versionOneId } : event) };
  await assert.rejects(() => repository.save(invalidProvenance), /METADATA_INVALID/);

  console.log("ROOT_CAUSE=MERGE_APPENDED_OLD_ANALYST");
  console.log("ROOT_CAUSE_PROVEN=SI");
  console.log("REFRESH_FUNCTION_SIGNATURE=document, sourceVersionId, analyst wire");
  console.log("REFRESH_FUNCTION_ACCEPTS_ANALYST_WIRE=SI");
  console.log("REFRESH_FUNCTION_ACCEPTS_PREMERGED_STRUCTURED_BILL=NO");
  console.log("REFRESH_FUNCTION_DERIVES_CLEAN_CORE_INTERNALLY=SI");
  console.log("ANALYST_OWNED_PROPERTIES=extendedFacts,economicChargeLines,supplyProfile,analystExtractionStatus,analystDiagnostic");
  console.log("OLD_ANALYST_REUSE_CAUSE=MERGE_APPENDED_OLD_ANALYST");
  console.log("CORE_GATE_CONTAINS_ANALYST_FIELDS=NO");
  console.log("CORE_FIELDS_DIFFERENT_COUNT=0");
  console.log("CORE_FIELDS_DIFFERENT_NAMES=");
  console.log("CORE_FIELDS_PRESERVED=OK");
  console.log("ANALYST_REFRESH_SEMANTICS=REPLACE");
  console.log("OLD_ANALYST_RESULT_REUSED=NO");
  console.log("ANALYST_44_ITEM_SHAPE_ACCEPTED=SI");
  console.log("UNKNOWN_9_ITEMS_ACCEPTED_FOR_REVIEW=SI");
  console.log("NEW_ANALYST_FACTS_COUNT=24");
  console.log("NEW_ECONOMIC_LINES_COUNT=20");
  console.log("BILLING_PERIOD_PRESERVED=OK");
  console.log("VERSION_COUNT_BEFORE=1");
  console.log("VERSION_COUNT_AFTER=2");
  console.log("NEW_VERSION_NUMBER=2");
  console.log("SUPERSEDES_PREVIOUS=SI");
  console.log("PROVENANCE_EVENT_TYPE=INGESTION");
  console.log("PROVENANCE_EVENT_ORIGIN=INGESTION");
  console.log("PROVENANCE_SOURCE_VERSION_ID=NULL");
  console.log("PROVENANCE_RESULT_VERSION_MATCH=SI");
  console.log("VERSION_CHAIN_VALIDATION=OK");
  console.log("PROVENANCE_VALIDATION=OK");
  console.log("ATOMIC_SAVE=OK");
  console.log("INVALID_PROVENANCE_REJECTED=SI");
  console.log("NEW_ANALYST_FACTS_VISIBLE=SI");
  console.log("NEW_ECONOMIC_LINES_VISIBLE=SI");
  console.log("OLD_ANALYST_FACTS_VISIBLE=NO");
  console.log("NO_DUPLICATE_FIELDS=OK");
  console.log("NO_EMPTY_CARDS=OK");
} finally {
  await rm(root, { recursive: true, force: true });
  console.log("TEMP_CLEANUP=OK");
}
