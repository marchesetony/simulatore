import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { approveCteArchive, createCteArchive, createCteCorrection, reviewCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { approveCteIngestion } from "../app/lib/cte/ingestion.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "cte-archive-security-"));
const tenantA = "tenant_security-a";
const tenantB = "tenant_security-b";
const clone = (value) => structuredClone(value);
const draft = (value, tenantId, cteId) => {
  const contract = clone(value);
  contract.tenantId = tenantId;
  contract.cteId = cteId;
  contract.recordId = cteId;
  contract.approval = { status: "DRAFT", reason: "SECURITY_TEST" };
  return contract;
};
const fails = async (operation, code) => assert.rejects(operation, (error) => error?.code === code || error?.message === code);

try {
  const archiveRoute = await readFile(new URL("../app/api/cte/archive/route.ts", import.meta.url), "utf8");
  const directApproveRoute = await readFile(new URL("../app/api/cte/archive/[id]/approve/route.ts", import.meta.url), "utf8");
  const archiveApi = await readFile(new URL("../app/lib/archive/api.ts", import.meta.url), "utf8");
  assert.match(archiveRoute, /localTenant\(request, "READ"\)/);
  assert.match(archiveRoute, /localTenant\(request, "WRITE"\)/);
  assert.match(archiveRoute, /CTE_DIRECT_ARCHIVE_FORBIDDEN/);
  assert.doesNotMatch(archiveRoute, /createCteArchive|repository\.save|approveCteArchive/);
  assert.match(directApproveRoute, /CTE_DIRECT_ARCHIVE_FORBIDDEN/);
  assert.doesNotMatch(directApproveRoute, /approveCteArchive|repository\.save/);

  const repository = new LocalCteArchiveRepository(path.join(root, "archive"));
  const source = await createCteArchive(repository, { tenantId: tenantA, contract: draft(syntheticElectricityCte, tenantA, "cte-security-main"), now: "2026-09-15T00:00:00.000Z" });
  await fails(approveCteArchive(repository, tenantA, source.archiveId, source.currentWorkingVersionId, "user_security", "decision-draft"), "CTE_VERSION_NOT_APPROVABLE");
  assert.equal((await repository.get(tenantA, source.archiveId)).currentApprovedVersionId, null);

  const reviewed = await reviewCteArchive(repository, tenantA, source.archiveId, source.currentWorkingVersionId, "user_security", "2026-09-15T00:00:01.000Z");
  assert.equal(reviewed.versions[0].status, "REVIEWED");
  assert.equal(reviewed.versions[0].contract.approval.status, "NEEDS_REVIEW");
  await fails(approveCteArchive(repository, tenantA, source.archiveId, source.currentWorkingVersionId, "user_security", "decision-without-audit", "2026-09-15T00:00:02.000Z"), "APPROVAL_AUDIT_REQUIRED");

  let auditContext;
  const approved = await approveCteArchive(repository, tenantA, source.archiveId, source.currentWorkingVersionId, "user_security", "decision-reviewed", "2026-09-15T00:00:02.000Z", async (event) => { auditContext = event; });
  assert.equal(approved.currentApprovedVersionId, source.currentWorkingVersionId);
  assert.deepEqual(auditContext, { tenantId: tenantA, archiveId: source.archiveId, cteId: source.cteId, versionId: source.currentWorkingVersionId, actor: "user_security", timestamp: "2026-09-15T00:00:02.000Z", previousState: "REVIEWED", newState: "APPROVED" });
  const directRepositoryRecord = clone(approved);
  directRepositoryRecord.archiveId = "cte-security-direct-repository";
  await fails(repository.save(directRepositoryRecord), "CTE_APPROVAL_WORKFLOW_REQUIRED");
  const approvalCount = approved.approvals.length;
  await fails(approveCteArchive(repository, tenantA, source.archiveId, source.currentWorkingVersionId, "user_security", "decision-duplicate", undefined, async () => {}), "CTE_VERSION_ALREADY_APPROVED");
  assert.equal((await repository.get(tenantA, source.archiveId)).approvals.length, approvalCount);
  await fails(approveCteArchive(repository, tenantA, source.archiveId, "stale-version", "user_security", "decision-stale", undefined, async () => {}), "CTE_VERSION_NOT_CURRENT");
  await fails(approveCteArchive(repository, tenantB, source.archiveId, source.currentWorkingVersionId, "user_security", "decision-cross-tenant", undefined, async () => {}), "CTE_ARCHIVE_NOT_FOUND");
  assert.equal((await repository.list(tenantB)).length, 0);
  const correctionContract = draft(syntheticElectricityCte, tenantA, source.cteId);
  correctionContract.validity = { periodStart: "2027-01-01", periodEnd: "2028-01-01" };
  correctionContract.expiry = { status: "EXPIRES_ON", date: "2027-12-31" };
  const correction = await createCteCorrection(repository, { tenantId: tenantA, archiveId: source.archiveId, expectedVersionId: approved.currentWorkingVersionId, contract: correctionContract, now: "2026-09-15T00:00:03.000Z" });
  const correctionReviewed = await reviewCteArchive(repository, tenantA, correction.archiveId, correction.currentWorkingVersionId, "user_security", "2026-09-15T00:00:04.000Z");
  const directLaterPromotion = clone(correctionReviewed);
  const latest = directLaterPromotion.versions.find((version) => version.versionId === directLaterPromotion.currentWorkingVersionId);
  latest.status = "APPROVED";
  latest.contract.approval = { status: "APPROVED", reviewer: "user_security", reviewedAt: "2026-09-15T00:00:05.000Z", decisionId: "forged" };
  directLaterPromotion.currentApprovedVersionId = latest.versionId;
  await fails(repository.save(directLaterPromotion), "CTE_APPROVAL_WORKFLOW_REQUIRED");

  const auditFailureContract = draft(syntheticElectricityCte, tenantA, "cte-security-audit-failure");
  auditFailureContract.validity = { periodStart: "2027-01-01", periodEnd: "2028-01-01" };
  auditFailureContract.expiry = { status: "EXPIRES_ON", date: "2027-12-31" };
  const auditFailureSource = await createCteArchive(repository, { tenantId: tenantA, contract: auditFailureContract, now: "2026-09-15T00:00:03.000Z" });
  const auditFailureReviewed = await reviewCteArchive(repository, tenantA, auditFailureSource.archiveId, auditFailureSource.currentWorkingVersionId, "user_security", "2026-09-15T00:00:04.000Z");
  await fails(approveCteArchive(repository, tenantA, auditFailureReviewed.archiveId, auditFailureReviewed.currentWorkingVersionId, "user_security", "decision-audit-failure", "2026-09-15T00:00:05.000Z", async () => { throw new Error("AUDIT_WRITE_FAILED"); }), "AUDIT_WRITE_FAILED");
  const afterAuditFailure = await repository.get(tenantA, auditFailureSource.archiveId);
  assert.equal(afterAuditFailure.currentApprovedVersionId, null);
  assert.equal(afterAuditFailure.versions[0].status, "REVIEWED");

  const failedIngestion = { schemaVersion: 1, recordId: "cte-security-failed-ingestion", tenantId: tenantA, version: 1, createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:00:00.000Z", payload: { status: "FAILED" } };
  await fails(approveCteIngestion({ tenantId: tenantA, ingestionId: failedIngestion.recordId, actor: "user_security", repository: { async get() { return failedIngestion; } }, archive: { async create() { throw new Error("ARCHIVE_CREATE_MUST_NOT_RUN"); }, async approve() { throw new Error("ARCHIVE_APPROVE_MUST_NOT_RUN"); } } }), "CTE_REVIEW_REQUIRED");

  assert.match(archiveApi, /AUTHENTICATION_REQUIRED.*401/);
  assert.match(archiveApi, /TENANT_MISMATCH.*403/);
  assert.match(archiveApi, /CTE_DIRECT_ARCHIVE_FORBIDDEN.*403/);
  assert.match(archiveApi, /CTE_VERSION_NOT_CURRENT.*409/);
  assert.match(archiveApi, /CTE_APPROVAL_NOT_READY.*422/);
  console.log("cte archive security smoke: ok (direct archive denial, tenant isolation, reviewed-only approval, audit fail-closed and idempotency)");
} finally {
  await rm(root, { recursive: true, force: true });
}
