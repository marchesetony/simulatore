import assert from "node:assert/strict";
import { evaluateCteEligibility } from "../app/lib/cte/eligibility.ts";

// A competitor bill covers a past period: a CTE valid today is proposable even if it started after that period.
const tenant = "tenant_qa-company";
const contract = {
  cteId: "cte-competitor", version: "1", vector: "EE", approval: { status: "APPROVED" }, supplier: { name: "Fornitore QA" }, offer: { name: "Offerta QA", code: "QA" },
  validity: { periodStart: "2026-10-01", periodEnd: "2026-12-31" }, expiry: { status: "EXPIRES_ON", date: "2026-12-31" },
  pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { unit: "EUR_PER_KWH" } }, eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] },
};
const versionId = "competitor-v1";
const record = { archiveId: "competitor", tenantId: tenant, cteId: contract.cteId, vector: "EE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", currentWorkingVersionId: versionId, currentApprovedVersionId: versionId, versions: [{ versionId, versionNumber: 1, supersedesVersionId: null, status: "APPROVED", contract, createdAt: "2026-01-01T00:00:00.000Z" }], approvals: [], history: [], commercialStatus: "ACTIVE" };
const pastBill = { periodStart: "2026-06-01", periodEnd: "2026-07-01" };
const base = { tenantId: tenant, vector: "EE", customerType: "NON_RESIDENTIAL", voltageLevel: "LV", supplyPeriod: pastBill };

const today = evaluateCteEligibility(record, { ...base, calculationDate: "2026-10-22" }).eligibilityReason;
assert.ok(today !== "CTE_VALIDITY_MISMATCH" && today !== "CTE_EXPIRED", today);
assert.equal(evaluateCteEligibility(record, { ...base, calculationDate: "2026-09-20" }).eligibilityReason, "CTE_VALIDITY_MISMATCH");
assert.equal(evaluateCteEligibility(record, { ...base, calculationDate: "2026-12-31" }).eligibilityReason, "CTE_VALIDITY_MISMATCH");
console.log("cte competitor bill validity: ok");
