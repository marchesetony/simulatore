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

// Tony (29/10, CAMELOT SRL: "la BE SMILE non la propone, ed è presente in archivio"): a CTE of the bill's commodity that
// is in the archive but cannot be offered is listed with its reason, never silently dropped.
const draft = (cteId, vector, name) => ({
  archiveId: cteId, tenantId, cteId, vector, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  currentWorkingVersionId: `${cteId}-v1`, currentApprovedVersionId: null,
  versions: [{ versionId: `${cteId}-v1`, versionNumber: 1, supersedesVersionId: null, status: "REVIEW", contract: { cteId, vector, supplier: { name: "QA Supplier" }, offer: { name, code: `${cteId}-code` } }, createdAt: "2026-01-01T00:00:00.000Z" }],
  approvals: [], history: [], commercialStatus: "ACTIVE",
});
const deleted = { ...draft("cte-deleted", "EE", "QA Deleted"), commercialStatus: "DELETED", deletedAt: "2026-02-01T00:00:00.000Z" };
const records = [draft("cte-smile", "EE", "QA SMILE"), draft("cte-gas", "GAS", "QA Gas"), deleted];
const bills = new Map([[`${tenantId}:bill-qa-ee`, approvedBill()]]);
const repositories = {
  billRepository: { async get(tenant, id) { return bills.get(`${tenant}:${id}`) ?? null; }, async list(tenant) { return [...bills.values()].filter((item) => item.tenantId === tenant); } },
  foundationMemberships: { async list() { return []; } },
  cteArchiveRepository: { async get() { return null; }, async list() { return records; }, async save() {} },
  marketArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
};
const prepared = await prepareBillDrivenSimulation(principal, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16");
assert.deepEqual(prepared.unlisted, [{ archiveId: "cte-smile", supplier: "QA Supplier", offer: { name: "QA SMILE", code: "cte-smile-code" }, reason: "NOT_APPROVED" }]);
assert.equal(prepared.candidates.length, 0);

// The quote page shows them in the list of CTEs not usable for the bill.
const { readFileSync } = await import("node:fs");
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /NOT_APPROVED: "CTE non ancora approvata in archivio"/);
assert.match(flow, /const rows = \[\.\.\.evaluated, \.\.\.unlisted\]/);
console.log("unlisted cte reasons ok");
