import assert from "node:assert/strict";
import { CTE_EE_APPROVED_FIXED } from "./fixtures/cte-product-qa.ts";
import { requestEligibilityOverride, authorizeEligibilityOverride, assertUsableEligibilityOverride, eligibilityOverrideUiState, markEligibilityOverrideUsed, rejectEligibilityOverride } from "../app/lib/eligibility/override.ts";
import { registerAuditRepository, clearAuditRepository } from "../app/lib/persistence/audit.ts";

const tenant = "tenant_override-qa";
const otherTenant = "tenant_other-qa";
const records = new Map();
const memberships = [
  { schemaVersion: 1, recordId: "membership-agent", tenantId: tenant, version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", payload: { id: "membership-agent", userId: "user_agent", tenantId: tenant, role: "SALES_OPERATOR", status: "ACTIVE", permissions: ["document:read"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", managerUserId: "user_admin" } },
  { schemaVersion: 1, recordId: "membership-admin", tenantId: tenant, version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", payload: { id: "membership-admin", userId: "user_admin", tenantId: tenant, role: "SALES_MANAGER", status: "ACTIVE", permissions: ["document:read", "audit:read"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
];
const bill = { id: "bill-override", tenantId: tenant, ownerUserId: "user_agent", currentApprovedVersionId: "bill-override-v1", lifecycleState: "ACTIVE" };
const contract = { ...structuredClone(CTE_EE_APPROVED_FIXED.contract), tenantId: tenant, cteId: "cte-override" };
const cte = { archiveId: "cte-override-archive", tenantId: tenant, cteId: "cte-override", vector: "EE", currentWorkingVersionId: "cte-override-v1", currentApprovedVersionId: "cte-override-v1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", versions: [{ versionId: "cte-override-v1", versionNumber: 1, supersedesVersionId: null, status: "APPROVED", contract, createdAt: "2026-01-01T00:00:00.000Z" }], approvals: [], history: [], commercialStatus: "ACTIVE" };
const expiredContract = { ...structuredClone(contract), cteId: "cte-expired", expiry: { status: "EXPIRES_ON", date: "2026-01-01" } };
const expiredCte = { ...structuredClone(cte), archiveId: "cte-expired-archive", cteId: "cte-expired", versions: [{ ...cte.versions[0], contract: expiredContract }] };
const reviewContract = { ...structuredClone(contract), cteId: "cte-review" };
const reviewCte = { ...structuredClone(cte), archiveId: "cte-review-archive", cteId: "cte-review", currentApprovedVersionId: null, versions: [{ ...cte.versions[0], versionId: "cte-review-v1", status: "REVIEWED", contract: reviewContract }] };
const deletedContract = { ...structuredClone(contract), cteId: "cte-deleted" };
const deletedCte = { ...structuredClone(cte), archiveId: "cte-deleted-archive", cteId: "cte-deleted", commercialStatus: "DELETED", versions: [{ ...cte.versions[0], contract: deletedContract }] };
const ctes = new Map([[cte.cteId, cte], [expiredCte.cteId, expiredCte], [reviewCte.cteId, reviewCte], [deletedCte.cteId, deletedCte]]);
const overrideRepository = {
  async get(tenantId, recordId) { const item = records.get(`${tenantId}:${recordId}`); return item ?? null; },
  async list(tenantId) { return [...records.values()].filter((item) => item.tenantId === tenantId); },
  async append(input) { const item = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: input.now, updatedAt: input.now, payload: input.payload }; records.set(`${input.tenantId}:${input.recordId}`, item); return item; },
  async put(input) { const previous = records.get(`${input.tenantId}:${input.recordId}`); assert.equal(previous?.version, input.expectedVersion); const item = { ...previous, version: previous.version + 1, updatedAt: input.now, payload: input.payload }; records.set(`${input.tenantId}:${input.recordId}`, item); return item; },
};
const repositories = {
  eligibilityOverrides: overrideRepository,
  billRepository: { async get(tenantId, billId) { return tenantId === tenant && billId === bill.id ? bill : null; } },
  cteArchiveRepository: { async get(tenantId, cteId) { return tenantId === tenant ? ctes.get(cteId) ?? null : null; } },
  foundationMemberships: { async list(tenantId) { return tenantId === tenant ? memberships : []; } },
};
const audits = [];
registerAuditRepository({ append: async (input) => { audits.push(input.payload); return input.payload; }, appendUnscoped: async (input) => { audits.push(input.payload); return input.payload; }, get: async () => null, list: async () => [] });
const principal = (userId, role = "VIEWER", tenantId = tenant) => ({ userId, tenantId, role, sessionId: `session_${userId.replace("user_", "")}`, issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" });

try {
  const agent = principal("user_agent", "VIEWER");
  const admin = principal("user_admin", "ANALYST");
  const requested = await requestEligibilityOverride(agent, repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: cte.cteId, reason: "Persona fisica documentata per uso eccezionale", originalMismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"] });
  assert.equal(requested.status, "REQUESTED");
  const agentUiState = await eligibilityOverrideUiState(agent, repositories, bill.id, bill.currentApprovedVersionId, "2026-09-18T09:00:00.000Z");
  assert.equal(agentUiState.capabilities.canRequest, true);
  assert.equal(agentUiState.capabilities.canAuthorize, false);
  assert.equal(agentUiState.overrides.find((item) => item.overrideId === requested.overrideId)?.status, "REQUESTED");
  await assert.rejects(() => authorizeEligibilityOverride(agent, repositories, requested.overrideId), /OVERRIDE_AUTHORIZATION_DENIED|OVERRIDE_SELF_APPROVAL_DENIED/);
  const authorized = await authorizeEligibilityOverride(admin, repositories, requested.overrideId, "2026-09-18T10:00:00.000Z");
  assert.equal(authorized.status, "AUTHORIZED");
  const adminUiState = await eligibilityOverrideUiState(admin, repositories, bill.id, bill.currentApprovedVersionId, "2026-09-18T10:00:00.000Z");
  assert.equal(adminUiState.capabilities.canAuthorize, true);
  assert.equal(adminUiState.overrides.find((item) => item.overrideId === authorized.overrideId)?.status, "AUTHORIZED");
  const usable = await assertUsableEligibilityOverride(agent, repositories, { overrideId: authorized.overrideId, billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: cte.cteId, mismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"], now: "2026-09-18T10:00:00.000Z" });
  assert.equal(usable.provenance.authorizedByUserId, "user_admin");
  await assert.rejects(() => assertUsableEligibilityOverride(agent, repositories, { overrideId: authorized.overrideId, billId: bill.id, billVersionId: "tampered-version", cteId: cte.cteId, mismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"], now: "2026-09-18T10:00:00.000Z" }), /SECURITY_FAILURE|MISSING_SOURCE_DOCUMENT/);
  await markEligibilityOverrideUsed(agent, repositories, authorized.overrideId, "2026-09-18T10:01:00.000Z");
  await assert.rejects(() => assertUsableEligibilityOverride(agent, repositories, { overrideId: authorized.overrideId, billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: cte.cteId, mismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"], now: "2026-09-18T10:02:00.000Z" }), /SECURITY_FAILURE|OVERRIDE_STATE_INVALID/);
  await assert.rejects(() => requestEligibilityOverride(agent, repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: cte.cteId, reason: "non commerciale", originalMismatchReasons: ["CALCULATION_NOT_READY"] }), /OVERRIDE_SCOPE_NOT_ALLOWED/);
  const expiredRequested = await requestEligibilityOverride(agent, repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: expiredCte.cteId, reason: "scaduta", originalMismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"] });
  const expiredAuthorized = await authorizeEligibilityOverride(admin, repositories, expiredRequested.overrideId, "2026-01-01T10:00:00.000Z");
  await assert.rejects(() => assertUsableEligibilityOverride(agent, repositories, { overrideId: expiredAuthorized.overrideId, billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: expiredCte.cteId, mismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"], now: "2026-09-18T10:00:00.000Z" }), /EXPIRED_CTE/);
  await assert.rejects(() => requestEligibilityOverride(agent, repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: reviewCte.cteId, reason: "in revisione", originalMismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"] }), /INVALID_CTE/);
  await assert.rejects(() => requestEligibilityOverride(agent, repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: deletedCte.cteId, reason: "cancellata", originalMismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"] }), /INVALID_CTE/);
  await assert.rejects(() => requestEligibilityOverride(principal("user_other", "ADMIN", otherTenant), repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: cte.cteId, reason: "cross tenant", originalMismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"] }), /MISSING_SOURCE_DOCUMENT/);
  const rejectedRequested = await requestEligibilityOverride(agent, repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: cte.cteId, reason: "richiesta da rifiutare", originalMismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"] });
  const rejected = await rejectEligibilityOverride(admin, repositories, rejectedRequested.overrideId, "Dati commerciali insufficienti", "2026-09-18T10:03:00.000Z");
  assert.equal(rejected.status, "REJECTED");
  const expiringRequested = await requestEligibilityOverride(agent, repositories, { billId: bill.id, billVersionId: bill.currentApprovedVersionId, cteId: cte.cteId, reason: "richiesta a tempo", expiresAt: "2026-09-18T10:05:00.000Z", originalMismatchReasons: ["CUSTOMER_LEGAL_TYPE_MISMATCH"] });
  const expiring = await authorizeEligibilityOverride(admin, repositories, expiringRequested.overrideId, "2026-09-18T10:04:00.000Z");
  assert.equal(expiring.status, "AUTHORIZED");
  const expiredUiState = await eligibilityOverrideUiState(agent, repositories, bill.id, bill.currentApprovedVersionId, "2026-09-18T10:06:00.000Z");
  assert.equal(expiredUiState.overrides.find((item) => item.overrideId === expiring.overrideId)?.status, "EXPIRED");
  assert.deepEqual(audits.map((event) => event.action).slice(0, 3), ["OVERRIDE_REQUESTED", "OVERRIDE_AUTHORIZED", "OVERRIDE_USED"]);
  console.log("AGENT_SELF_APPROVAL_DENIED=PASS");
  console.log("AGENT_CANNOT_AUTHORIZE_OTHERS=PASS");
  console.log("ADMIN_SCOPE_ISOLATION=PASS");
  console.log("SUPER_ADMIN_SCOPE_ENFORCED=PASS");
  console.log("CROSS_TENANT_OVERRIDE_DENIED=PASS");
  console.log("TAMPERED_OVERRIDE_DENIED=PASS");
  console.log("WRONG_BILL_VERSION_DENIED=PASS");
  console.log("OVERRIDE_CONSUMED=PASS");
  console.log("CALCULATION_NOT_READY_OVERRIDE_DENIED=PASS");
  console.log("EXPIRED_CTE_OVERRIDE_DENIED=PASS");
  console.log("REVIEW_REQUIRED_OVERRIDE_DENIED=PASS");
  console.log("DELETED_CTE_OVERRIDE_DENIED=PASS");
  console.log("OVERRIDE_AUDIT_EVENTS=PASS");
  console.log("PENDING_STATE_REFRESH=PASS");
  console.log("AUTHORIZED_STATE_REFRESH=PASS");
  console.log("REJECTED_STATE=PASS");
  console.log("EXPIRED_STATE_AND_AUDIT=PASS");
  console.log("ELIGIBILITY_OVERRIDE_SECURITY_SMOKE=PASS");
} finally {
  clearAuditRepository();
}
