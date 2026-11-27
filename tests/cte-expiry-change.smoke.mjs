import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { changeCteExpiry, createCteArchive, toPublicCteApprovedArchiveSummary } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";

const tenant = "tenant_expiry-smoke";
const approval = { status: "APPROVED", reviewer: "smoke-reviewer", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "smoke-approval" };
const contract = { ...structuredClone(syntheticElectricityCte), recordId: "cte-expiry", cteId: "cte-expiry", tenantId: tenant, approval, validity: { periodStart: "2026-01-01", periodEnd: "2026-06-30" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" } };
const audits = [];
const audit = async (event) => { audits.push(event); };

const root = await mkdtemp(path.join(os.tmpdir(), "cte-expiry-"));
try {
  const repository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const created = await createCteArchive(repository, { tenantId: tenant, contract, now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  assert.equal(toPublicCteApprovedArchiveSummary(created).activeUntil, "2026-06-30");

  // Only the expiry changes; it becomes a new approved version and the previous one stays in history.
  const earlier = await changeCteExpiry(repository, { tenantId: tenant, archiveId: created.archiveId, date: "31/03/2026", actor: "admin-1", audit, now: "2026-01-10T00:00:00.000Z" });
  const summary = toPublicCteApprovedArchiveSummary(earlier);
  assert.equal(summary.activeUntil, "2026-03-31");
  assert.equal(summary.validity.periodEnd, "2026-06-30");
  assert.equal(earlier.versions.length, 2);
  assert.ok(earlier.history.some((event) => event.reason === "Scadenza modificata al 2026-03-31"));
  assert.equal(audits.length, 1);

  // A later expiry also extends validity, since a CTE cannot expire after its validity ends.
  const later = await changeCteExpiry(repository, { tenantId: tenant, archiveId: created.archiveId, date: "2026-09-30", actor: "admin-1", audit, now: "2026-01-11T00:00:00.000Z" });
  assert.equal(toPublicCteApprovedArchiveSummary(later).activeUntil, "2026-09-30");
  assert.equal(toPublicCteApprovedArchiveSummary(later).validity.periodEnd, "2026-09-30");

  await assert.rejects(changeCteExpiry(repository, { tenantId: tenant, archiveId: created.archiveId, date: "2026-01-05", actor: "admin-1", audit, now: "2026-01-12T00:00:00.000Z" }), /CTE_EXPIRY_DATE_INVALID/);
  await assert.rejects(changeCteExpiry(repository, { tenantId: tenant, archiveId: created.archiveId, date: "domani", actor: "admin-1", audit, now: "2026-01-12T00:00:00.000Z" }), /CTE_EXPIRY_DATE_INVALID/);
  console.log("cte expiry change smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
