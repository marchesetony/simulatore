import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareBillDrivenSimulation, resolveBillDrivenExecution } from "../app/lib/calculation/bill-driven.ts";
import { isCompanyDirector, runTechnicalDerogation, TECHNICAL_DEROGATION_BANNER } from "../app/lib/calculation/technical-derogation.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { clearAuditRepository, registerAuditRepository } from "../app/lib/persistence/audit.ts";
import { resolveAuthoritativeProposalInput } from "../app/lib/proposal/server.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";

// Tony (14/11/2026, "Simulazione tecnica in deroga"): the company's Direttore may simulate, as a technical check, an assigned
// and approved CTE that only the annual consumption threshold leaves out (Be Relax >1.500 kWh/anno, customer at 192 kWh/anno).
// Area Manager, agents and other companies cannot; the result is never a commercial proposal. Synthetic data only.

const tenantId = "tenant_qa-company";
const otherTenantId = "tenant_other-company";
const billVersionId = "bill-qa-ee-v1";
const person = (userId, role, tenant = tenantId) => ({ userId, tenantId: tenant, role, sessionId: "session_local-dev", issuedAt: "2026-09-16T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" });
const director = person("user_director", "ANALYST");
const area = person("user_area", "ANALYST");
const agent = person("user_agent", "VIEWER");
const companyAdmin = person("user_company", "ADMIN");
const outsider = person("user_director", "ANALYST", otherTenantId);

const known = (value) => ({ status: "KNOWN", value });
const found = (value) => ({ value, status: "FOUND", confidence: 0.99, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const structuredBill = {
  schemaVersion: 1,
  vector: found("EE"), supplier: found("QA Supplier Current"), customerName: found("QA Customer"), customerId: found("customer-qa-ee"), customerType: found("NON_RESIDENTIAL"), customerTaxIdentifier: notFound(),
  billingPeriod: found({ from: "2026-07-01", to: "2026-08-01" }), totalAmount: found(20), annualConsumption: found(2100), billedConsumption: found(175), pod: found("ITQA00000000001"), pdr: notFound(), voltageLevel: found("LV"), powerKw: found(10),
  f1Consumption: found(100), f2Consumption: found(50), f3Consumption: found(25), smcConsumption: notFound(), conversionCoefficient: notFound(), pcs: notFound(), offerName: found("QA Current Offer"), offerCode: found("QA-CURRENT"),
  extendedFacts: [
    { code: "SUPPLY_USE_CATEGORY_RAW", value: "Altri usi", status: "FOUND" }, { code: "POWER_COMMITTED", value: "10 kW", status: "FOUND" }, { code: "POWER_AVAILABLE", value: "10 kW", status: "FOUND" },
    { code: "VOLTAGE_CLASS_RAW", value: "BT", status: "FOUND" }, { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Altri usi", status: "FOUND" },
  ],
  economicChargeLines: [],
};
const billContract = {
  schemaVersion: 1, recordId: "bill-qa-ee::energy::bill-qa-ee-v1", version: "1", parentVersionId: null, tenantId,
  approval: { status: "DRAFT", reason: "BILL_PENDING_REVIEW" }, recordType: "BILL", billId: "bill-qa-ee", vector: "EE",
  billingPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, currentSupplier: "QA Supplier Current",
  customer: { customerId: "customer-qa-ee", customerType: "NON_RESIDENTIAL", name: known("QA Customer"), taxIdentifiers: [] },
  offer: { supplier: "QA Supplier Current", offerName: known("QA Current Offer"), offerCode: known("QA-CURRENT") }, regulatedCharges: [],
  fieldProvenance: [], reviewState: "APPROVED", supply: { vector: "EE", pod: "ITQA00000000001", voltageLevel: "LV" },
  consumption: { vector: "EE", f1: known(100), f2: known(50), f3: known(25), total: known(175) },
};
// The bill belongs to the agent, in the Direttore's branch.
const bill = {
  id: "bill-qa-ee", tenantId, ownerUserId: "user_agent", fileName: "qa-ee.pdf", objectKey: "qa-ee.pdf", size: 100,
  createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", currentVersionId: billVersionId, currentApprovedVersionId: billVersionId, lifecycleState: "ACTIVE", lifecycleVersion: 1,
  retention: { retentionClass: "FISCAL_DOCUMENT", policyId: "FISCAL_15_MONTHS", policyVersion: 2, archivedAt: null, deletionDueAt: null, deletedAt: null }, lifecycleHistory: [],
  versions: [{ versionId: billVersionId, versionNumber: 1, supersedesVersionId: null, status: "EXTRACTED", fields: {}, createdAt: "2026-09-16T00:00:00.000Z", origin: "INGESTION", energyContract: billContract, structuredBill }],
  provenance: [], approvals: [{ approvalId: "bill-approval-1", tenantId, documentId: "bill-qa-ee", versionId: billVersionId, versionNumber: 1, approvedAt: "2026-09-16T00:00:00.000Z", origin: "LOCAL_APPROVAL", supersedesApprovalId: null, actorId: "user_agent", auditEventId: "audit-1" }],
};
const archive = (contract, commercialStatus = "ACTIVE", tenant = tenantId) => ({
  archiveId: contract.cteId, tenantId: tenant, cteId: contract.cteId, vector: contract.vector, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  currentWorkingVersionId: `${contract.cteId}-version-1`, currentApprovedVersionId: `${contract.cteId}-version-1`,
  versions: [{ versionId: `${contract.cteId}-version-1`, versionNumber: 1, supersedesVersionId: null, status: "APPROVED", contract: { ...contract, tenantId: tenant }, createdAt: "2026-01-01T00:00:00.000Z" }],
  approvals: [{ approvalId: `${contract.cteId}-approval`, versionId: `${contract.cteId}-version-1`, versionNumber: 1, decision: "APPROVED", reviewer: "user_company", decisionId: `${contract.cteId}-decision`, decidedAt: "2026-01-01T00:00:00.000Z", supersedesApprovalId: null }],
  history: [], commercialStatus,
});
const fee = (feeId, label, amount, unit) => ({ feeId, label, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const base = { ...structuredClone(syntheticElectricityCte), recordId: "CTE_QA_BASE", cteId: "CTE_QA_BASE", tenantId,
  approval: { status: "APPROVED", reviewer: "qa", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "qa-approval" },
  supplier: { supplierId: "qa-supplier", name: "QA Supplier" }, offer: { offerId: "qa-offer", name: "QA Offer", code: "QA-BASE" },
  validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
  eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] },
  pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.2, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "DECLARED", component: fee("qa-spread", "Spread", 0.01, "EUR_PER_KWH") } },
  commercialTerms: { fixedFees: [fee("qa-fixed", "Fixed monthly fee", 4, "EUR_PER_MONTH")], variableFees: [], imbalance: { status: "DECLARED", component: fee("qa-imbalance", "Imbalance", 0.002, "EUR_PER_KWH") }, oneOffFees: [], commercialDiscounts: [] } };
const variant = (cteId, eligibility) => ({ ...structuredClone(base), recordId: cteId, cteId, offer: { ...base.offer, code: cteId }, eligibility: { ...base.eligibility, ...eligibility } });
const rule = { annualConsumptionRule: { operator: ">", value: 50000, unit: "KWH_PER_YEAR", sourceEvidence: "Offerta riservata a consumi oltre 50.000 kWh/anno" } };
const threshold = variant("CTE_QA_THRESHOLD", rule);
const blocked = variant("CTE_QA_BLOCKED", rule);
const twoReasons = variant("CTE_QA_TWO_REASONS", { ...rule, customerTypes: ["RESIDENTIAL"] });
const eligible = variant("CTE_QA_ELIGIBLE", {});
const ctes = [archive(threshold), archive(blocked, "BLOCKED"), archive(twoReasons), archive(eligible), archive(variant("CTE_QA_OTHER_TENANT", rule), "ACTIVE", otherTenantId)];

const node = (userId, level, parentUserId) => ({ tenantId, recordId: userId, version: 1, updatedAt: "2026-09-16T00:00:00.000Z", payload: { userId, level, parentUserId, displayName: null, limits: { vectors: null, customerCategories: null, excludedCteArchiveIds: [] }, updatedBy: "user_company" } });
const chain = [node("user_company", "AZIENDA", null), node("user_director", "DIRETTORE", "user_company"), node("user_area", "AREA_MANAGER", "user_director"), node("user_agent", "AGENTE", "user_area")];
const member = (userId, role) => ({ tenantId, recordId: userId, version: 1, payload: { id: `membership_${userId}`, tenantId, userId, role, status: "ACTIVE", permissions: [], version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } });
const memberships = [member("user_company", "TENANT_ADMIN"), member("user_director", "SALES_MANAGER"), member("user_area", "SALES_MANAGER"), member("user_agent", "SALES_OPERATOR")];
const stored = [];
const audits = [];
registerAuditRepository({ async append(record) { audits.push(record.payload); }, async appendUnscoped(record) { audits.push(record.payload); } });
const repositories = {
  billRepository: { async get(tenant, id) { return tenant === bill.tenantId && id === bill.id ? bill : null; }, async list(tenant) { return tenant === bill.tenantId ? [bill] : []; } },
  foundationMemberships: { async list(tenant) { return memberships.filter((record) => record.tenantId === tenant); } },
  cteArchiveRepository: { async get(tenant, id) { return ctes.find((record) => record.tenantId === tenant && (record.archiveId === id || record.cteId === id)) ?? null; }, async list(tenant) { return ctes.filter((record) => record.tenantId === tenant); }, async save() { throw new Error("CTE must not be changed"); } },
  marketArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
  eligibilityOverrides: { async list() { return []; } },
  orgChain: { async list(tenant) { return chain.filter((record) => record.tenantId === tenant); } },
  cteAssignments: { async list() { return []; } },
  calculationResults: { async get(tenant, id) { return stored.find((record) => record.tenantId === tenant && record.recordId === id) ?? null; }, async put(record) { stored.push(record); } },
};
const calculate = (simulation, cteId) => calculateApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, simulation, cteId);
const input = (archiveId) => ({ billId: "bill-qa-ee", billVersionId, archiveId, cteVersionId: `${archiveId}-version-1`, taxTreatment: "EXCLUDED", calculationDate: "2026-09-16" });
const before = JSON.stringify({ bill, ctes });

// Role check: only the company's Direttore.
assert.equal(await isCompanyDirector(director, repositories), true);
assert.equal(await isCompanyDirector(area, repositories), false, "Area Manager: same ANALYST role and SALES_MANAGER membership, different level");
assert.equal(await isCompanyDirector(agent, repositories), false);
assert.equal(await isCompanyDirector(companyAdmin, repositories), false, "the derogation is the Direttore's, as Tony asked");
assert.equal(await isCompanyDirector(outsider, repositories), false, "same user id in another company: no node, no membership there");
assert.equal(await isCompanyDirector(director, { ...repositories, foundationMemberships: { async list() { return [{ ...member("user_director", "SALES_MANAGER"), payload: { ...member("user_director", "SALES_MANAGER").payload, status: "SUSPENDED" } }]; } } }), false, "suspended membership");

// The ordinary quote is unchanged: the threshold CTE stays excluded, and cannot be calculated without an authorization.
const ordinary = await prepareBillDrivenSimulation(director, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16");
const excluded = ordinary.candidates.find((item) => item.cteId === "CTE_QA_THRESHOLD");
assert.equal(excluded.finalStatus, "NOT_ELIGIBLE");
assert.deepEqual(excluded.reasonCodes, ["CONSUMPTION_THRESHOLD_MISMATCH"]);
assert.equal(ordinary.candidates.find((item) => item.cteId === "CTE_QA_ELIGIBLE").finalStatus, "ELIGIBLE");
await assert.rejects(resolveBillDrivenExecution(director, repositories, { ...input("CTE_QA_THRESHOLD"), cteId: "CTE_QA_THRESHOLD" }), /CONSUMPTION_NOT_ELIGIBLE/);

// Director: the technical simulation runs with the usual engine, marked, not stored, audited.
const technical = await runTechnicalDerogation(director, repositories, input("CTE_QA_THRESHOLD"), calculate);
assert.equal(technical.technical, true);
assert.equal(technical.banner, TECHNICAL_DEROGATION_BANNER);
assert.equal(TECHNICAL_DEROGATION_BANNER, "SIMULAZIONE TECNICA FUORI DAI REQUISITI CTE — NON VALIDA COME PROPOSTA COMMERCIALE");
assert.equal(technical.derogatedRequirement, "CONSUMPTION_THRESHOLD_MISMATCH");
assert.equal(technical.annualConsumption.value, 2100);
assert.equal(technical.cte.consumptionRequirement, "> 50.000 kWh/anno");
const engine = await calculate((await import("../app/lib/calculation/input.ts")).parseSimulationRequest((await import("../app/lib/calculation/bill-driven.ts")).requestFromContext(ordinary.context, "EXCLUDED", "2026-09-16"), tenantId), "CTE_QA_THRESHOLD");
assert.equal(technical.totalCommercialCost, engine.totalCommercialCost.amount, "same engine, same result");
assert.equal("calculationId" in technical || "fingerprint" in technical, false, "no reference a proposal could use");
assert.equal(stored.length, 0, "never stored as a calculation");
const allowed = audits.filter((event) => event.action === "TECHNICAL_DEROGATION_SIMULATION" && event.outcome === "ALLOWED");
assert.equal(allowed.length, 1);
assert.deepEqual({ principalId: allowed[0].principalId, tenantId: allowed[0].tenantId, resourceId: allowed[0].resourceId, metadata: allowed[0].metadata }, { principalId: "user_director", tenantId, resourceId: "bill-qa-ee", metadata: { billVersionId, archiveId: "CTE_QA_THRESHOLD", cteVersionId: "CTE_QA_THRESHOLD-version-1", derogatedRequirement: "CONSUMPTION_THRESHOLD_MISMATCH" } });
assert.ok(allowed[0].timestamp);
assert.equal(JSON.stringify(allowed[0]).includes("QA Customer"), false, "no customer data in the audit");

// No proposal: the server rebuilds a proposal only from a stored calculation, and a technical one never is.
await assert.rejects(resolveAuthoritativeProposalInput(repositories, { sourceType: "CALCULATION", calculationId: engine.calculationId, calculationFingerprint: engine.fingerprint }, tenantId, "CALCULATION"), /PROPOSAL_CALCULATION_RECORD_INVALID/);

// Area Manager, agent, company admin and another company: denied, and the denial is audited.
for (const principal of [area, agent, companyAdmin]) await assert.rejects(runTechnicalDerogation(principal, repositories, input("CTE_QA_THRESHOLD"), calculate), /TECHNICAL_DEROGATION_DENIED/);
await assert.rejects(runTechnicalDerogation(outsider, repositories, input("CTE_QA_THRESHOLD"), calculate), /TECHNICAL_DEROGATION_DENIED/);
assert.equal(audits.filter((event) => event.action === "TECHNICAL_DEROGATION_SIMULATION" && event.outcome === "DENIED").length, 4);
// A Direttore of another company would not see this bill nor its CTEs (tenant-scoped repositories).
const otherCompany = { ...repositories, foundationMemberships: { async list(tenant) { return tenant === otherTenantId ? [{ ...member("user_director", "SALES_MANAGER"), tenantId: otherTenantId, payload: { ...member("user_director", "SALES_MANAGER").payload, tenantId: otherTenantId } }] : []; } }, orgChain: { async list(tenant) { return tenant === otherTenantId ? chain.map((record) => ({ ...record, tenantId: otherTenantId })) : []; } } };
assert.equal(await isCompanyDirector(outsider, otherCompany), true);
await assert.rejects(runTechnicalDerogation(outsider, otherCompany, input("CTE_QA_THRESHOLD"), calculate), /SOURCE_BILL_NOT_FOUND/);
await assert.rejects(runTechnicalDerogation(director, repositories, input("CTE_QA_OTHER_TENANT"), calculate), /TECHNICAL_DEROGATION_CTE_UNAVAILABLE/);

// Only the threshold, only on an active CTE: blocked, other reasons too, eligible, unknown version.
await assert.rejects(runTechnicalDerogation(director, repositories, input("CTE_QA_BLOCKED"), calculate), /TECHNICAL_DEROGATION_REQUIREMENT_NOT_DEROGABLE/);
await assert.rejects(runTechnicalDerogation(director, repositories, input("CTE_QA_TWO_REASONS"), calculate), /TECHNICAL_DEROGATION_REQUIREMENT_NOT_DEROGABLE/);
await assert.rejects(runTechnicalDerogation(director, repositories, input("CTE_QA_ELIGIBLE"), calculate), /TECHNICAL_DEROGATION_NOT_NEEDED/);
await assert.rejects(runTechnicalDerogation(director, repositories, { ...input("CTE_QA_THRESHOLD"), cteVersionId: "stale" }, calculate), /TECHNICAL_DEROGATION_CTE_UNAVAILABLE/);
// A CTE the company excluded from the Direttore's limits is not offered at all, so not derogable either.
const limited = { ...repositories, orgChain: { async list() { return chain.map((record) => record.payload.userId === "user_director" ? { ...record, payload: { ...record.payload, limits: { ...record.payload.limits, excludedCteArchiveIds: ["CTE_QA_THRESHOLD"] } } } : record); } } };
await assert.rejects(runTechnicalDerogation(director, limited, input("CTE_QA_THRESHOLD"), calculate), /TECHNICAL_DEROGATION_CTE_UNAVAILABLE/);

// Nothing changed: bill, CTE (status, thresholds), annual consumption; the ordinary quote is the same after the simulation.
assert.equal(JSON.stringify({ bill, ctes }), before);
assert.deepEqual((await prepareBillDrivenSimulation(director, repositories, "bill-qa-ee", "EXCLUDED", "2026-09-16")).candidates.map((item) => [item.cteId, item.finalStatus]), ordinary.candidates.map((item) => [item.cteId, item.finalStatus]));

// Wiring: the route never stores, the context says who may, the screen marks the result and offers no proposal from it.
const route = readFileSync(new URL("../app/api/simulation/technical/route.ts", import.meta.url), "utf8");
assert.match(route, /requestPrincipal\(request, "OPERATE"\)/);
assert.doesNotMatch(route, /calculationResults|comparisonResults|proposal/i);
const context = readFileSync(new URL("../app/api/simulation/context/route.ts", import.meta.url), "utf8");
assert.match(context, /canRunTechnicalDerogation: await isCompanyDirector\(principal, repositories\)/);
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /Simulazione tecnica in deroga<\/button>/);
const panel = flow.slice(flow.indexOf("function TechnicalSimulation"), flow.indexOf("function Steps"));
assert.match(panel, /result\.banner/);
assert.doesNotMatch(panel, /saveProposal|proposta in PDF|onPresentation/);

clearAuditRepository();
console.log("technical derogation ok");
