import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive, expireCteArchive, expireCteArchives } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "cte-expiry-smoke-"));
const tenant = "tenant_cte-expiry";
try {
  const repository = new LocalCteArchiveRepository(root);
  const source = await createCteArchive(repository, {
    tenantId: tenant,
    actor: "fixture",
    now: "2026-01-01T00:00:00.000Z",
    contract: { ...structuredClone(syntheticElectricityCte), tenantId: tenant, cteId: "cte-expiry", recordId: "cte-expiry" },
  });
  const expired = await expireCteArchive(repository, tenant, source.archiveId, "SYSTEM", "2027-01-01T00:00:00.000Z");
  assert.equal(expired.currentApprovedVersionId, null);
  assert.equal(expired.versions[0].status, "EXPIRED");
  assert.equal(expired.history.at(-1).type, "EXPIRED");
  assert.equal((await expireCteArchive(repository, tenant, source.archiveId, "SYSTEM", "2027-01-01T00:00:00.000Z")).history.length, expired.history.length);
  const run = await expireCteArchives(repository, tenant, "SYSTEM", "2027-01-02T00:00:00.000Z");
  assert.equal(run.expired, 0);
  assert.equal((await repository.get(tenant, source.archiveId)).currentApprovedVersionId, null);
  assert.equal(run.deleted, 0, "an already expired CTE is not deleted again");
  // A CTE whose validity ends is expired and removed from the commercial archive in the same run.
  const second = await createCteArchive(repository, { tenantId: tenant, actor: "fixture", now: "2026-01-01T00:00:00.000Z", contract: { ...structuredClone(syntheticElectricityCte), tenantId: tenant, cteId: "cte-expiry-2", recordId: "cte-expiry-2" } });
  assert.equal((await expireCteArchives(repository, tenant, "SYSTEM", "2026-01-02T00:00:00.000Z")).deleted, 0, "a valid CTE stays");
  const retired = await expireCteArchives(repository, tenant, "SYSTEM", "2027-01-03T00:00:00.000Z");
  assert.equal(retired.deleted, 1); assert.equal(retired.expired, 1);
  const stored = await repository.get(tenant, second.archiveId);
  assert.equal(stored.commercialStatus, "DELETED"); assert.equal(stored.currentApprovedVersionId, null);
  assert.deepEqual(stored.history.slice(-2).map((item) => item.type), ["COMMERCIAL_DELETED", "EXPIRED"]);
  console.log("cte-expiry.smoke: PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
