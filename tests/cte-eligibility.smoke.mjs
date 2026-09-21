import assert from "node:assert/strict";
import { CTE_EE_APPROVED_FIXED, CTE_GAS_APPROVED_INDEXED } from "./fixtures/cte-product-qa.ts";
import { evaluateCteEligibility, listCteEligibility } from "../app/lib/cte/eligibility.ts";

const tenant = "tenant_qa-company";
const period = { periodStart: "2026-09-01", periodEnd: "2026-10-01" };

function archive(fixture, options = {}) {
  const contract = structuredClone(fixture.contract);
  const versionId = `${fixture.fixtureId}-v1`;
  const status = options.status ?? "APPROVED";
  if (status !== "APPROVED") contract.approval = { status: "DRAFT", reason: "QA" };
  return {
    archiveId: fixture.fixtureId,
    tenantId: options.tenantId ?? tenant,
    cteId: contract.cteId,
    vector: contract.vector,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentWorkingVersionId: versionId,
    currentApprovedVersionId: status === "APPROVED" ? versionId : null,
    versions: [{ versionId, versionNumber: 1, supersedesVersionId: null, status, contract, createdAt: "2026-01-01T00:00:00.000Z" }],
    approvals: [],
    history: [],
    commercialStatus: options.commercialStatus ?? "ACTIVE",
  };
}

const ee = archive(CTE_EE_APPROVED_FIXED);
const gas = archive(CTE_GAS_APPROVED_INDEXED);
const eligibleEe = evaluateCteEligibility(ee, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" });
assert.equal(eligibleEe.eligibilityStatus, "COMPATIBLE");
assert.equal(eligibleEe.eligibilityReason, "CTE_ELIGIBLE");
assert.equal(eligibleEe.pricing.mode, "FIXED");

assert.equal(evaluateCteEligibility(ee, { tenantId: tenant, vector: "EE", customerType: "RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_CUSTOMER_NOT_ELIGIBLE");
assert.equal(evaluateCteEligibility(ee, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "HV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_VOLTAGE_NOT_ELIGIBLE");
assert.equal(evaluateCteEligibility(ee, { tenantId: "tenant_other-qa", vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_TENANT_MISMATCH");
assert.equal(evaluateCteEligibility(ee, { tenantId: tenant, vector: "GAS", customerType: "NON_RESIDENTIAL", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_VECTOR_MISMATCH");
assert.equal(evaluateCteEligibility(archive(CTE_EE_APPROVED_FIXED, { status: "DRAFT" }), { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_NOT_APPROVED");
assert.equal(evaluateCteEligibility(archive(CTE_EE_APPROVED_FIXED, { commercialStatus: "BLOCKED" }), { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_COMMERCIAL_NOT_ACTIVE");

const expired = structuredClone(ee);
expired.versions[0].contract.validity = { periodStart: "2025-01-01", periodEnd: "2027-12-31" };
expired.versions[0].contract.expiry = { status: "EXPIRES_ON", date: "2026-08-01" };
assert.equal(evaluateCteEligibility(expired, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_EXPIRED");

const outsideValidity = structuredClone(ee);
outsideValidity.versions[0].contract.validity = { periodStart: "2025-01-01", periodEnd: "2026-08-01" };
outsideValidity.versions[0].contract.expiry = { status: "EXPIRES_ON", date: "2026-08-01" };
assert.equal(evaluateCteEligibility(outsideValidity, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_VALIDITY_MISMATCH");

const unsupportedPricing = structuredClone(ee);
unsupportedPricing.versions[0].contract.pricing.reference = "PSV";
assert.equal(evaluateCteEligibility(unsupportedPricing, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_PRICING_UNSUPPORTED");
const unsupportedMode = structuredClone(ee);
unsupportedMode.versions[0].contract.pricing.mode = "UNSUPPORTED";
assert.equal(evaluateCteEligibility(unsupportedMode, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_PRICING_UNSUPPORTED");

const notBta6 = structuredClone(ee);
notBta6.versions[0].contract.eligibility.voltageLevels = ["MV"];
assert.equal(evaluateCteEligibility(notBta6, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "MV", bta6Required: true, supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityReason, "CTE_BTA6_NOT_ELIGIBLE");

assert.equal(evaluateCteEligibility(ee, { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", bta6Required: true, supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityStatus, "COMPATIBLE");
assert.equal(evaluateCteEligibility(gas, { tenantId: tenant, vector: "GAS", customerType: "NON_RESIDENTIAL", supplyPeriod: period, calculationDate: "2026-09-16" }).eligibilityStatus, "COMPATIBLE");

const candidates = listCteEligibility([gas, ee], { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: period, calculationDate: "2026-09-16" });
assert.deepEqual(candidates.map((candidate) => [candidate.archiveId, candidate.eligibilityStatus]), [["CTE_EE_APPROVED_FIXED", "COMPATIBLE"], ["CTE_GAS_APPROVED_INDEXED", "NOT_COMPATIBLE"]]);
assert.equal(candidates[1].eligibilityReason, "CTE_VECTOR_MISMATCH");

console.log("CTE_ELIGIBILITY_SMOKE=PASS");
console.log("CTE_ELIGIBILITY_TENANT_VECTOR_STATUS_VALIDITY_PRICING=PASS");
