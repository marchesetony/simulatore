import assert from "node:assert/strict";
import { prepareBillDrivenSimulation } from "../app/lib/calculation/bill-driven.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";

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

// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildHierarchyAccess, canAuthorizeCte, nodeCanAuthorizeCte, buildOrgChainIndex } from "../app/lib/hierarchy/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { grantEligibilityOverride } from "../app/lib/eligibility/override.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { prepareApprovedOffer } from "../app/lib/calculation/engine.ts";

// Tony (29/10, CAMELOT SRL contracted on Be Smile, left out by its annual consumption threshold): "devo avere la possibilità
// da amministratore di autorizzare qualsiasi cte, ed autorizzare a cascata chi può avere questa funzione nella organizzazione".
const fee = (feeId, label, amount, unit) => ({ feeId, label, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const fixed = { ...structuredClone(syntheticElectricityCte), recordId: "CTE_QA_BASE", cteId: "CTE_QA_BASE", tenantId,
  approval: { status: "APPROVED", reviewer: "qa", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "qa-approval" },
  supplier: { supplierId: "qa-supplier", name: "QA Supplier" }, offer: { offerId: "qa-offer", name: "QA Offer", code: "QA-BASE" },
  validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
  eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] },
  pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.2, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "DECLARED", component: fee("qa-spread", "Spread", 0.01, "EUR_PER_KWH") } },
  commercialTerms: { fixedFees: [fee("qa-fixed", "Fixed monthly fee", 4, "EUR_PER_MONTH")], variableFees: [], imbalance: { status: "DECLARED", component: fee("qa-imbalance", "Imbalance", 0.002, "EUR_PER_KWH") }, oneOffFees: [], commercialDiscounts: [] } };
const threshold = { ...structuredClone(fixed), cteId: "CTE_QA_THRESHOLD", offer: { ...fixed.offer, code: "QA-THRESHOLD" }, eligibility: { ...fixed.eligibility, annualConsumptionRule: { operator: ">", value: 50000, unit: "KWH_PER_YEAR", sourceEvidence: "Offerta riservata a consumi oltre 50.000 kWh/anno" } } };
const consumer = { ...structuredClone(fixed), cteId: "CTE_QA_CONSUMER", offer: { ...fixed.offer, code: "QA-CONSUMER" }, eligibility: { ...fixed.eligibility, customerTypes: ["RESIDENTIAL"] } };
const ctes = [archive(threshold), archive(consumer)];
const overrides = [];
const bills = new Map([[`${tenantId}:bill-qa-ee`, approvedBill()]]);
const repositories = {
  billRepository: { async get(tenant, id) { return bills.get(`${tenant}:${id}`) ?? null; }, async list(tenant) { return [...bills.values()].filter((bill) => bill.tenantId === tenant); } },
  foundationMemberships: { async list() { return []; } },
  cteArchiveRepository: { async get(tenant, id) { return ctes.find((record) => record.tenantId === tenant && record.archiveId === id) ?? null; }, async list(tenant) { return ctes.filter((record) => record.tenantId === tenant); }, async save() {} },
  marketArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
  eligibilityOverrides: { async list() { return overrides.map((payload) => ({ payload })); } },
};

// The consumption threshold is a commercial condition: it can be authorized for the bill.
const before = await prepareBillDrivenSimulation(principal, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16");
const left = before.candidates.find((item) => item.cteId === "CTE_QA_THRESHOLD");
assert.equal(left.finalStatus, "NOT_ELIGIBLE");
assert.deepEqual(left.reasonCodes, ["CONSUMPTION_THRESHOLD_MISMATCH"]);
assert.equal(left.overrideRequestable, true);
assert.equal(before.canAuthorizeCte, false);

// Once authorized for this bill version it is offered, marked as authorized.
overrides.push({ overrideId: "override_qa", tenantId, billId: "bill-qa-ee", billVersionId, cteId: "CTE_QA_THRESHOLD", requestedByUserId: "qa_superadmin", authorizedByUserId: "qa_superadmin", createdAt: "2026-09-16T00:00:00.000Z", authorizedAt: "2026-09-16T00:00:00.000Z", reason: "Contratto firmato", overrideScope: ["CONSUMPTION_THRESHOLD_MISMATCH"], originalMismatchReasons: ["CONSUMPTION_THRESHOLD_MISMATCH"], status: "AUTHORIZED", oneShot: false, grantedDirectly: true });
const after = await prepareBillDrivenSimulation(principal, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16");
assert.equal(after.candidates.find((item) => item.cteId === "CTE_QA_THRESHOLD").finalStatus, "ELIGIBLE_BY_OVERRIDE");

// The comparison calculates an authorized CTE although its customer rule leaves the bill out.
const request = { schemaVersion: 1, tenantId, vector: "EE", calculationDate: "2026-09-16", customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED" };
await assert.rejects(prepareApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, request, "CTE_QA_CONSUMER"), /CUSTOMER_NOT_ELIGIBLE/);
assert.equal((await prepareApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, request, "CTE_QA_CONSUMER", new Set(["CTE_QA_CONSUMER"]))).record.cteId, "CTE_QA_CONSUMER");

// Who may authorize: the company always; a manager only when granted and only while every manager above holds it too.
const node = (userId, level, parentUserId, canAuthorizeCte) => ({ tenantId, recordId: userId, version: 1, updatedAt: "2026-09-16T00:00:00.000Z", payload: { userId, level, parentUserId, displayName: null, limits: { vectors: null, customerCategories: null, excludedCteArchiveIds: [] }, ...(canAuthorizeCte ? { canAuthorizeCte } : {}), updatedBy: "qa" } });
const chain = [node("company", "AZIENDA", null), node("director", "DIRETTORE", "company", true), node("area", "AREA_MANAGER", "director", true), node("agent", "AGENTE", "area", false)];
const index = buildOrgChainIndex(chain);
assert.equal(nodeCanAuthorizeCte(index, "company"), true);
assert.equal(nodeCanAuthorizeCte(index, "area"), true);
assert.equal(nodeCanAuthorizeCte(index, "agent"), false);
const revoked = buildOrgChainIndex([chain[0], node("director", "DIRETTORE", "company", false), chain[2], chain[3]]);
assert.equal(nodeCanAuthorizeCte(revoked, "area"), false);
assert.equal(canAuthorizeCte(buildHierarchyAccess({ userId: "agent", tenantId, role: "SALES_OPERATOR" }, chain, [], "2026-09-16")), false);
assert.equal(canAuthorizeCte(buildHierarchyAccess({ userId: "area", tenantId, role: "SALES_MANAGER" }, chain, [], "2026-09-16")), true);

// An operator without the permission cannot authorize.
const agentRepositories = { ...repositories, foundationMemberships: { async list() { return [{ payload: { tenantId, userId: "agent", role: "SALES_OPERATOR", status: "ACTIVE" } }]; } }, orgChain: { async list() { return chain; } }, cteAssignments: { async list() { return []; } } };
await assert.rejects(grantEligibilityOverride({ ...principal, userId: "agent", role: "OPERATOR" }, agentRepositories, { billId: "bill-qa-ee", billVersionId, cteId: "CTE_QA_THRESHOLD", reason: "x", originalMismatchReasons: ["CONSUMPTION_THRESHOLD_MISMATCH"] }), /OVERRIDE_AUTHORIZATION_DENIED/);
// The quote offers "Autorizza" only to who holds the permission; the chain page sets who does.
const { readFileSync } = await import("node:fs");
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/components/HierarchyPanel.tsx", import.meta.url), "utf8");
assert.match(flow, /quote\.canAuthorizeCte && onAuthorize/);
assert.match(flow, /action: "grant"/);
assert.match(panel, /canAuthorizeCte: level !== "AZIENDA" && authorizeCte/);
console.log("cte authorization cascade ok");
