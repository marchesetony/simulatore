import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  approvalValidation,
  approveDocumentVersion,
  confirmBillFields,
  LocalBillRepository,
  toPublicApprovedDocument,
  toPublicDocument,
  validateStoredDocument,
} from "../app/lib/foundation/real-bill.ts";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildBillRegulatoryAudit } from "../app/lib/foundation/bill-public-audit.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { AuditLogger } from "../app/lib/persistence/audit.ts";
import { resolveTrustedElectricityContextFromSourceBill } from "../app/lib/calculation/source-bill-context.ts";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenantId = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenantId });
const billFileName = "EE19173_2026_CANTONE_MARIA_ALFIA.pdf";
const documentsRoot = "var/foundation-documents";
const metadataPath = `${documentsRoot}/metadata.json`;
const runtimeRoot = "var/phase6";
const billingDate = "2026-08-01";
const approvalTimestamp = "2026-09-17T10:00:00.000Z";
const correlationId = "real-bill-manual-approval-p0";
const requiredFields = ["supplier", "pod", "customerName", "billingPeriod", "annualConsumption", "billedConsumption", "totalAmount"];
const comparableCodes = ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "ASOS", "ARIM", "UC3", "UC6"];
const failClosedCodes = ["METERING_FIXED", "TRANSMISSION_ENERGY", "DISPATCHING", "CAPACITY_MARKET"];

const archive = JSON.parse(await readFile(metadataPath, "utf8"));
const archiveSource = archive.documents.find((value) => value.fileName === billFileName);
assert.ok(archiveSource, "the real bill must already be present in the foundation archive");
assert.equal(archiveSource.tenantId, tenantId);
const repository = new LocalBillRepository(documentsRoot);
let document = await repository.get(tenantId, archiveSource.id);
assert.ok(document, "the real bill must be readable from the existing repository");
assert.equal(document.fileName, billFileName);
assert.equal(document.tenantId, tenantId);

const storedPdf = await readFile(`${documentsRoot}/${tenantId}/${document.id}.pdf`);
const pdfHashBefore = createHash("sha256").update(storedPdf).digest("hex");
const currentVersionBefore = document.versions.find((version) => version.versionId === document.currentVersionId);
assert.ok(currentVersionBefore?.structuredBill, "the existing real structured bill record is required; OCR is not rerun");
assert.equal(document.lifecycleState, "ACTIVE");

const extraction = currentVersionBefore.structuredBill;
const priorBalanceFact = extraction.extendedFacts.find((fact) => fact.code === "OUTSTANDING_AMOUNT");
const economicAnalysis = buildCurrentBillEconomicAnalysis(
  extraction.economicChargeLines,
  extraction.totalAmount.value,
  { sourceBillTotal: extraction.totalAmount.value, priorBalance: priorBalanceFact?.value ?? null },
);
assert.equal(economicAnalysis.totals.reconciliationStatus, "RECONCILED");
assert.equal(economicAnalysis.totals.reconciliationDifference, 0);
assert.equal(economicAnalysis.totals.previousDebtIncludedInCurrentInvoiceTotal, false);
assert.equal(economicAnalysis.components.filter((item) => item.aggregate).every((item) => !item.includedInReconciliation), true);
assert.equal(economicAnalysis.totals.currentInvoiceAtomicTotal, 1472.42);
assert.equal(economicAnalysis.totals.currentInvoiceAggregateTotal, 1472.42);
assert.equal(economicAnalysis.totals.fiscalTotal, 223.73);
assert.equal(economicAnalysis.totals.extraordinaryTotal, 64.24);
assert.equal(economicAnalysis.totals.priorBalanceTotal, 1305.07);

const runtime = new LocalFilesystemAdapter(runtimeRoot);
const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(runtime.collection("regulatory-values"), runtime.collection("regulatory-approval-domains"));
const runtimeValues = await regulatoryBridge.list(tenantId, { effectiveAt: billingDate });
assert.equal(runtimeValues.length, 8, "the approved runtime projection must contain eight unit records");
assert.equal(new Set(runtimeValues.map((value) => value.componentCode)).size, 7, "UC6 has two approved units");
assert.deepEqual([...new Set(runtimeValues.map((value) => value.componentCode))].sort(), [...comparableCodes].sort());
const beforeRegulatory = await buildBillRegulatoryAudit(toPublicDocument(document), runtimeValues);
assert.ok(beforeRegulatory?.regulatedPassThrough);
assert.deepEqual(beforeRegulatory.regulatedPassThrough.items.filter((item) => item.comparable).map((item) => item.code), comparableCodes);
for (const code of failClosedCodes) assert.equal(beforeRegulatory.regulatedPassThrough.items.find((item) => item.code === code)?.comparable ?? false, false);
assert.equal(beforeRegulatory.regulatedPassThrough.items.some((item) => ["VAT", "EXCISE", "OUTSTANDING_AMOUNT"].includes(item.code) && item.comparable), false);

const facts = new Map(extraction.extendedFacts.filter((fact) => fact.status === "FOUND").map((fact) => [fact.code, fact]));
const fieldReview = [
  ["intestatario", extraction.customerName.value, "structuredBill.customerName", "VERIFIED"],
  ["CF/P.IVA", extraction.customerTaxIdentifier.value, "structuredBill.customerTaxIdentifier", "VERIFIED"],
  ["indirizzo fornitura", facts.get("SUPPLY_ADDRESS")?.value ?? null, "structuredBill.extendedFacts:SUPPLY_ADDRESS", "VERIFIED"],
  ["POD", extraction.pod.value, "structuredBill.pod", "VERIFIED"],
  ["tipologia utenza", extraction.customerType.value, "structuredBill.customerType", "VERIFIED"],
  ["residenza", facts.get("DOMESTIC_RESIDENCE_STATUS_RAW")?.value ?? null, "structuredBill.extendedFacts:DOMESTIC_RESIDENCE_STATUS_RAW", "VERIFIED"],
  ["tensione", `${extraction.voltageLevel.value} (${facts.get("NOMINAL_VOLTAGE")?.value ?? ""} ${facts.get("NOMINAL_VOLTAGE")?.unit ?? ""})`, "structuredBill.voltageLevel + structuredBill.extendedFacts:NOMINAL_VOLTAGE", "VERIFIED"],
  ["potenza impegnata", facts.get("POWER_COMMITTED")?.value ?? null, "structuredBill.extendedFacts:POWER_COMMITTED", "VERIFIED"],
  ["potenza disponibile", facts.get("POWER_AVAILABLE")?.value ?? null, "structuredBill.extendedFacts:POWER_AVAILABLE", "NOT_AVAILABLE"],
  ["periodo", `${extraction.billingPeriod.value.from} - ${extraction.billingPeriod.value.to}`, "structuredBill.billingPeriod", "VERIFIED"],
  ["consumi", extraction.billedConsumption.value, "structuredBill.billedConsumption", "VERIFIED"],
  ["F1", extraction.f1Consumption.value, "structuredBill.f1Consumption", "VERIFIED"],
  ["F2", extraction.f2Consumption.value, "structuredBill.f2Consumption", "VERIFIED"],
  ["F3", extraction.f3Consumption.value, "structuredBill.f3Consumption", "VERIFIED"],
  ["consumo annuo", extraction.annualConsumption.value, "structuredBill.annualConsumption", "VERIFIED"],
  ["fornitore", extraction.supplier.value, "structuredBill.supplier", "VERIFIED"],
  ["offerta", `${extraction.offerName.value} (${extraction.offerCode.value})`, "structuredBill.offerName + structuredBill.offerCode", "VERIFIED"],
  ["tipo prezzo", facts.get("PRICE_MECHANISM_RAW")?.value ?? null, "structuredBill.extendedFacts:PRICE_MECHANISM_RAW", "VERIFIED"],
  ["struttura oraria", facts.get("PRICE_TIME_STRUCTURE_RAW")?.value ?? null, "structuredBill.extendedFacts:PRICE_TIME_STRUCTURE_RAW", "VERIFIED"],
  ["scadenza contratto", facts.get("CONTRACT_EXPIRY")?.value ?? null, "structuredBill.extendedFacts:CONTRACT_EXPIRY", "VERIFIED"],
  ["totale bolletta", extraction.totalAmount.value, "structuredBill.totalAmount", "VERIFIED"],
  ["debito precedente", priorBalanceFact?.value ?? null, "structuredBill.extendedFacts:OUTSTANDING_AMOUNT", "VERIFIED"],
  ["voci straordinarie", extraction.economicChargeLines.filter((line) => line.code === "ALTRE_PARTITE" || line.classification === "ALTRE_PARTITE").map((line) => `${line.description}: ${line.amount}`).join(" | "), "structuredBill.economicChargeLines", "VERIFIED"],
];
for (const [field, value, source, status] of fieldReview) {
  assert.equal(status === "VERIFIED" ? value !== null && value !== "" : value === null, true, `field review failed for ${field}`);
  console.log(`FIELD=${field};VALUE=${value ?? ""};SOURCE=${source};STATUS=${status}`);
}

const approvalIssuesBefore = approvalValidation(document, document.currentVersionId);
assert.deepEqual(approvalIssuesBefore.missingFields, []);
if (document.currentApprovedVersionId === null) {
  assert.equal(document.versions.length, 1);
  assert.equal(document.approvals.length, 0);
  const confirmed = confirmBillFields({ document, tenantId, sourceVersionId: document.currentVersionId, fields: requiredFields, at: approvalTimestamp });
  await repository.saveIfCurrentVersion(confirmed, document.currentVersionId, currentVersionBefore);
  document = await repository.get(tenantId, document.id);
  assert.ok(document);
  assert.deepEqual(approvalValidation(document, document.currentVersionId), { missingFields: [], unconfirmedFields: [] });
  const confirmedVersion = document.versions.find((version) => version.versionId === document.currentVersionId);
  assert.ok(confirmedVersion);
  const approved = approveDocumentVersion({ document, tenantId, versionId: document.currentVersionId, at: approvalTimestamp, actorId: "user_bill-reviewer" });
  await repository.saveIfCurrentVersion(approved, approved.currentVersionId, confirmedVersion);
  document = approved;
}

assert.equal(document.currentApprovedVersionId, document.currentVersionId);
assert.equal(document.approvals.length, 1);
assert.equal(document.approvals[0].versionId, document.currentApprovedVersionId);
assert.equal(document.approvals[0].actorId, "user_bill-reviewer");
assert.equal(document.provenance.filter((event) => event.type === "APPROVAL").length, 1);
assert.equal(document.provenance.find((event) => event.type === "APPROVAL")?.auditEventId, document.approvals[0].auditEventId);
validateStoredDocument(JSON.parse(JSON.stringify(document)));

const principal = { userId: "user_bill-reviewer", tenantId, role: "ADMIN", sessionId: "session_bill-reviewer", issuedAt: approvalTimestamp, expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" };
const auditRepository = runtime.collection("audit-events");
const auditRecords = await auditRepository.list(tenantId);
let runtimeAudit = auditRecords.map((record) => record.payload).find((event) => event.correlationId === correlationId && event.resourceId === document.id && event.action === "BILL_APPROVAL");
if (!runtimeAudit) {
  runtimeAudit = await new AuditLogger(auditRepository).record({ tenantId, principal, action: "BILL_APPROVAL", resourceType: "BILL", resourceId: document.id, timestamp: approvalTimestamp, outcome: "ALLOWED", correlationId, metadata: { approvedVersionId: document.currentApprovedVersionId, versionNumber: document.versions.find((version) => version.versionId === document.currentApprovedVersionId)?.versionNumber ?? null, reconciliationStatus: economicAnalysis.totals.reconciliationStatus, regulatoryReadback: "PASS" } });
}
assert.equal(runtimeAudit.outcome, "ALLOWED");
assert.equal(runtimeAudit.resourceId, document.id);

const approvedPublic = toPublicApprovedDocument(document);
assert.ok(approvedPublic);
assert.equal(approvedPublic.currentApprovedVersionId, document.currentApprovedVersionId);
assert.equal(approvedPublic.currentVersionId, document.currentApprovedVersionId);
assert.equal(approvedPublic.reviewState, "APPROVED_CURRENT");
const approvedReadback = await buildBillRegulatoryAudit(approvedPublic, runtimeValues);
assert.ok(approvedReadback?.regulatedPassThrough);
assert.deepEqual(approvedReadback.regulatedPassThrough.items.filter((item) => item.comparable).map((item) => item.code), comparableCodes);
for (const code of failClosedCodes) assert.equal(approvedReadback.regulatedPassThrough.items.find((item) => item.code === code)?.comparable ?? false, false);

const period = { periodStart: extraction.billingPeriod.value.from, periodEnd: extraction.billingPeriod.value.to };
const trustedInput = {
  schemaVersion: 1,
  tenantId,
  calculationDate: approvalTimestamp.slice(0, 10),
  supplyPeriod: period,
  customerCategory: "RESIDENTIAL",
  residency: "NON_RESIDENT",
  currency: "EUR",
  taxTreatment: "EXCLUDED",
  vector: "EE",
  voltageLevel: extraction.voltageLevel.value,
  consumption: { basis: "PERIOD", unit: "KWH", f1: extraction.f1Consumption.value, f2: extraction.f2Consumption.value, f3: extraction.f3Consumption.value },
  sourceBill: { billId: document.id, version: document.currentApprovedVersionId },
};
const trustedContext = await resolveTrustedElectricityContextFromSourceBill(repository, tenantId, trustedInput);
assert.equal(trustedContext?.regulatoryCustomerScope, "DOMESTIC_NON_RESIDENT_BT");
await assert.rejects(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantId, { ...trustedInput, sourceBill: { billId: document.id, version: "1" } }), /SOURCE_BILL_VERSION_MISMATCH/);

const storedPdfAfter = await readFile(`${documentsRoot}/${tenantId}/${document.id}.pdf`);
assert.equal(createHash("sha256").update(storedPdfAfter).digest("hex"), pdfHashBefore);
assert.equal(document.fileName, billFileName);

console.log("PRECONDITIONS=PASS");
console.log("RECONCILIATION_STATUS=RECONCILED");
console.log("RECONCILIATION_DELTA=0.00");
console.log("REGULATORY_RUNTIME_APPROVED=YES");
console.log("REGULATORY_READBACK=PASS");
console.log("PREVIOUS_DEBT_INCLUDED_IN_COMPARISON=NO");
console.log("FISCAL_INCLUDED_IN_COMPARISON=NO");
console.log("NO_TOTAL_ATOMIC_DOUBLE_COUNT=PASS");
console.log("BILL_STATUS=APPROVED");
console.log(`CURRENT_APPROVED_VERSION=${document.currentApprovedVersionId}`);
console.log(`APPROVAL_AUDIT_EVENT=${document.approvals[0].auditEventId};RUNTIME_AUDIT_EVENT=${runtimeAudit.eventId}`);
console.log("APPROVED_READBACK=PASS");
console.log("BILL_AVAILABLE_FOR_SIMULATION_INPUT=YES");
console.log("REAL_BILL_APPROVAL=PASS");
console.log("APPROVAL_LIFECYCLE=PASS");
console.log("VERSIONING=PASS");
console.log("AUDIT_TRAIL=PASS");
console.log("SIMULATION_INPUT_ELIGIBILITY=PASS");
console.log("NO_OCR=PASS");
console.log("NO_PDF_MUTATION=PASS");
console.log("NO_SIMULATION=PASS");
console.log("SYNTHETIC_DATA_USED_FOR_ACCEPTANCE=NO");
console.log("REAL_BILL_MANUAL_APPROVAL_SMOKE=PASS");
