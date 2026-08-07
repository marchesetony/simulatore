import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syntheticElectricityCte, syntheticGasCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive, createCteCorrection, approveCteArchive, toPublicCteApprovedArchiveDetail, toPublicCteApprovedArchiveSummary } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "cte-approved-human-readable-"));
const tenant = "tenant_approved-readable";
const clone = (value) => structuredClone(value);
const draft = (value) => { const result = clone(value); result.tenantId = tenant; result.approval = { status: "DRAFT", reason: "review" }; return result; };

try {
  const repository = new LocalCteArchiveRepository(root);
  const source = await createCteArchive(repository, { tenantId: tenant, contract: draft(syntheticElectricityCte), now: "2026-08-07T00:00:00.000Z" });
  const approved = await approveCteArchive(repository, tenant, source.archiveId, source.currentWorkingVersionId, "reviewer", "decision-ee", "2026-08-07T00:00:01.000Z");
  const summary = toPublicCteApprovedArchiveSummary(approved);
  assert.deepEqual(summary, { archiveId: source.archiveId, vector: "EE", offerName: syntheticElectricityCte.offer.name, supplierName: syntheticElectricityCte.supplier.name, validity: syntheticElectricityCte.validity, status: "APPROVED", commercialStatus: "ACTIVE" });
  assert.doesNotMatch(JSON.stringify(summary), /recordId|tenantId|cteId|offerId|versionId|objectKey|ingestionId/);
  const detail = toPublicCteApprovedArchiveDetail(approved);
  assert.equal(detail.status, "APPROVED");
  assert.equal(detail.contract.offer.name, syntheticElectricityCte.offer.name);
  assert.equal(detail.contract.offer.code, syntheticElectricityCte.offer.code);
  assert.equal(detail.contract.supplier.supplierId, syntheticElectricityCte.supplier.supplierId);
  assert.equal(detail.contract.pricing.reference, "PUN");
  assert.equal(detail.contract.pricing.spread.unit, "EUR_PER_KWH");
  assert.equal(detail.contract.commercialTerms.fixedFees[0].unit, "EUR_PER_MONTH");
  assert.doesNotMatch(JSON.stringify(detail), /recordId|tenantId|cteId|offerId|versionId|objectKey|ingestionId|feeId/);

  const correctedContract = clone(syntheticElectricityCte);
  correctedContract.tenantId = tenant;
  correctedContract.pricing.spread.amount = 0.021;
  const workingCorrection = await createCteCorrection(repository, { tenantId: tenant, archiveId: source.archiveId, expectedVersionId: approved.currentWorkingVersionId, contract: correctedContract, now: "2026-08-07T00:00:02.000Z" });
  assert.equal(workingCorrection.currentWorkingVersionId !== workingCorrection.currentApprovedVersionId, true);
  const approvedStillAuthoritative = toPublicCteApprovedArchiveDetail(workingCorrection);
  assert.equal(approvedStillAuthoritative.contract.pricing.spread.amount, syntheticElectricityCte.pricing.spread.amount);

  const gasSource = await createCteArchive(repository, { tenantId: tenant, contract: draft(syntheticGasCte), archiveId: "cte-gas-readable", now: "2026-08-07T00:00:03.000Z" });
  const gasApproved = await approveCteArchive(repository, tenant, gasSource.archiveId, gasSource.currentWorkingVersionId, "reviewer", "decision-gas", "2026-08-07T00:00:04.000Z");
  const gasDetail = toPublicCteApprovedArchiveDetail(gasApproved);
  assert.equal(gasDetail.contract.vector, "GAS");
  assert.equal(gasDetail.contract.pricing.reference, "PSV");
  assert.equal(gasDetail.contract.pricing.spread.unit, "EUR_PER_SMC");

  const ui = await readFile(new URL("../app/components/CteIngestionPanel.tsx", import.meta.url), "utf8");
  const listRoute = await readFile(new URL("../app/api/cte/archive/route.ts", import.meta.url), "utf8");
  const detailRoute = await readFile(new URL("../app/api/cte/archive/[id]/route.ts", import.meta.url), "utf8");
  assert.match(ui, /record\.offerName/);
  assert.match(ui, /openApprovedArchive/);
  assert.match(ui, /view=approved/);
  assert.match(ui, /Nome offerta/);
  assert.match(ui, /Codice offerta/);
  assert.match(ui, /Torna all.*Archivio approvato/);
  assert.doesNotMatch(ui, /record\.cteId.*currentWorkingVersionId/);
  assert.match(listRoute, /toPublicCteApprovedArchiveSummary/);
  assert.match(detailRoute, /toPublicCteApprovedArchiveDetail/);
  assert.match(detailRoute, /localTenant\(request, "READ"\)/);
  console.log("cte approved archive human-readable smoke: ok (approved contract detail, safe public mapping, version authority, EE/GAS separation and UI navigation)");
} finally {
  await rm(root, { recursive: true, force: true });
}
