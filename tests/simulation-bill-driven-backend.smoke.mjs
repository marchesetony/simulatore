import assert from "node:assert/strict";
import { prepareBillDrivenSimulation, resolveBillDrivenExecution } from "../app/lib/calculation/bill-driven.ts";
import { CTE_EE_APPROVED_FIXED } from "./fixtures/cte-product-qa.ts";

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

const fixed = structuredClone(CTE_EE_APPROVED_FIXED.contract);
const wrongVoltage = { ...structuredClone(fixed), cteId: "CTE_QA_WRONG_VOLTAGE", offer: { ...fixed.offer, code: "QA-WRONG-VOLTAGE" }, eligibility: { ...fixed.eligibility, voltageLevels: ["MV"] } };
const wrongCustomer = { ...structuredClone(fixed), cteId: "CTE_QA_WRONG_CUSTOMER", offer: { ...fixed.offer, code: "QA-WRONG-CUSTOMER" }, eligibility: { ...fixed.eligibility, customerTypes: ["RESIDENTIAL"] } };
const expired = { ...structuredClone(fixed), cteId: "CTE_QA_EXPIRED", offer: { ...fixed.offer, code: "QA-EXPIRED" }, validity: { periodStart: "2025-01-01", periodEnd: "2026-06-01" }, expiry: { status: "EXPIRES_ON", date: "2026-06-01" } };

const bills = new Map([[`${tenantId}:bill-qa-ee`, approvedBill()]]);
const domesticHighPowerBill = structuredClone(approvedBill());
domesticHighPowerBill.id = "bill-qa-ee-domestic-20kw";
domesticHighPowerBill.currentVersionId = "bill-qa-ee-domestic-20kw-v1";
domesticHighPowerBill.currentApprovedVersionId = "bill-qa-ee-domestic-20kw-v1";
domesticHighPowerBill.versions[0].versionId = "bill-qa-ee-domestic-20kw-v1";
domesticHighPowerBill.versions[0].energyContract.billId = domesticHighPowerBill.id;
domesticHighPowerBill.versions[0].energyContract.customer.customerType = "RESIDENTIAL";
domesticHighPowerBill.versions[0].structuredBill.customerType = structuredFound("RESIDENTIAL");
domesticHighPowerBill.versions[0].structuredBill.extendedFacts = [
  { code: "SUPPLY_USE_CATEGORY_RAW", value: "Domestico", status: "FOUND" },
  { code: "POWER_COMMITTED", value: "20 kW", status: "FOUND" },
  { code: "POWER_AVAILABLE", value: "25 kW", status: "FOUND" },
  { code: "VOLTAGE_CLASS_RAW", value: "BT", status: "FOUND" },
  { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Residente", status: "FOUND" },
];
domesticHighPowerBill.approvals[0].documentId = domesticHighPowerBill.id;
domesticHighPowerBill.approvals[0].versionId = "bill-qa-ee-domestic-20kw-v1";
bills.set(`${tenantId}:${domesticHighPowerBill.id}`, domesticHighPowerBill);
const ctes = [archive(fixed), archive(wrongVoltage), archive(wrongCustomer), archive(expired)];
const repositories = {
  billRepository: { async get(tenant, id) { return bills.get(`${tenant}:${id}`) ?? null; }, async list(tenant) { return [...bills.values()].filter((bill) => bill.tenantId === tenant); } },
  foundationMemberships: { async list() { return []; } },
  cteArchiveRepository: { async get(tenant, id) { return ctes.find((record) => record.tenantId === tenant && record.archiveId === id) ?? null; }, async list(tenant) { return ctes.filter((record) => record.tenantId === tenant); }, async save() {} },
  marketArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
};

const prepared = await prepareBillDrivenSimulation(principal, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16");
assert.equal(prepared.context.tenantId, tenantId);
assert.equal(prepared.context.billVersionId, billVersionId);
assert.equal(prepared.context.customerType, "NON_RESIDENTIAL");
assert.equal(prepared.context.supply.pod, "ITQA00000000001");
assert.deepEqual(prepared.context.consumption.period, { f1: 100, f2: 50, f3: 25, smc: null });
assert.equal(prepared.context.contractExpiry.status, "UNKNOWN");
assert.equal(prepared.context.classification.status, "READY");
assert.equal(prepared.candidates.find((item) => item.cteId === fixed.cteId)?.eligibilityStatus, "COMPATIBLE");
assert.equal(prepared.candidates.find((item) => item.cteId === wrongVoltage.cteId)?.compatibilityReason, "VOLTAGE_NOT_ELIGIBLE");
assert.equal(prepared.candidates.find((item) => item.cteId === wrongCustomer.cteId)?.compatibilityReason, "CUSTOMER_NOT_ELIGIBLE");
assert.equal(prepared.candidates.find((item) => item.cteId === expired.cteId)?.compatibilityReason, "CTE_EXPIRED");

const domesticPrepared = await prepareBillDrivenSimulation(principal, repositories, domesticHighPowerBill.id, "EXCLUDED", "2026-09-16");
assert.equal(domesticPrepared.context.classification.regulatoryCustomerScope, "DOMESTIC_RESIDENT_BT");
assert.equal(domesticPrepared.context.classification.bta6Eligible, false);
assert.deepEqual(domesticPrepared.context.alerts.map((alert) => alert.code), ["DOMESTIC_HIGH_COMMITTED_POWER"]);

const resolved = await resolveBillDrivenExecution(principal, repositories, { billId: "bill-qa-ee", billVersionId, cteId: fixed.cteId, cteVersionId: `${fixed.cteId}-version-1`, taxTreatment: "EXCLUDED", calculationDate: "2026-09-16" });
assert.deepEqual(resolved.binding, { tenantId, userId: "qa_superadmin", billId: "bill-qa-ee", billVersionId, selectedCteId: fixed.cteId, selectedCteVersionId: `${fixed.cteId}-version-1` });
assert.equal(resolved.simulation.vector, "EE");
assert.equal(resolved.simulation.customerCategory, "NON_RESIDENTIAL");
assert.equal(resolved.simulation.voltageLevel, "LV");
assert.deepEqual(resolved.simulation.consumption, { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 25 });

await assert.rejects(() => resolveBillDrivenExecution(principal, repositories, { billId: "bill-qa-ee", billVersionId: "tampered-version", cteId: fixed.cteId, cteVersionId: `${fixed.cteId}-version-1`, taxTreatment: "EXCLUDED", calculationDate: "2026-09-16" }), (error) => error.code === "SOURCE_BILL_VERSION_MISMATCH");
await assert.rejects(() => resolveBillDrivenExecution(principal, repositories, { billId: "bill-qa-ee", billVersionId, cteId: fixed.cteId, cteVersionId: "tampered-cte-version", taxTreatment: "EXCLUDED", calculationDate: "2026-09-16" }), (error) => error.code === "CTE_VERSION_MISMATCH");
await assert.rejects(() => prepareBillDrivenSimulation({ ...principal, tenantId: otherTenantId }, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16"), (error) => error.code === "SOURCE_BILL_NOT_FOUND");

console.log("SIMULATION_BILL_SELECTOR_BACKEND=PASS");
console.log("BILL_DERIVED_CONTEXT=PASS");
console.log("CTE_ELIGIBILITY_FILTER=PASS");
console.log("SOURCE_VERSION_BINDING=PASS");
console.log("FAIL_CLOSED_TAMPERING=PASS");
console.log("TENANT_VISIBILITY_GUARD=PASS");
console.log("DOMESTIC_ALERT_SERVER_AUTHORITATIVE=PASS");
console.log("DOMESTIC_20KW_DOES_NOT_BECOME_BTA6=PASS");
