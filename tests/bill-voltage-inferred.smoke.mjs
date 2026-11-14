import assert from "node:assert/strict";
import { prepareBillDrivenSimulation } from "../app/lib/calculation/bill-driven.ts";

const tenantId = "tenant_qa-company";
const otherTenantId = "tenant_other-company";
const principal = { userId: "qa_superadmin", tenantId, role: "ADMIN", sessionId: "session_local-dev", issuedAt: "2026-09-16T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" };
const billVersionId = "bill-qa-ee-v1";

const known = (value) => ({ status: "KNOWN", value });
const structuredFound = (value) => ({ value, status: "FOUND", confidence: 0.99, source: "DOCUMENT_AI" });
const structuredNotFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const billContract = (tenant = tenantId) => ({
  schemaVersion: 1, recordId: "bill-qa-ee::energy::bill-qa-ee-v1", version: "1", parentVersionId: null, tenantId: tenant,
  approval: { status: "DRAFT", reason: "BILL_PENDING_REVIEW" }, recordType: "BILL", billId: "bill-qa-ee", vector: "EE",
  billingPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, currentSupplier: "QA Supplier Current",
  customer: { customerId: "customer-qa-ee", customerType: "NON_RESIDENTIAL", name: known("QA Customer"), taxIdentifiers: [] },
  offer: { supplier: "QA Supplier Current", offerName: known("QA Current Offer"), offerCode: known("QA-CURRENT") }, regulatedCharges: [],
  fieldProvenance: [], reviewState: "APPROVED",
  supply: { vector: "EE", pod: "ITQA00000000001", voltageLevel: "LV" },
  consumption: { vector: "EE", f1: known(100), f2: known(50), f3: known(25), total: known(175) },
});

const structuredBill = {
  schemaVersion: 1,
  vector: structuredFound("EE"), supplier: structuredFound("QA Supplier Current"), customerName: structuredFound("QA Customer"), customerId: structuredFound("customer-qa-ee"), customerType: structuredFound("NON_RESIDENTIAL"), customerTaxIdentifier: structuredNotFound(),
  billingPeriod: structuredFound({ from: "2026-07-01", to: "2026-08-01" }), totalAmount: structuredFound(20), annualConsumption: structuredFound(2100), billedConsumption: structuredFound(175), pod: structuredFound("ITQA00000000001"), pdr: structuredNotFound(), voltageLevel: structuredFound("LV"), powerKw: structuredFound(10),
  f1Consumption: structuredFound(100), f2Consumption: structuredFound(50), f3Consumption: structuredFound(25), smcConsumption: structuredNotFound(), conversionCoefficient: structuredNotFound(), pcs: structuredNotFound(), offerName: structuredFound("QA Current Offer"), offerCode: structuredFound("QA-CURRENT"),
  extendedFacts: [
    { code: "SUPPLY_USE_CATEGORY_RAW", value: "Altri usi", status: "FOUND" },
    { code: "POWER_COMMITTED", value: "10 kW", status: "FOUND" },
    { code: "POWER_AVAILABLE", value: "10 kW", status: "FOUND" },
    { code: "VOLTAGE_CLASS_RAW", value: "BT", status: "FOUND" },
    { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Altri usi", status: "FOUND" },
  ],
  economicChargeLines: [],
};

const approvedBill = (tenant = tenantId) => ({
  id: "bill-qa-ee", tenantId, ownerUserId: "qa_superadmin", fileName: "qa-ee.pdf", objectKey: "qa-ee.pdf", size: 100,
  createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", currentVersionId: billVersionId,
  currentApprovedVersionId: billVersionId, lifecycleState: "ACTIVE", lifecycleVersion: 1,
  retention: { retentionClass: "FISCAL_DOCUMENT", policyId: "FISCAL_15_MONTHS", policyVersion: 2, archivedAt: null, deletionDueAt: null, deletedAt: null }, lifecycleHistory: [],
  versions: [{ versionId: billVersionId, versionNumber: 1, supersedesVersionId: null, status: "EXTRACTED", fields: {}, createdAt: "2026-09-16T00:00:00.000Z", origin: "INGESTION", energyContract: billContract(tenant), structuredBill }],
  provenance: [], approvals: [{ approvalId: "bill-approval-1", tenantId, documentId: "bill-qa-ee", versionId: billVersionId, versionNumber: 1, approvedAt: "2026-09-16T00:00:00.000Z", origin: "LOCAL_APPROVAL", supersedesApprovalId: null, actorId: "qa_superadmin", auditEventId: "audit-1" }],
});

const archive = (contract, archiveId = contract.cteId, versionId = `${archiveId}-version-1`) => ({
  archiveId, tenantId, cteId: contract.cteId, vector: contract.vector, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  currentWorkingVersionId: versionId, currentApprovedVersionId: versionId,
  versions: [{ versionId, versionNumber: 1, supersedesVersionId: null, status: "APPROVED", contract, createdAt: "2026-01-01T00:00:00.000Z" }],
  approvals: [{ approvalId: `${archiveId}-approval`, versionId, versionNumber: 1, decision: "APPROVED", reviewer: "qa_superadmin", decisionId: `${archiveId}-decision`, decidedAt: "2026-01-01T00:00:00.000Z", supersedesApprovalId: null }],
  history: [], commercialStatus: "ACTIVE",
});

// Tony (29/10, fattura dettagliata BPower): the detailed bill does not print the voltage. A household (6 kW, domestic) is
// in bassa tensione: the offer choice goes on with BT instead of asking to reload the PDF.
const bill = structuredClone(approvedBill());
const version = bill.versions[0];
version.energyContract.supply.voltageLevel = null;
version.energyContract.customer.customerType = "RESIDENTIAL";
version.structuredBill.customerType = structuredFound("RESIDENTIAL");
version.structuredBill.voltageLevel = structuredNotFound();
version.structuredBill.extendedFacts = [
  { code: "SUPPLY_USE_CATEGORY_RAW", value: "Domestico", status: "FOUND" },
  { code: "POWER_COMMITTED", value: "6 kW", status: "FOUND" },
  { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Residente", status: "FOUND" },
];
const business = structuredClone(approvedBill());
business.id = "bill-qa-ee-mt";
business.versions[0].energyContract.billId = business.id;
business.versions[0].energyContract.supply.voltageLevel = null;
business.versions[0].structuredBill.voltageLevel = structuredNotFound();
business.versions[0].structuredBill.extendedFacts = [{ code: "SUPPLY_USE_CATEGORY_RAW", value: "Altri usi", status: "FOUND" }, { code: "POWER_COMMITTED", value: "400 kW", status: "FOUND" }];
business.approvals[0].documentId = business.id;
const bills = new Map([[`${tenantId}:bill-qa-ee`, bill], [`${tenantId}:${business.id}`, business]]);
const repositories = {
  billRepository: { async get(tenant, id) { return bills.get(`${tenant}:${id}`) ?? null; }, async list(tenant) { return [...bills.values()].filter((item) => item.tenantId === tenant); } },
  foundationMemberships: { async list() { return []; } },
  cteArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
  marketArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
};
const prepared = await prepareBillDrivenSimulation(principal, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16");
assert.equal(prepared.context.supply.voltageLevel, "LV");
assert.equal(prepared.context.missingRequiredData.includes("voltageLevel"), false);
// A 400 kW business without the voltage on the bill still needs it read.
const mt = await prepareBillDrivenSimulation(principal, repositories, business.id, "EXCLUDED", "2026-09-16").catch((error) => error);
assert.equal(mt instanceof Error ? true : mt.context.missingRequiredData.includes("voltageLevel"), true);
console.log("bill voltage inferred ok");

// The same bill must also become a bill contract when it is read (structured reading without the voltage).
const { structuredBillContract, structuredBillContractIssue } = await import("../app/lib/ingestion/structured-bill.ts");
const reading = structuredClone(version.structuredBill);
const contract = structuredBillContract({ extraction: reading, tenantId, billId: "bill-qa-ee", versionId: "v-reading" });
assert.equal(contract?.supply.voltageLevel, "LV");
const bigBusiness = structuredClone(business.versions[0].structuredBill);
bigBusiness.powerKw = structuredFound(400);
assert.equal(structuredBillContract({ extraction: bigBusiness, tenantId, billId: "bill-qa-ee-mt", versionId: "v-mt" }), null);
assert.equal(structuredBillContractIssue(bigBusiness), "VOLTAGE_MISSING");
console.log("structured bill voltage inferred ok");
