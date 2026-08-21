import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildDomesticResidentMatrix, classifyPhantomComponents } from "../app/lib/foundation/bill-domestic-resident-matrix.ts";
import { amountUnitConsistency, auditElectricityBill, identifyAmountUnitIssues } from "../app/lib/foundation/bill-regulatory-audit.ts";
import { referenceDomainOf } from "../app/lib/foundation/regulatory-domains.ts";

const billArchive = JSON.parse(await readFile("var/foundation-documents/metadata.json", "utf8"));
const bill = billArchive.documents.find((item) => item.id === "93d9b1f0-c748-4c66-ab32-b0673a96787e");
const current = bill.versions.find((item) => item.versionId === bill.currentVersionId);
const structured = current.structuredBill;
const regulatory = JSON.parse(await readFile("var/foundation-regulatory-data/records.json", "utf8")).regulatoryValues;
const profile = buildBillSupplyProfile(structured.extendedFacts);
const matrix = buildDomesticResidentMatrix({ profile, billingPeriod: structured.billingPeriod.value, chargeLines: structured.economicChargeLines, extendedFacts: structured.extendedFacts, regulatoryReferences: regulatory, gmeReferences: [{ month: "2026-07", f1: 154.2, f2: 169.38, f3: 152.26, unit: "EUR/MWH", sourceReference: "https://gme.mercatoelettrico.org/official.pdf", officialIdentifier: "gme-pun-2026-07" }], contractAvailable: false });

assert.equal(matrix.areraExpectedReferenceCount, 9);
assert.equal(matrix.areraAvailableReferenceCount, 9);
assert.equal(matrix.areraMissingReferenceCount, 0);
assert.deepEqual(matrix.areraMissingReferenceCodes, []);
assert.equal(matrix.coverage.ARERA_NETWORK_SOURCE_COVERAGE, "VERIFIED");
assert.equal(matrix.coverage.ARERA_NETWORK_BILL_AUDITABILITY, "DOCUMENT_DETAIL_REQUIRED");
assert.equal(matrix.coverage.ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE, "VERIFIED");
assert.notEqual(matrix.coverage.ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE, matrix.coverage.ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY);
console.log("SOURCE_COVERAGE_NOT_CONFLATED_WITH_AUDITABILITY=PASS");
console.log("ARERA_ALL_AVAILABLE_CAN_BE_SOURCE_VERIFIED=PASS");
console.log("AGGREGATED_BILL_DOES_NOT_DOWNGRADE_SOURCE_COVERAGE=PASS");

assert.equal(matrix.dispatchingReferenceCount, 3);
assert.equal(matrix.ternaDispatchingReferenceCount, 3);
assert.equal(regulatory.filter((item) => referenceDomainOf(item) === "DISPATCHING" && item.authority === "ARERA").length, 3);
assert.ok(matrix.components.some((item) => item.code === "DISPATCHING" && item.authority === "ARERA"));
console.log("DISPATCHING_DOMAIN_NOT_AUTHORITY_REGEX=PASS");
const arera587 = regulatory.filter((item) => item.officialIdentifier === "587/2025/R/eel");
assert.equal(arera587.length, 2);
assert.ok(arera587.every((item) => referenceDomainOf(item) === "DISPATCHING"));
console.log("ARERA_587_DISPATCHING_CLASSIFICATION=PASS");

assert.equal(matrix.capacityMarketReferenceCount, 1);
assert.equal(matrix.components.filter((item) => item.sourceValue?.referenceDomain === "CAPACITY_MARKET").length, 1);
assert.equal(matrix.components.find((item) => item.code === "CAPACITY_MARKET_OFF_PEAK")?.sourceValue?.normalizedValue, 0.003197);
assert.equal(matrix.components.some((item) => item.code === "CAPACITY_MARKET_PEAK"), false);
assert.equal(matrix.components.some((item) => item.code === "CAPACITY_MARKET"), false);
console.log("CAPACITY_REAL_STRUCTURE_ONLY=PASS");
assert.deepEqual(classifyPhantomComponents(regulatory).filter((item) => item.status === "OFFICIAL_REFERENCE_AVAILABLE").map((item) => item.code).sort(), ["CAPACITY_MARKET_OFF_PEAK", "DISPATCHING_TERNA_OPERATION"]);
console.log("NO_PHANTOM_TERNA_COMPONENTS=PASS");

assert.equal(matrix.pun.appliedDisplayValue, 0.196201);
assert.equal(matrix.pun.appliedDisplayUnit, "EUR/KWH");
assert.deepEqual(matrix.pun.source.map((item) => [item.band, item.displayValue, item.displayUnit]), [["F1", 0.1542, "EUR/KWH"], ["F2", 0.16938, "EUR/KWH"], ["F3", 0.15226, "EUR/KWH"]]);
console.log("PUN_EUR_KWH_UNCHANGED=PASS");

const issues = identifyAmountUnitIssues(structured.economicChargeLines);
assert.equal(issues.length, 2);
assert.deepEqual(issues.map((item) => [item.code, item.type, item.field, item.rootCause]), [
  ["AMOUNT_UNIT_QUANTITY_DURATION_COLLISION", "QUANTITY_PARSE_AMBIGUITY", "quantity", "AMBIGUOUS_EXTRACTION"],
  ["AMOUNT_UNIT_PERCENT_RATE_SCALE", "PERCENT_UNIT_PRICE_SCALE", "unitPrice", "OTHER:PERCENT_RATE_NOT_NORMALIZED"],
]);
assert.equal(amountUnitConsistency(structured.economicChargeLines.find((item) => item.code === "POWER_CHARGE")).status, "CONSISTENT");
assert.equal(amountUnitConsistency(structured.economicChargeLines.find((item) => item.code === "VAT")).status, "CONSISTENT");
console.log("AMOUNT_UNIT_ISSUES_ROOT_CAUSE=PASS");

const audit = auditElectricityBill({ vector: "EE", customerType: "RESIDENTIAL", domesticResidenceStatus: "PROVEN", billingPeriod: structured.billingPeriod.value, chargeLines: structured.economicChargeLines }, { regulatoryReferences: regulatory, appliedPunOriginalValue: 0.196201, appliedPunOriginalUnit: "EUR/KWH" });
assert.equal(audit.summary.confirmedAnomalyCount, 0);
assert.equal(audit.summary.overallStatus, "INCOMPLETE");
assert.equal(audit.coverage.billAuditability.ARERA_NETWORK, "NOT_AUDITABLE");
assert.ok(audit.supplyProfile && audit.coverage && Array.isArray(audit.referenceDetails));
console.log("ZERO_ANOMALIES_NOT_RENDERED_AS_REGULAR_WHEN_PARTIAL=PASS");
console.log("UI_MODEL_REFERENCE_DETAILS=PASS");
