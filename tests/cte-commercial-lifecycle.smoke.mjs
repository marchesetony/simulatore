import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { syntheticElectricityPun } from "../app/lib/energy/synthetic-fixtures.ts";
import { blockCteArchive, commercialStatusOf, createCteArchive, deleteCteArchive, reactivateCteArchive, toPublicCteApprovedArchiveDetail, toPublicCteApprovedArchiveSummary } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { createMarketArchive } from "../app/lib/market/service.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { assertCommerciallyActive } from "../app/lib/calculation/engine.ts";
import { compareApprovedOffers } from "../app/lib/comparison/service.ts";

const tenant = "tenant_commercial-lifecycle";
const otherTenant = "tenant_other-commercial";
const root = await mkdtemp(path.join(os.tmpdir(), "cte-commercial-lifecycle-"));
const clone = (value) => structuredClone(value);

function request() {
  return parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 } }, tenant);
}

try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const marketRepository = new LocalMarketArchiveRepository(path.join(root, "market"));
  const contract = { ...clone(syntheticElectricityCte), tenantId: tenant, recordId: "cte-commercial-lifecycle", cteId: "cte-commercial-lifecycle" };
  const market = { ...clone(syntheticElectricityPun), tenantId: tenant, recordId: "pun-2026-01-commercial", month: "2026-01", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01", publicationDate: "2026-01-01" };
  await createMarketArchive(marketRepository, { tenantId: tenant, record: market, actor: "SMOKE", now: "2026-01-02T00:00:00.000Z" });
  const source = await createCteArchive(cteRepository, { tenantId: tenant, contract, actor: "SMOKE", now: "2026-01-02T00:00:00.000Z" });
  const approvedContract = clone(source.versions.find((version) => version.versionId === source.currentApprovedVersionId).contract);
  assert.equal(commercialStatusOf(source), "ACTIVE");
  assert.equal(toPublicCteApprovedArchiveSummary(source)?.commercialStatus, "ACTIVE");

  await assertCommerciallyActive(cteRepository, tenant, source.archiveId, source.currentApprovedVersionId);
  await assert.rejects(() => blockCteArchive(cteRepository, tenant, source.archiveId, "SMOKE", ""), /COMMERCIAL_REASON_REQUIRED/);

  const blocked = await blockCteArchive(cteRepository, tenant, source.archiveId, "principal-blocker", "Verifica commerciale richiesta", "2026-01-03T00:00:00.000Z");
  assert.equal(blocked.commercialStatus, "BLOCKED");
  assert.equal(blocked.blockedBy, "principal-blocker");
  assert.equal(blocked.blockReason, "Verifica commerciale richiesta");
  const historyAfterBlock = blocked.history.length;
  const repeatedBlock = await blockCteArchive(cteRepository, tenant, source.archiveId, "other-principal", "Nuovo motivo ignorato", "2026-01-04T00:00:00.000Z");
  assert.equal(repeatedBlock.history.length, historyAfterBlock);
  assert.equal((await compareApprovedOffers(cteRepository, marketRepository, request())).results.some((result) => result.sourceCte.archiveId === source.archiveId), false);
  assert.ok((await compareApprovedOffers(cteRepository, marketRepository, request())).excludedOffers.some((offer) => offer.archiveId === source.archiveId && offer.code === "CTE_COMMERCIAL_BLOCKED"));
  await assert.rejects(() => assertCommerciallyActive(cteRepository, tenant, source.archiveId, source.currentApprovedVersionId), /CTE_COMMERCIAL_BLOCKED/);
  const blockedDetail = toPublicCteApprovedArchiveDetail(blocked);
  assert.equal(blockedDetail.commercialStatus, "BLOCKED");
  assert.equal(blockedDetail.blockReason, "Verifica commerciale richiesta");

  const active = await reactivateCteArchive(cteRepository, tenant, source.archiveId, "principal-reactivator", "2026-01-05T00:00:00.000Z");
  assert.equal(active.commercialStatus, "ACTIVE");
  assert.equal(active.blockReason, "Verifica commerciale richiesta");
  assert.equal(active.blockedBy, "principal-blocker");
  assert.equal(active.reactivatedBy, "principal-reactivator");
  const historyAfterReactivate = active.history.length;
  assert.equal((await reactivateCteArchive(cteRepository, tenant, source.archiveId, "other-principal", "2026-01-06T00:00:00.000Z")).history.length, historyAfterReactivate);
  await assertCommerciallyActive(cteRepository, tenant, source.archiveId, source.currentApprovedVersionId);

  const blockedAgain = await blockCteArchive(cteRepository, tenant, source.archiveId, "principal-blocker", "Second review", "2026-01-07T00:00:00.000Z");
  const deleted = await deleteCteArchive(cteRepository, tenant, source.archiveId, "principal-deleter", "2026-01-08T00:00:00.000Z");
  assert.equal(deleted.commercialStatus, "DELETED");
  assert.deepEqual(deleted.versions.find((version) => version.versionId === source.currentApprovedVersionId).contract, approvedContract);
  assert.equal(deleted.deletedBy, "principal-deleter");
  assert.equal(toPublicCteApprovedArchiveSummary(deleted), null);
  assert.equal(toPublicCteApprovedArchiveDetail(deleted), null);
  assert.equal((await deleteCteArchive(cteRepository, tenant, source.archiveId, "other-principal", "2026-01-09T00:00:00.000Z")).history.length, deleted.history.length);
  await assert.rejects(() => assertCommerciallyActive(cteRepository, tenant, source.archiveId, source.currentApprovedVersionId), /CTE_COMMERCIAL_DELETED/);
  await assert.rejects(() => reactivateCteArchive(cteRepository, tenant, source.archiveId, "principal-reactivator"), /CTE_COMMERCIAL_DELETED_IMMUTABLE/);
  await assert.rejects(() => blockCteArchive(cteRepository, tenant, source.archiveId, "principal-blocker", "Not allowed"), /CTE_COMMERCIAL_DELETED_IMMUTABLE/);
  assert.equal(await cteRepository.get(otherTenant, source.archiveId), null);
  assert.ok(blockedAgain.history.some((event) => event.type === "COMMERCIAL_BLOCKED"));
  assert.ok(deleted.history.some((event) => event.type === "COMMERCIAL_REACTIVATED"));
  assert.ok(deleted.history.some((event) => event.type === "COMMERCIAL_DELETED"));

  const activeDeleteSource = await createCteArchive(cteRepository, { tenantId: tenant, contract: { ...clone(contract), recordId: "cte-commercial-active-delete", cteId: "cte-commercial-active-delete", validity: { ...clone(contract.validity), periodStart: "2027-01-01", periodEnd: "2027-12-31" }, expiry: { ...clone(contract.expiry), date: "2027-12-31" } }, actor: "SMOKE", now: "2026-01-10T00:00:00.000Z" });
  const activeDeleteSnapshot = clone(activeDeleteSource.versions.find((version) => version.versionId === activeDeleteSource.currentApprovedVersionId).contract);
  const directlyDeleted = await deleteCteArchive(cteRepository, tenant, activeDeleteSource.archiveId, "principal-direct-deleter", "2026-01-11T00:00:00.000Z");
  assert.equal(directlyDeleted.commercialStatus, "DELETED");
  assert.equal(directlyDeleted.deletedBy, "principal-direct-deleter");
  assert.deepEqual(directlyDeleted.versions.find((version) => version.versionId === activeDeleteSource.currentApprovedVersionId).contract, activeDeleteSnapshot);
  assert.equal((await deleteCteArchive(cteRepository, tenant, activeDeleteSource.archiveId, "other-principal", "2026-01-12T00:00:00.000Z")).history.length, directlyDeleted.history.length);

  const ui = await readFile(new URL("../app/components/CteIngestionPanel.tsx", import.meta.url), "utf8");
  const blockRoute = await readFile(new URL("../app/api/cte/archive/[id]/block/route.ts", import.meta.url), "utf8");
  const reactivateRoute = await readFile(new URL("../app/api/cte/archive/[id]/reactivate/route.ts", import.meta.url), "utf8");
  const deleteRoute = await readFile(new URL("../app/api/cte/archive/[id]/route.ts", import.meta.url), "utf8");
  const calculation = await readFile(new URL("../app/lib/calculation/engine.ts", import.meta.url), "utf8");
  const proposal = await readFile(new URL("../app/lib/proposal/api.ts", import.meta.url), "utf8");
  assert.match(ui, /commercialStatus/);
  assert.match(ui, /Blocca/);
  assert.match(ui, /Riattiva/);
  assert.match(ui, /Cancella/);
  assert.match(ui, /Cancellazione in corso/);
  assert.match(ui, /ranking/);
  assert.match(ui, /Motivo del blocco/);
  assert.match(blockRoute, /requestPrincipal\(request, "WRITE"\)/);
  assert.match(reactivateRoute, /reactivateCteArchive/);
  assert.match(deleteRoute, /export async function DELETE/);
  assert.match(calculation, /CTE_COMMERCIAL_BLOCKED/);
  assert.match(calculation, /CTE_COMMERCIAL_DELETED/);
  assert.match(proposal, /assertCommerciallyActive/);
  console.log("cte commercial lifecycle smoke: ok (active/block/reactivate/delete, idempotency, history, tenant isolation and server eligibility guards)");
} finally {
  await rm(root, { recursive: true, force: true });
}
