import assert from "node:assert/strict";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildOrgChainIndex, nodeCanAuthorizeCte, nodeCanDelegateCte, saveOrgNode, validateOrgNode, canDelegateCte, buildHierarchyAccess } from "../app/lib/hierarchy/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertUsableEligibilityOverride, authorizeEligibilityOverride, authorizedOverrideCteIds, eligibilityOverrideUiState, forcingActorOf, grantEligibilityOverride, requestEligibilityOverride } from "../app/lib/eligibility/override.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { forcingForOffer, recordForcedOffer } from "../app/lib/eligibility/forcing.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { prepareBillDrivenSimulation } from "../app/lib/calculation/bill-driven.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { registerAuditRepository, clearAuditRepository } from "../app/lib/persistence/audit.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { permissionsForMembershipRole } from "../app/lib/foundation/memberships.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";

// Tony (20/11/2026, "FASE 1 — AUTORIZZAZIONI GERARCHICHE E FORZATURE CTE"): "Può forzare" and "Può delegare" are separate;
// the company administrator holds both by role; anybody else exercises only what was received and delegates only within
// their hierarchy, checked on the server. A revocation stops new forcings, including authorizations granted but not yet
// used; offers already produced stay archived and traced with company, user, authorization used, CTE version, customer
// and POD, reason, special conditions, offer id, date and time.

const tenantId = "tenant_qa-forcing";
const T0 = "2026-11-20T08:00:00.000Z";

// ---------------------------------------------------------------------------------------------------------------- stores
function memoryRepository() {
  const rows = new Map();
  const key = (tenant, id) => `${tenant}:${id}`;
  return {
    rows,
    async get(tenant, id) { return rows.get(key(tenant, id)) ?? null; },
    async list(tenant) { return [...rows.values()].filter((row) => row.tenantId === tenant); },
    async put(input) {
      const current = rows.get(key(input.tenantId, input.recordId));
      if (current && input.expectedVersion !== undefined && current.version !== input.expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT");
      if (!current && input.expectedVersion !== undefined) throw new Error("PERSISTENCE_VERSION_CONFLICT");
      const row = { tenantId: input.tenantId, recordId: input.recordId, version: (current?.version ?? 0) + 1, updatedAt: input.now ?? T0, createdAt: current?.createdAt ?? input.now ?? T0, payload: input.payload, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
      rows.set(key(input.tenantId, input.recordId), row); return row;
    },
    async append(input) { if (rows.has(key(input.tenantId, input.recordId))) throw new Error("PERSISTENCE_DUPLICATE"); return this.put(input); },
    async appendUnscoped(input) { return this.put({ ...input, tenantId: "__unscoped__" }); },
    async delete(input) { rows.delete(key(input.tenantId, input.recordId)); },
  };
}
const audit = memoryRepository();
registerAuditRepository(audit);

const membershipOf = (userId, role, status = "ACTIVE") => ({ id: `membership_${userId}`, userId, tenantId, role, status, permissions: [...permissionsForMembershipRole(role)], createdAt: T0, updatedAt: T0 });
const memberships = memoryRepository();
for (const [userId, role] of [["qa_admin", "TENANT_ADMIN"], ["qa_director", "SALES_MANAGER"], ["qa_director2", "SALES_MANAGER"], ["qa_area", "SALES_MANAGER"], ["qa_agent", "SALES_OPERATOR"], ["qa_sub", "SALES_OPERATOR"]]) await memberships.put({ tenantId, recordId: `membership_${userId}`, payload: membershipOf(userId, role) });
const memberList = async () => (await memberships.list(tenantId)).map((row) => row.payload);

const orgChain = memoryRepository();
const limits = { vectors: null, customerCategories: null, excludedCteArchiveIds: [] };
// The company node is placed by the access service with company authority.
await orgChain.put({ tenantId, recordId: "qa_admin", payload: { userId: "qa_admin", level: "AZIENDA", parentUserId: null, displayName: "QA", limits, updatedBy: "qa_admin" } });

const actor = (userId, role) => ({ userId, tenantId, role });
const ADMIN = actor("qa_admin", "SUPER_ADMIN");
const DIRECTOR = actor("qa_director", "ADMIN");
const DIRECTOR2 = actor("qa_director2", "ADMIN");
const AREA = actor("qa_area", "ADMIN");
const AGENT = actor("qa_agent", "AGENT");
const stores = async () => ({ orgChain, memberships: await memberList() });
const nodeOf = async (userId) => (await orgChain.list(tenantId)).find((row) => row.payload.userId === userId);
async function save(by, userId, level, parentUserId, flags = {}, now = T0) {
  const existing = await nodeOf(userId);
  return saveOrgNode(await stores(), by, { userId, level, parentUserId, limits, ...flags, ...(existing ? { expectedVersion: existing.version } : {}) }, now);
}
const index = async () => buildOrgChainIndex(await orgChain.list(tenantId));

// ------------------------------------------------------------------------------------------------- 1. two separate rights
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin");
await save(ADMIN, "qa_director2", "DIRETTORE", "qa_admin");
await save(ADMIN, "qa_area", "AREA_MANAGER", "qa_director");
await save(ADMIN, "qa_agent", "AGENTE", "qa_area");
await save(ADMIN, "qa_sub", "SUB_AGENTE", "qa_agent");

// "Può delegare" never stands alone.
assert.throws(() => validateOrgNode({ userId: "x", level: "AGENTE", parentUserId: "qa_area", limits, canDelegateCte: true, updatedBy: "qa_admin" }), /ORG_CTE_DELEGATION_REQUIRES_FORCING/);
await assert.rejects(save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canDelegateCte: true }), /ORG_CTE_DELEGATION_REQUIRES_FORCING/);

// The company administrator holds both rights by role and grants "Può forzare" alone.
assert.equal(nodeCanDelegateCte(await index(), "qa_admin"), true);
assert.equal(canDelegateCte(buildHierarchyAccess(ADMIN, await orgChain.list(tenantId), [], "2026-11-20")), true);
const forced = await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true, cteForcingGrant: { grantedBy: "qa_agent", grantedAt: "2020-01-01T00:00:00.000Z" } }, "2026-11-20T08:01:00.000Z");
assert.equal(forced.effectiveCanAuthorizeCte, true);
assert.equal(forced.effectiveCanDelegateCte, false);
// The grant record is written by the server from who acts, never taken from the request.
assert.deepEqual(forced.cteForcingGrant, { grantedBy: "qa_admin", grantedAt: "2026-11-20T08:01:00.000Z" });

// Who may only force cannot pass it on (before 20/11 the single flag let them).
await assert.rejects(save(DIRECTOR, "qa_area", "AREA_MANAGER", "qa_director", { canAuthorizeCte: true }), /ORG_CTE_AUTHORIZATION_GRANT_DENIED/);

// Once the administrator grants "Può delegare", the Direttore passes on both rights within the branch.
const delegating = await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true, canDelegateCte: true }, "2026-11-20T08:02:00.000Z");
assert.equal(delegating.effectiveCanDelegateCte, true);
assert.deepEqual(delegating.cteForcingGrant, { grantedBy: "qa_admin", grantedAt: "2026-11-20T08:01:00.000Z" }, "an unchanged right keeps its original grant");
assert.deepEqual(delegating.cteDelegationGrant, { grantedBy: "qa_admin", grantedAt: "2026-11-20T08:02:00.000Z" });
const area = await save(DIRECTOR, "qa_area", "AREA_MANAGER", "qa_director", { canAuthorizeCte: true }, "2026-11-20T08:03:00.000Z");
assert.equal(area.effectiveCanAuthorizeCte, true);
assert.deepEqual(area.cteForcingGrant, { grantedBy: "qa_director", grantedAt: "2026-11-20T08:03:00.000Z" });

// The Area Manager, who may force but not delegate, cannot pass the right to the agent.
await assert.rejects(save(AREA, "qa_agent", "AGENTE", "qa_area", { canAuthorizeCte: true }), /ORG_CTE_AUTHORIZATION_GRANT_DENIED/);

// Nobody gives "Può delegare" without holding it, nor outside their hierarchy.
await assert.rejects(save(AREA, "qa_agent", "AGENTE", "qa_area", { canAuthorizeCte: true, canDelegateCte: true }), /ORG_CTE_AUTHORIZATION_GRANT_DENIED/);
await assert.rejects(save(DIRECTOR2, "qa_area", "AREA_MANAGER", "qa_director", { canAuthorizeCte: true, canDelegateCte: true }), /ORG_SCOPE_DENIED/);
await assert.rejects(save(DIRECTOR, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true, canDelegateCte: true }), /ORG_SELF_EDIT_DENIED/);

// Below a manager who cannot force, nobody is given "Può forzare"; below one who cannot delegate, nobody "Può delegare".
await assert.rejects(save(ADMIN, "qa_agent", "AGENTE", "qa_area", { canAuthorizeCte: true, canDelegateCte: true }), /ORG_CTE_DELEGATION_PARENT_MISSING/);
await assert.rejects(save(ADMIN, "qa_sub", "SUB_AGENTE", "qa_agent", { canAuthorizeCte: true }), /ORG_CTE_AUTHORIZATION_PARENT_MISSING/);

// The Direttore gives the Area Manager "Può delegare" too; the Area Manager then gives the agent "Può forzare".
await save(DIRECTOR, "qa_area", "AREA_MANAGER", "qa_director", { canAuthorizeCte: true, canDelegateCte: true }, "2026-11-20T08:04:00.000Z");
const agentNode = await save(AREA, "qa_agent", "AGENTE", "qa_area", { canAuthorizeCte: true }, "2026-11-20T08:05:00.000Z");
assert.equal(agentNode.effectiveCanAuthorizeCte, true);
assert.equal(agentNode.effectiveCanDelegateCte, false);
assert.deepEqual(agentNode.cteForcingGrant, { grantedBy: "qa_area", grantedAt: "2026-11-20T08:05:00.000Z" });
// The agent, without "Può delegare", cannot pass it to the sub-agent.
await assert.rejects(save(AGENT, "qa_sub", "SUB_AGENTE", "qa_agent", { canAuthorizeCte: true }), /ORG_CTE_AUTHORIZATION_GRANT_DENIED/);

// Taking "Può delegare" from the Direttore takes it from the branch, never "Può forzare".
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true, canDelegateCte: false }, "2026-11-20T08:06:00.000Z");
assert.equal(nodeCanDelegateCte(await index(), "qa_area"), false);
assert.equal(nodeCanAuthorizeCte(await index(), "qa_area"), true);
assert.equal(nodeCanAuthorizeCte(await index(), "qa_agent"), true);
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true, canDelegateCte: true }, "2026-11-20T08:07:00.000Z");
assert.equal(nodeCanDelegateCte(await index(), "qa_area"), true);

// ------------------------------------------------------------------------------------------------- 2. forcing a CTE for a bill
const known = (value) => ({ status: "KNOWN", value });
const found = (value) => ({ value, status: "FOUND", confidence: 0.99, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const billVersionId = "bill-qa-forcing-v1";
const contract = { schemaVersion: 1, recordId: "bill-qa-forcing::energy::v1", version: "1", parentVersionId: null, tenantId, approval: { status: "DRAFT", reason: "BILL_PENDING_REVIEW" }, recordType: "BILL", billId: "bill-qa-forcing", vector: "EE", billingPeriod: { periodStart: "2026-09-01", periodEnd: "2026-10-01" }, currentSupplier: "QA Current", customer: { customerId: "customer-qa", customerType: "NON_RESIDENTIAL", name: known("QA Customer"), taxIdentifiers: [] }, offer: { supplier: "QA Current", offerName: known("Current"), offerCode: known("CUR") }, regulatedCharges: [], fieldProvenance: [], reviewState: "APPROVED", supply: { vector: "EE", pod: "ITQA00000000099", voltageLevel: "LV" }, consumption: { vector: "EE", f1: known(100), f2: known(50), f3: known(25), total: known(175) } };
const structuredBill = { schemaVersion: 1, vector: found("EE"), supplier: found("QA Current"), customerName: found("QA Customer"), customerId: found("customer-qa"), customerType: found("NON_RESIDENTIAL"), customerTaxIdentifier: notFound(), billingPeriod: found({ from: "2026-09-01", to: "2026-10-01" }), totalAmount: found(20), annualConsumption: found(2100), billedConsumption: found(175), pod: found("ITQA00000000099"), pdr: notFound(), voltageLevel: found("LV"), powerKw: found(10), f1Consumption: found(100), f2Consumption: found(50), f3Consumption: found(25), smcConsumption: notFound(), conversionCoefficient: notFound(), pcs: notFound(), offerName: found("Current"), offerCode: found("CUR"), extendedFacts: [{ code: "SUPPLY_USE_CATEGORY_RAW", value: "Altri usi", status: "FOUND" }, { code: "POWER_COMMITTED", value: "10 kW", status: "FOUND" }, { code: "POWER_AVAILABLE", value: "10 kW", status: "FOUND" }, { code: "VOLTAGE_CLASS_RAW", value: "BT", status: "FOUND" }], economicChargeLines: [] };
const bill = { id: "bill-qa-forcing", tenantId, ownerUserId: "qa_agent", fileName: "qa.pdf", objectKey: "qa.pdf", size: 100, createdAt: T0, updatedAt: T0, currentVersionId: billVersionId, currentApprovedVersionId: billVersionId, lifecycleState: "ACTIVE", lifecycleVersion: 1, retention: { retentionClass: "FISCAL_DOCUMENT", policyId: "FISCAL_15_MONTHS", policyVersion: 2, archivedAt: null, deletionDueAt: null, deletedAt: null }, lifecycleHistory: [], versions: [{ versionId: billVersionId, versionNumber: 1, supersedesVersionId: null, status: "EXTRACTED", fields: {}, createdAt: T0, origin: "INGESTION", energyContract: contract, structuredBill }], provenance: [], approvals: [{ approvalId: "a1", tenantId, documentId: "bill-qa-forcing", versionId: billVersionId, versionNumber: 1, approvedAt: T0, origin: "LOCAL_APPROVAL", supersedesApprovalId: null, actorId: "qa_agent", auditEventId: "audit-1" }] };
const fee = (feeId, label, amount, unit) => ({ feeId, label, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const cteContract = { ...structuredClone(syntheticElectricityCte), recordId: "CTE_QA_FORCED", cteId: "CTE_QA_FORCED", tenantId, approval: { status: "APPROVED", reviewer: "qa", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "qa" }, supplier: { supplierId: "qa", name: "QA Supplier" }, offer: { offerId: "qa", name: "QA Offer", code: "QA-FORCED" }, validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" }, eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"], annualConsumptionRule: { operator: ">", value: 50000, unit: "KWH_PER_YEAR", sourceEvidence: "Oltre 50.000 kWh/anno" } }, pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.2, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "DECLARED", component: fee("s", "Spread", 0.01, "EUR_PER_KWH") } }, commercialTerms: { fixedFees: [fee("f", "Fisso", 4, "EUR_PER_MONTH")], variableFees: [], imbalance: { status: "DECLARED", component: fee("i", "Sbilanciamento", 0.002, "EUR_PER_KWH") }, oneOffFees: [], commercialDiscounts: [] } };
const cteVersionId = "CTE_QA_FORCED-version-3";
const cte = { archiveId: "CTE_QA_FORCED", tenantId, cteId: "CTE_QA_FORCED", vector: "EE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", currentWorkingVersionId: cteVersionId, currentApprovedVersionId: cteVersionId, versions: [{ versionId: cteVersionId, versionNumber: 3, supersedesVersionId: null, status: "APPROVED", contract: cteContract, createdAt: "2026-01-01T00:00:00.000Z" }], approvals: [{ approvalId: "ap", versionId: cteVersionId, versionNumber: 3, decision: "APPROVED", reviewer: "qa", decisionId: "d", decidedAt: "2026-01-01T00:00:00.000Z", supersedesApprovalId: null }], history: [], commercialStatus: "ACTIVE" };
const overrides = memoryRepository();
const forcingRecords = memoryRepository();
const repositories = {
  billRepository: { async get(tenant, id) { return tenant === tenantId && id === bill.id ? bill : null; }, async list(tenant) { return tenant === tenantId ? [bill] : []; } },
  foundationMemberships: memberships, orgChain, cteAssignments: memoryRepository(),
  cteArchiveRepository: { async get(tenant, id) { return tenant === tenantId && (id === cte.archiveId || id === cte.cteId) ? cte : null; }, async list(tenant) { return tenant === tenantId ? [cte] : []; }, async save() {} },
  marketArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
  eligibilityOverrides: overrides, cteForcingRecords: forcingRecords,
};
const principal = (userId, role) => ({ userId, tenantId, role, sessionId: "session_qa", issuedAt: T0, expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" });
const P_ADMIN = principal("qa_admin", "ADMIN"), P_DIRECTOR = principal("qa_director", "ANALYST"), P_DIRECTOR2 = principal("qa_director2", "ANALYST"), P_AREA = principal("qa_area", "ANALYST"), P_AGENT = principal("qa_agent", "VIEWER"), P_SUB = principal("qa_sub", "VIEWER");
const forcingInput = { billId: bill.id, billVersionId, cteId: "CTE_QA_FORCED", reason: "Contratto firmato dal cliente", originalMismatchReasons: ["CONSUMPTION_THRESHOLD_MISMATCH"] };

const before = await prepareBillDrivenSimulation(P_AGENT, repositories, bill.id, "EXCLUDED", "2026-11-20");
assert.equal(before.candidates[0].finalStatus, "NOT_ELIGIBLE");
assert.deepEqual(before.candidates[0].reasonCodes, ["CONSUMPTION_THRESHOLD_MISMATCH"]);
assert.equal(before.canAuthorizeCte, true, "the agent received Può forzare from the Area Manager");

// The sub-agent without a valid authorization cannot force.
await assert.rejects(grantEligibilityOverride(P_SUB, repositories, { ...forcingInput, now: "2026-11-20T09:00:00.000Z" }), /OVERRIDE_AUTHORIZATION_DENIED/);

// The agent forces: the authorization records the CTE version and the permission used, with who granted it and when.
const granted = await grantEligibilityOverride(P_AGENT, repositories, { ...forcingInput, now: "2026-11-20T09:00:00.000Z" });
assert.equal(granted.status, "AUTHORIZED");
assert.equal(granted.cteVersionId, cteVersionId);
assert.equal(granted.authorization.basis, "CHAIN_PERMISSION");
assert.equal(granted.authorization.userId, "qa_agent");
assert.deepEqual(granted.authorization.permissionGrant, { grantedBy: "qa_area", grantedAt: "2026-11-20T08:05:00.000Z" });
assert.equal(audit.rows.size > 0 && [...audit.rows.values()].some((row) => row.payload.action === "OVERRIDE_AUTHORIZED" && row.payload.metadata.forcingBasis === "CHAIN_PERMISSION" && row.payload.metadata.cteVersionId === cteVersionId), true);
assert.deepEqual([...await authorizedOverrideCteIds(repositories, tenantId, { billId: bill.id, version: billVersionId }, "2026-11-20T09:01:00.000Z", forcingActorOf(P_AGENT))], ["CTE_QA_FORCED"]);
const offered = await prepareBillDrivenSimulation(P_AGENT, repositories, bill.id, "EXCLUDED", "2026-11-20");
assert.equal(offered.candidates[0].finalStatus, "ELIGIBLE_BY_OVERRIDE");

// ------------------------------------------------------------------------------------------------- 3. the forced offer is traced
const proposal = { tenantId, proposalId: "proposal_0123456789abcdef0123456789abcdef", proposalFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", sourceBill: { billId: bill.id, version: billVersionId }, cte: { cteId: "CTE_QA_FORCED", archiveId: "CTE_QA_FORCED", versionId: cteVersionId, version: "3" }, customer: { customerId: "customer-qa", category: "NON_RESIDENTIAL", displayName: "QA Customer" }, supply: { supplyId: "ITQA00000000099", pod: "ITQA00000000099", voltageLevel: "LV" } };
const trace = await recordForcedOffer(P_AGENT, repositories, proposal, forcingActorOf(P_AGENT), "2026-11-20T09:10:00.000Z");
assert.equal(trace.tenantId, tenantId);                                   // azienda
assert.equal(trace.userId, "qa_agent");                                      // utente
assert.equal(trace.authorization.overrideId, granted.overrideId);         // autorizzazione utilizzata
assert.equal(trace.authorization.authorityAtUse.basis, "CHAIN_PERMISSION");
assert.deepEqual(trace.authorization.authorityAtUse.permissionGrant, { grantedBy: "qa_area", grantedAt: "2026-11-20T08:05:00.000Z" });
assert.equal(trace.authorization.cteVersionIdAtAuthorization, cteVersionId);
assert.deepEqual(trace.cte, { cteId: "CTE_QA_FORCED", archiveId: "CTE_QA_FORCED", versionId: cteVersionId, version: "3" }); // versione CTE
assert.equal(trace.customer.customerId, "customer-qa");                   // cliente
assert.equal(trace.supply.pod, "ITQA00000000099");                        // POD
assert.equal(trace.reason, "Contratto firmato dal cliente");              // motivazione
assert.deepEqual(trace.specialConditions.map((item) => item.code), ["CONSUMPTION_THRESHOLD_MISMATCH"]); // condizioni particolari
assert.match(trace.specialConditions[0].label, /soglia/);
assert.equal(trace.proposalId, proposal.proposalId);                      // identificativo dell'offerta
assert.equal(trace.createdAt, "2026-11-20T09:10:00.000Z");                // data e ora
assert.equal((await forcingRecords.get(tenantId, proposal.proposalId)).payload.proposalId, proposal.proposalId);
const forcedAudit = [...audit.rows.values()].find((row) => row.payload.action === "CTE_FORCED_OFFER");
assert.equal(forcedAudit.payload.resourceId, proposal.proposalId);
assert.equal(JSON.stringify(forcedAudit.payload.metadata).includes("ITQA00000000099"), false, "the audit carries identifiers only");
// The same offer generated again keeps its first trace.
assert.equal((await recordForcedOffer(P_AGENT, repositories, proposal, forcingActorOf(P_AGENT), "2026-11-20T09:20:00.000Z")).createdAt, "2026-11-20T09:10:00.000Z");
// An offer on another CTE, or without a bill, rests on no forcing.
assert.equal(await recordForcedOffer(P_AGENT, repositories, { ...proposal, proposalId: "proposal_other", cte: { ...proposal.cte, cteId: "CTE_OTHER" } }, forcingActorOf(P_AGENT)), null);
assert.equal(await recordForcedOffer(P_AGENT, repositories, { ...proposal, proposalId: "proposal_nobill", sourceBill: undefined }, forcingActorOf(P_AGENT)), null);

// ------------------------------------------------------------------------------------------------- 4. revocation
// The Area Manager takes "Può forzare" away from the agent: the authorization granted but not used again is blocked.
await save(AREA, "qa_agent", "AGENTE", "qa_area", { canAuthorizeCte: false }, "2026-11-20T10:00:00.000Z");
assert.equal(nodeCanAuthorizeCte(await index(), "qa_agent"), false);
assert.deepEqual([...await authorizedOverrideCteIds(repositories, tenantId, { billId: bill.id, version: billVersionId }, "2026-11-20T10:01:00.000Z", forcingActorOf(P_AGENT))], []);
await assert.rejects(assertUsableEligibilityOverride(P_AGENT, repositories, { overrideId: granted.overrideId, billId: bill.id, billVersionId, cteId: "CTE_QA_FORCED", mismatchReasons: ["CONSUMPTION_THRESHOLD_MISMATCH"], now: "2026-11-20T10:01:00.000Z" }), /OVERRIDE_AUTHORIZATION_REVOKED/);
const afterRevocation = await prepareBillDrivenSimulation(P_AGENT, repositories, bill.id, "EXCLUDED", "2026-11-20");
assert.equal(afterRevocation.candidates[0].finalStatus, "NOT_ELIGIBLE");
assert.equal(afterRevocation.canAuthorizeCte, false);
await assert.rejects(grantEligibilityOverride(P_AGENT, repositories, { ...forcingInput, now: "2026-11-20T10:02:00.000Z" }), /OVERRIDE_AUTHORIZATION_DENIED/);
// No new forced offer rests on it ...
assert.equal(await forcingForOffer(repositories, { ...proposal, proposalId: "proposal_new" }, forcingActorOf(P_AGENT), "2026-11-20T10:03:00.000Z"), null);
// ... while the offer already produced stays archived and traced.
assert.equal((await forcingRecords.get(tenantId, proposal.proposalId)).payload.authorization.overrideId, granted.overrideId);
const uiState = await eligibilityOverrideUiState(P_AGENT, repositories, bill.id, billVersionId, "2026-11-20T10:04:00.000Z");
assert.equal(uiState.overrides.find((item) => item.overrideId === granted.overrideId).authorizationRevoked, true);
assert.equal(uiState.capabilities.canAuthorize, false);

// Revocation up the chain: the Direttore loses "Può forzare", and with it the Area Manager's forcings.
const areaForced = await grantEligibilityOverride(P_AREA, repositories, { ...forcingInput, now: "2026-11-20T11:00:00.000Z" });
assert.deepEqual([...await authorizedOverrideCteIds(repositories, tenantId, { billId: bill.id, version: billVersionId }, "2026-11-20T11:01:00.000Z", forcingActorOf(P_AREA))], ["CTE_QA_FORCED"]);
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", {}, "2026-11-20T11:02:00.000Z");
assert.equal(nodeCanAuthorizeCte(await index(), "qa_area"), false);
assert.deepEqual([...await authorizedOverrideCteIds(repositories, tenantId, { billId: bill.id, version: billVersionId }, "2026-11-20T11:03:00.000Z", forcingActorOf(P_AREA))], []);
await assert.rejects(assertUsableEligibilityOverride(P_AREA, repositories, { overrideId: areaForced.overrideId, billId: bill.id, billVersionId, cteId: "CTE_QA_FORCED", mismatchReasons: ["CONSUMPTION_THRESHOLD_MISMATCH"], now: "2026-11-20T11:03:00.000Z" }), /OVERRIDE_AUTHORIZATION_REVOKED/);

// A suspended account's authorizations stop too.
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true }, "2026-11-20T12:00:00.000Z");
const directorForced = await grantEligibilityOverride(P_DIRECTOR, repositories, { ...forcingInput, now: "2026-11-20T12:01:00.000Z" });
const directorMembership = await memberships.get(tenantId, "membership_qa_director");
await memberships.put({ tenantId, recordId: "membership_qa_director", payload: { ...directorMembership.payload, status: "SUSPENDED" }, expectedVersion: directorMembership.version });
await assert.rejects(assertUsableEligibilityOverride(P_AGENT, repositories, { overrideId: directorForced.overrideId, billId: bill.id, billVersionId, cteId: "CTE_QA_FORCED", mismatchReasons: ["CONSUMPTION_THRESHOLD_MISMATCH"], now: "2026-11-20T12:02:00.000Z" }), /OVERRIDE_AUTHORIZATION_REVOKED/);
await memberships.put({ tenantId, recordId: "membership_qa_director", payload: directorMembership.payload });

// ------------------------------------------------------------------------------------------------- 5. requests authorized by a manager
// Authorizing an agent's request is a forcing too: a Direttore without "Può forzare" cannot, one with it can.
const requested = await requestEligibilityOverride(P_AGENT, repositories, { ...forcingInput, now: "2026-11-20T13:00:00.000Z" });
await assert.rejects(authorizeEligibilityOverride(P_DIRECTOR2, repositories, requested.overrideId, "2026-11-20T13:01:00.000Z", "ok"), /OVERRIDE_AUTHORIZATION_DENIED/);
const authorized = await authorizeEligibilityOverride(P_DIRECTOR, repositories, requested.overrideId, "2026-11-20T13:02:00.000Z", "Approvato dal Direttore");
assert.equal(authorized.status, "AUTHORIZED");
assert.equal(authorized.cteVersionId, cteVersionId);
assert.equal(authorized.authorization.basis, "CHAIN_PERMISSION");
assert.equal(authorized.authorization.userId, "qa_director");

// ------------------------------------------------------------------------------------------------- 6. the company administrator
// The administrator forces by role; the authorization rests on the role, and no revocation in the chain touches it.
const adminForced = await grantEligibilityOverride(P_ADMIN, repositories, { ...forcingInput, now: "2026-11-20T14:00:00.000Z" });
assert.equal(adminForced.authorization.basis, "COMPANY_ADMIN");
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", {}, "2026-11-20T14:01:00.000Z");
const used = await assertUsableEligibilityOverride(P_AGENT, repositories, { overrideId: adminForced.overrideId, billId: bill.id, billVersionId, cteId: "CTE_QA_FORCED", mismatchReasons: ["CONSUMPTION_THRESHOLD_MISMATCH"], now: "2026-11-20T14:02:00.000Z" });
assert.equal(used.record.overrideId, adminForced.overrideId);

// ------------------------------------------------------------------------------------------------- 7. company isolation
// Another company sees neither this bill nor its forcings.
const stranger = { ...principal("qa_admin", "ADMIN"), tenantId: "tenant_other-company" };
await assert.rejects(grantEligibilityOverride(stranger, repositories, { ...forcingInput, now: "2026-11-20T15:00:00.000Z" }), /MISSING_SOURCE_DOCUMENT|TENANT/);
assert.deepEqual([...await authorizedOverrideCteIds(repositories, "tenant_other-company", { billId: bill.id, version: billVersionId }, "2026-11-20T15:01:00.000Z")], []);

// ------------------------------------------------------------------------------------------------- 8. interface
const { readFileSync } = await import("node:fs");
const panel = readFileSync(new URL("../app/components/HierarchyPanel.tsx", import.meta.url), "utf8");
assert.match(panel, /Può forzare: autorizzare/);
assert.match(panel, /Può delegare: dare il permesso di forzare/);
assert.match(panel, /canDelegateCte: level !== "AZIENDA" && authorizeCte && delegateCte/);
for (const route of ["../app/api/proposal/route.ts", "../app/api/proposal/comparison/route.ts"]) {
  const source = readFileSync(new URL(route, import.meta.url), "utf8");
  assert.ok(source.indexOf("recordForcedOffer(") > 0 && source.indexOf("recordForcedOffer(") < source.indexOf("repositories.proposals.put("), `${route}: the trace is written before the offer is stored`);
}

// ================================================================== CHIUSURA FASE 1 (Tony, 20/11/2026): sicurezza e compatibilità
// ------------------------------------------------------------------------------------------------- 9. audit and forcing are atomic
// A forcing is never saved, nor usable, when its mandatory audit cannot be recorded.
const brokenAudit = { ...memoryRepository(), async append() { throw new Error("AUDIT_UNAVAILABLE"); }, async appendUnscoped() { throw new Error("AUDIT_UNAVAILABLE"); } };
const overridesBefore = overrides.rows.size;
registerAuditRepository(brokenAudit);
await assert.rejects(grantEligibilityOverride(P_ADMIN, repositories, { ...forcingInput, now: "2026-11-20T16:00:00.000Z" }), /AUDIT_UNAVAILABLE/);
await assert.rejects(requestEligibilityOverride(P_AGENT, repositories, { ...forcingInput, now: "2026-11-20T16:00:30.000Z" }), /AUDIT_UNAVAILABLE/);
assert.equal(overrides.rows.size, overridesBefore, "nothing saved without its audit");
registerAuditRepository(audit);
const pendingRequest = await requestEligibilityOverride(P_AGENT, repositories, { ...forcingInput, now: "2026-11-20T16:01:00.000Z" });
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true }, "2026-11-20T16:02:00.000Z");
registerAuditRepository(brokenAudit);
await assert.rejects(authorizeEligibilityOverride(P_DIRECTOR, repositories, pendingRequest.overrideId, "2026-11-20T16:03:00.000Z", "Approvato"), /AUDIT_UNAVAILABLE/);
registerAuditRepository(audit);
assert.equal((await overrides.get(tenantId, pendingRequest.overrideId)).payload.status, "REQUESTED", "the request stays unauthorized when the audit fails");
// When the record cannot be written after its audit, a compensating DENIED event says so.
const failingOverrides = { ...overrides, async append() { throw new Error("PERSISTENCE_UNAVAILABLE"); }, get: overrides.get, list: overrides.list, put: overrides.put };
await assert.rejects(grantEligibilityOverride(P_ADMIN, { ...repositories, eligibilityOverrides: failingOverrides }, { ...forcingInput, now: "2026-11-20T16:04:00.000Z" }), /PERSISTENCE_UNAVAILABLE/);
assert.ok([...audit.rows.values()].some((row) => row.payload.action === "OVERRIDE_AUTHORIZED_NOT_SAVED" && row.payload.outcome === "DENIED" && row.payload.metadata.failure === "PERSISTENCE_UNAVAILABLE"));

// Reasons over 256 characters are refused with their own code, never cut; 256 is accepted whole.
const overridesBeforeLong = overrides.rows.size;
await assert.rejects(grantEligibilityOverride(P_ADMIN, repositories, { ...forcingInput, reason: "x".repeat(257), now: "2026-11-20T16:05:00.000Z" }), /OVERRIDE_REASON_TOO_LONG/);
await assert.rejects(requestEligibilityOverride(P_AGENT, repositories, { ...forcingInput, reason: "y".repeat(300), now: "2026-11-20T16:05:30.000Z" }), /OVERRIDE_REASON_TOO_LONG/);
assert.equal(overrides.rows.size, overridesBeforeLong);
const longest = await grantEligibilityOverride(P_ADMIN, repositories, { ...forcingInput, reason: "z".repeat(256), now: "2026-11-20T16:06:00.000Z" });
assert.equal(longest.reason.length, 256);
assert.ok([...audit.rows.values()].some((row) => row.payload.resourceId === longest.overrideId && row.payload.metadata.reason === "z".repeat(256)), "the audit holds the whole reason");

// The offer path: no trace without its audit, and the route stores the offer only after the trace.
const offerProposal = { ...proposal, proposalId: "proposal_fedcba9876543210fedcba9876543210", proposalFingerprint: "f".repeat(64) };
registerAuditRepository(brokenAudit);
await assert.rejects(recordForcedOffer(P_ADMIN, repositories, offerProposal, forcingActorOf(P_ADMIN), "2026-11-20T16:07:00.000Z"), /AUDIT_UNAVAILABLE/);
registerAuditRepository(audit);
assert.equal(await forcingRecords.get(tenantId, offerProposal.proposalId), null, "no trace without its audit");
const failingTraces = { ...forcingRecords, get: forcingRecords.get, async put() { throw new Error("PERSISTENCE_UNAVAILABLE"); } };
await assert.rejects(recordForcedOffer(P_ADMIN, { ...repositories, cteForcingRecords: failingTraces }, offerProposal, forcingActorOf(P_ADMIN), "2026-11-20T16:08:00.000Z"), /PERSISTENCE_UNAVAILABLE/);
assert.ok([...audit.rows.values()].some((row) => row.payload.action === "CTE_FORCED_OFFER_NOT_SAVED" && row.payload.resourceId === offerProposal.proposalId));
for (const route of ["../app/api/proposal/route.ts", "../app/api/proposal/comparison/route.ts"]) {
  const source = readFileSync(new URL(route, import.meta.url), "utf8");
  // recordForcedOffer throws on any failure and is awaited before the offer is stored: no forced offer without its trace.
  assert.match(source, /const forcing = await recordForcedOffer\([^;]+\); await repositories\.proposals\.put\(/);
}

// ------------------------------------------------------------------------------------------------- 10. special conditions
const { specialConditionLines, specialConditionsSentence, SPECIAL_CONDITIONS_TITLE } = await import("../app/lib/eligibility/special-conditions.ts");
assert.deepEqual(specialConditionLines(["CONSUMPTION_THRESHOLD_MISMATCH", "VOLTAGE_MISMATCH"]), ["soglia di consumo annuo prevista dalla CTE", "livello di tensione previsto dalla CTE"]);
assert.equal(specialConditionsSentence([]), "");
const { renderReceiptProposal } = await import("../app/lib/export/receipt-pdf.ts");
const { parseProposalPresentation } = await import("../app/lib/proposal/presentation.ts");
const presentation = parseProposalPresentation({ customerName: "QA Customer", supplyLabel: "ITQA00000000099", billSupplier: "QA Current", billOfferName: "Current", offerSupplier: "QA Supplier", offerName: "QA Offer", offerCode: "QA-FORCED", periodLabel: "01/09/2026 - 30/09/2026", consumptionLabel: "175 kWh", taxesIncluded: false, sameOffer: false, currentTotal: 40, offerTotal: 35, savings: 5, savingsPercent: 12.5, annualSaving: null, annualCurrent: null, annualBasisLabel: "", validUntil: null, rows: [{ label: "Spesa per la vendita", current: 40, offer: 35, difference: -5, detail: false }], comparison: [], excluded: [], scontrino: [], billScontrino: [] });
const snapshot = { generatedAt: "2026-11-20T00:00:00.000Z", customer: { displayName: "QA Customer" }, selectedOffer: { supplier: "QA Supplier", offerCode: "QA-FORCED" } };
const forcedPdf = Buffer.from(renderReceiptProposal(snapshot, presentation, null, trace.specialConditions.map((item) => item.code))).toString("latin1");
assert.match(forcedPdf, /CONDIZIONI PARTICOLARI APPLICATE/);
assert.match(forcedPdf, /soglia di consumo annuo prevista dalla CTE/);
// Nothing about the company's permissions or who authorized reaches the customer's PDF.
assert.doesNotMatch(forcedPdf, /qa_|forzare|delegare|autorizzat|Direttore|Area Manager|permess/i);
const plainPdf = Buffer.from(renderReceiptProposal(snapshot, presentation, null)).toString("latin1");
assert.doesNotMatch(plainPdf, /CONDIZIONI PARTICOLARI APPLICATE/i);
const { specialConditionCodesOf } = await import("../app/lib/proposal/api.ts").catch(() => ({}));
if (specialConditionCodesOf) {
  assert.deepEqual(await specialConditionCodesOf(repositories, tenantId, proposal.proposalId), ["CONSUMPTION_THRESHOLD_MISMATCH"]);
  assert.deepEqual(await specialConditionCodesOf(repositories, tenantId, "proposal_without_forcing"), []);
}
const flowSource = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flowSource, /specialConditionsSentence\(offer\.candidate\.reasonCodes\)/);
assert.doesNotMatch(flowSource, /Autorizzata per questa bolletta/);
assert.match(readFileSync(new URL("../app/lib/proposal/api.ts", import.meta.url), "utf8"), /renderReceiptProposal\(proposal, presentation, profile, await specialConditionCodesOf\(/);
assert.equal(SPECIAL_CONDITIONS_TITLE, "Condizioni particolari applicate");

// ------------------------------------------------------------------------------------------------- 11. who decides on a request
// Approving and refusing take the same faculty, within the hierarchy.
const { rejectEligibilityOverride } = await import("../app/lib/eligibility/override.ts");
await save(ADMIN, "qa_director2", "DIRETTORE", "qa_admin", { canAuthorizeCte: true }, "2026-11-20T17:00:00.000Z");
const toDecide = await requestEligibilityOverride(P_AGENT, repositories, { ...forcingInput, now: "2026-11-20T17:01:00.000Z" });
// A Direttore of another branch, even holding "Può forzare", decides neither way.
await assert.rejects(authorizeEligibilityOverride(P_DIRECTOR2, repositories, toDecide.overrideId, "2026-11-20T17:02:00.000Z", "ok"), /OVERRIDE_HIERARCHY_DENIED/);
await assert.rejects(rejectEligibilityOverride(P_DIRECTOR2, repositories, toDecide.overrideId, "no", "2026-11-20T17:02:00.000Z"), /OVERRIDE_HIERARCHY_DENIED/);
// A manager of the branch without "Può forzare" cannot refuse either (before 20/11 any manager could).
await save(ADMIN, "qa_director", "DIRETTORE", "qa_admin", { canAuthorizeCte: true, canDelegateCte: true }, "2026-11-20T17:03:00.000Z");
await save(DIRECTOR, "qa_area", "AREA_MANAGER", "qa_director", {}, "2026-11-20T17:04:00.000Z");
await assert.rejects(rejectEligibilityOverride(P_AREA, repositories, toDecide.overrideId, "no", "2026-11-20T17:05:00.000Z"), /OVERRIDE_AUTHORIZATION_DENIED/);
// Nobody decides on their own request.
await assert.rejects(rejectEligibilityOverride(P_AGENT, repositories, toDecide.overrideId, "no", "2026-11-20T17:05:30.000Z"), /OVERRIDE_SELF_APPROVAL_DENIED/);
// The Direttore above the requester, holding "Può forzare", refuses with a reason; the decision is audited.
const refused = await rejectEligibilityOverride(P_DIRECTOR, repositories, toDecide.overrideId, "Consumo troppo distante dalla soglia", "2026-11-20T17:06:00.000Z");
assert.equal(refused.status, "REJECTED");
assert.ok([...audit.rows.values()].some((row) => row.payload.action === "OVERRIDE_REJECTED" && row.payload.resourceId === toDecide.overrideId));
await assert.rejects(rejectEligibilityOverride(P_DIRECTOR, repositories, toDecide.overrideId, "di nuovo", "2026-11-20T17:07:00.000Z"), /OVERRIDE_STATE_INVALID/);
// The company administrator decides on any request of the company.
const toAdmin = await requestEligibilityOverride(P_AGENT, repositories, { ...forcingInput, now: "2026-11-20T17:08:00.000Z" });
assert.equal((await authorizeEligibilityOverride(P_ADMIN, repositories, toAdmin.overrideId, "2026-11-20T17:09:00.000Z", "Approvato")).authorization.basis, "COMPANY_ADMIN");
// The screen offers both buttons only to who may decide.
assert.equal((await eligibilityOverrideUiState(P_AREA, repositories, bill.id, billVersionId, "2026-11-20T17:10:00.000Z")).capabilities.canReject, false);
assert.equal((await eligibilityOverrideUiState(P_DIRECTOR, repositories, bill.id, billVersionId, "2026-11-20T17:10:00.000Z")).capabilities.canReject, true);

clearAuditRepository();
console.log("cte forcing delegation ok");
