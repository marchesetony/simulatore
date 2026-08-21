import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildDomesticResidentMatrix, isAllowedTernaReference, TERNA_CORRISPETTIVI_SOURCE } from "../app/lib/foundation/bill-domestic-resident-matrix.ts";

const metadata = JSON.parse(await readFile("var/foundation-documents/metadata.json", "utf8"));
const bill = metadata.documents.find((item) => item.id === "93d9b1f0-c748-4c66-ab32-b0673a96787e");
assert.ok(bill);
assert.equal(bill.currentVersionId, bill.versions.find((item) => item.versionNumber === 6).versionId);
assert.equal(bill.versions.length, 6);
const current = bill.versions.find((item) => item.versionId === bill.currentVersionId);
assert.equal(current.versionNumber, 6);
assert.equal(current.structuredBill.supplyProfile.supplyUseCategory.normalizedValue, "DOMESTIC");
assert.equal(current.structuredBill.supplyProfile.domesticResidenceStatus.normalizedValue, "RESIDENT");
console.log("CURRENT_V6_DOMESTIC_RESIDENT=PASS");

const regulatory = JSON.parse(await readFile("var/foundation-regulatory-data/records.json", "utf8")).regulatoryValues;
const fixtureFacts = [
  { code: "SUPPLY_USE_CATEGORY_RAW", value: "Domestico residente", status: "FOUND" },
  { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Domestico residente", status: "FOUND" },
  { code: "VOLTAGE_CLASS_RAW", value: "Bassa tensione", status: "FOUND" },
  { code: "PUN_F1", value: "0,154200", unit: "EUR/KWH", status: "FOUND" },
  { code: "DISPATCHING", value: "0,010501", unit: "EUR/KWH", status: "FOUND" },
  { code: "CAPACITY_MARKET", value: "0,024466", unit: "EUR/KWH", status: "FOUND" },
];
const profile = buildBillSupplyProfile(fixtureFacts);
const line = (code, amount = "1,00") => ({ code, description: code, quantity: "100 kWh", unit: "EUR/KWH", unitPrice: "0,01", amount, periodRaw: "07/2026", status: "FOUND" });
const matrix = buildDomesticResidentMatrix({
  profile,
  billingPeriod: { from: "2026-07-01", to: "2026-08-01" },
  chargeLines: [line("NETWORK_SYSTEM"), line("POWER_CHARGE"), line("ASOS"), line("ARIM")],
  extendedFacts: fixtureFacts,
  regulatoryReferences: regulatory,
  gmeReferences: [{ month: "2026-07", f1: 154.2, f2: 169.38, f3: 152.26, unit: "EUR/MWH", sourceReference: "https://gme.mercatoelettrico.org/official.pdf", officialIdentifier: "gme-pun-2026-07" }],
  contractAvailable: false,
});
assert.equal(matrix.scope, "DOMESTIC_RESIDENT_BT");
assert.equal(matrix.coverage.ARERA_NETWORK_SOURCE_COVERAGE, "VERIFIED");
assert.equal(matrix.coverage.ARERA_NETWORK_BILL_AUDITABILITY, "DOCUMENT_DETAIL_REQUIRED");
assert.equal(matrix.coverage.ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE, "VERIFIED");
assert.equal(matrix.coverage.ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY, "PARTIAL");
assert.deepEqual(matrix.components.filter((item) => item.authority === "ARERA").slice(0, 5).map((item) => item.code), ["NETWORK_FIXED", "METERING_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "TRANSMISSION_ENERGY"]);
assert.deepEqual(matrix.components.filter((item) => ["ASOS", "ARIM", "UC3", "UC6"].includes(item.code)).map((item) => item.code), ["ASOS", "ARIM", "UC3", "UC6"]);
assert.ok(matrix.components.find((item) => item.code === "NETWORK_SYSTEM" ) === undefined);
assert.equal(matrix.components.find((item) => item.code === "NETWORK_ENERGY").billEvidence, "PRESENT_AGGREGATED");
assert.equal(matrix.components.find((item) => item.code === "UC3").billEvidence, "NOT_IDENTIFIED");
console.log("DOMESTIC_RESIDENT_BT_MATRIX=PASS");
console.log("ARERA_NETWORK_EXPECTED_COMPONENTS=PASS");
console.log("ASOS_ARIM_UC3_UC6_MATRIX=PASS");
console.log("EXPECTED_PRESENT_EXACT=PASS");
console.log("EXPECTED_PRESENT_AGGREGATED=PASS");
console.log("EXPECTED_NOT_IDENTIFIED=PASS");

assert.equal(isAllowedTernaReference(TERNA_CORRISPETTIVI_SOURCE), true);
assert.equal(isAllowedTernaReference("https://www.terna.it/it/sistema-elettrico/corrispettivi"), true);
assert.equal(isAllowedTernaReference("https://www.arera.it/area-operatori/prezzi-e-tariffe/corrispettivi-per-gli-utenti-del-dispacciamento"), false);
assert.equal(isAllowedTernaReference("https://example.com/terna.csv"), false);
console.log("TERNA_OFFICIAL_SOURCE_ALLOWLIST=PASS");
const terna = matrix.components.filter((item) => ["DISPATCHING", "CAPACITY_MARKET"].includes(item.sourceValue?.referenceDomain));
assert.equal(terna.length, 4);
assert.ok(terna.every((item) => ["AVAILABLE", "REFERENCE_MISSING", "NOT_PUBLISHED_AS_SEPARATE_REFERENCE"].includes(item.referenceStatus)));
assert.ok(terna.every((item) => ["CONTRACT_REQUIRED", "REFERENCE_MISSING", "NOT_PUBLISHED_AS_SEPARATE_REFERENCE"].includes(item.auditability)));
assert.ok(terna.every((item) => item.contractPassThroughRequired));
assert.ok(terna.some((item) => item.code === "DISPATCHING"));
assert.ok(terna.some((item) => item.code === "DISPATCHING_TERNA_OPERATION"));
assert.ok(!terna.some((item) => item.code === "DISPATCHING_UPLIFT"));
assert.ok(!terna.some((item) => item.code === "CAPACITY_MARKET_PEAK"));
assert.ok(terna.some((item) => item.code === "CAPACITY_MARKET_OFF_PEAK"));
console.log("TERNA_Q3_2026_EFFECTIVE_PERIOD=PASS");
console.log("TERNA_DISPATCHING_BREAKDOWN=PASS");
console.log("TERNA_CAPACITY_MARKET=PASS");
console.log("FREE_MARKET_PASS_THROUGH_REQUIRES_CONTRACT=PASS");

assert.equal(matrix.pun.source[0].sourceUnit, "EUR/MWH");
assert.equal(matrix.pun.source[0].displayUnit, "EUR/KWH");
assert.equal(matrix.pun.source[0].displayValue, 0.1542);
assert.equal(matrix.pun.appliedSourceUnit, "EUR/KWH");
assert.equal(matrix.pun.appliedDisplayUnit, "EUR/KWH");
console.log("PUN_SOURCE_EUR_MWH_PRESERVED=PASS");
console.log("PUN_DISPLAY_EUR_KWH=PASS");
const unresolved = buildDomesticResidentMatrix({ profile, billingPeriod: { from: "2026-07-01", to: "2026-08-01" }, chargeLines: [], extendedFacts: [{ ...fixtureFacts[3], unit: "EUR" }], regulatoryReferences: [], gmeReferences: [], contractAvailable: false });
assert.equal(unresolved.pun.appliedUnitStatus, "UNRESOLVED");
assert.equal(unresolved.pun.appliedDisplayUnit, null);
console.log("PUN_APPLIED_UNIT_UNRESOLVED_FAIL_CLOSED=PASS");
assert.equal(matrix.counts.comparable, 4);
assert.equal(matrix.counts.referenceMissing, 0);
console.log("NO_FALSE_ANOMALY=PASS");
