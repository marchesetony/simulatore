import assert from "node:assert/strict";
import { test } from "node:test";
import { createMarketSnapshot } from "../modules/market/service.ts";
import { createRegulatorySnapshot } from "../modules/regulatory/service.ts";
import { digest } from "../modules/market/integrity.ts";
import { validatePublication } from "../modules/market/acquisition.ts";
import { at, version, marketCatalog, marketRequest, regulatoryCatalog, regulatoryRequest, authorityFor, attempt, publication, component } from "./market-regulatory-fixtures.mjs";
import { emptyBatch, MemoryRepository } from "./market-regulatory-memory.mjs";

function setup(kind = "market") {
  const c = kind === "market" ? marketCatalog() : regulatoryCatalog(), authority = authorityFor(c);
  const s = kind === "market" ? createMarketSnapshot(marketRequest(c), c, authority) : createRegulatorySnapshot(regulatoryRequest(c), c, authority);
  return { c, s, repo: new MemoryRepository(kind, authority), batch: { ...emptyBatch(), sources: c.sources,
    versions: c.versions, records: c.observations ?? c.components, snapshots: [s] } };
}
const guard = (expectedRevision = 0, idempotencyKey = "batch-a") => ({ expectedRevision, idempotencyKey });

test("09 correction is append-only and cannot overwrite a version or snapshot", async () => {
  const { c, s, repo, batch } = setup(); await repo.commit(batch, guard());
  await assert.rejects(repo.commit({ ...emptyBatch(), versions: [{ ...c.versions[0], revision: "changed" }] }, guard(1, "overwrite")), { code: "IMMUTABLE_CONFLICT" });
  const corrected = version("version-b", at, "version-a");
  await repo.commit({ ...emptyBatch(), versions: [corrected] }, guard(1, "correction"));
  assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
  assert.equal((await repo.selectAsOf(["version-a"], at))[0].revision, "version-a");
  await assert.rejects(repo.commit({ ...emptyBatch(), snapshots: [s] }, guard(2, "snapshot-overwrite")), { code: "IMMUTABLE_CONFLICT" });
});
test("23 partial publication rejected atomically with no writes or revision increment", async () => {
  const { s, repo, batch } = setup();
  await assert.rejects(repo.commit({ ...batch, records: batch.records.slice(0, 2) }, guard()), { code: "MISSING_VALUE" });
  assert.equal(repo.revision, 0); assert.equal(await repo.getSnapshot(s.snapshotId), null);
  await repo.commit(batch, guard()); assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
});
test("24 competing CAS writes: exactly one winner and no partial loser", async () => {
  const { repo, batch } = setup();
  const results = await Promise.allSettled([repo.commit(batch, guard(0, "winner")), repo.commit(batch, guard(0, "loser"))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "CONCURRENCY_CONFLICT");
  assert.equal(repo.revision, 1);
});
test("25 identical retry is idempotent; same key different payload fails", async () => {
  const { repo, batch } = setup(), first = await repo.commit(batch, guard());
  assert.deepEqual(await repo.commit(batch, guard()), first); assert.equal(repo.revision, 1);
  await assert.rejects(repo.commit({ ...batch, attempts: [attempt()] }, guard()), { code: "IMMUTABLE_CONFLICT" });
});
test("26 failed refresh records error without losing existing snapshot", async () => {
  const { repo, batch, s } = setup(); await repo.commit(batch, guard());
  await repo.commit({ ...emptyBatch(), attempts: [attempt("ERROR")] }, guard(1, "refresh"));
  assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
  await assert.rejects(repo.commit({ ...emptyBatch(), attempts: [{ ...attempt("ERROR"), attemptId: "bad-source", sourceId: "unknown" }] }, guard(2, "bad-refresh")), { code: "UNKNOWN_SOURCE" });
  assert.equal(repo.revision, 2); assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
});
test("regulatory atomic publication follows the same contract", async () => {
  const { repo, batch, s } = setup("regulatory"); await repo.commit(batch, guard());
  assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
  assert.equal((await repo.selectAsOf(["version-a"], at))[0].versionId, "version-a");
});
test("dangling correction and published attempt without snapshot fail closed", async () => {
  const { repo, batch } = setup();
  await assert.rejects(repo.commit({ ...batch, versions: [version("version-b", at, "missing")] }, guard()), { code: "INCOMPATIBLE_VERSION" });
  await assert.rejects(repo.commit({ ...batch, snapshots: [], attempts: [attempt("PUBLISHED")] }, guard()), { code: "INVALID_PUBLICATION" });
  assert.equal(repo.revision, 0);
});

test("H1 unresolved relationship cannot be published and leaves repository unchanged", async () => {
  const { repo, batch, s } = setup("regulatory");
  const invalid = component({ includes: ["absent"] });
  await assert.rejects(repo.commit({ ...batch, records: [invalid] }, guard()), { code: "UNRESOLVED_RELATION" });
  assert.equal(repo.revision, 0); assert.equal(await repo.getSnapshot(s.snapshotId), null);
});
test("H2 publication rejects altered content both with original and recomputed hashes", async () => {
  const { repo, batch, s } = setup(), changed = structuredClone(s); changed.observations[0].value = "99";
  await assert.rejects(repo.commit({ ...batch, snapshots: [changed] }, guard()), { code: "HASH_MISMATCH" });
  delete changed.hash;
  await assert.rejects(repo.commit({ ...batch, snapshots: [{ ...changed, hash: digest(changed) }] }, guard()), { code: "PARTIAL_PUBLICATION" });
  assert.equal(repo.revision, 0); assert.equal(await repo.getSnapshot(s.snapshotId), null);
});
test("M4 publication event, attempt and new snapshot commit atomically with matching identity", async () => {
  const { repo, batch, s } = setup(), a = attempt("PUBLISHED"), event = publication(s, a);
  const command = { ...batch, attempts: [a], publications: [event] };
  const receipt = await repo.commit(command, guard());
  assert.equal(receipt.revision, 1); assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
  assert.deepEqual(await repo.commit(command, guard()), receipt);
});
for (const [name, publishedAt] of [["after attempt finished", "2026-03-03T12:00:00.000Z"], ["before attempt started", "2026-03-01T12:00:00.000Z"]]) {
  test(`M4 publication ${name} is rejected without partial writes`, async () => {
    const { repo, batch, s } = setup(), a = attempt("PUBLISHED"), event = { ...publication(s, a), publishedAt };
    await assert.rejects(repo.commit({ ...batch, attempts: [a], publications: [event] }, guard()), { code: "INVALID_PUBLICATION" });
    assert.equal(repo.revision, 0); assert.equal(await repo.getSnapshot(s.snapshotId), null);
  });
}
test("M4 original backdated publication attempt is rejected", async () => {
  const { repo, batch, s } = setup();
  const a = { ...attempt("PUBLISHED"), scheduledFor: "2026-02-01", startedAt: "2026-02-01T12:00:00.000Z", finishedAt: "2026-02-01T12:00:00.000Z" };
  const event = { ...publication(s, a), publishedAt: a.finishedAt };
  await assert.rejects(repo.commit({ ...batch, attempts: [a], publications: [event] }, guard()), { code: "INVALID_PUBLICATION" });
  assert.equal(repo.revision, 0);
});
test("M4 nonexistent published version is rejected", async () => {
  const { repo, batch, s } = setup(), a = { ...attempt("PUBLISHED"), publishedVersionId: "absent" };
  await assert.rejects(repo.commit({ ...batch, attempts: [a], publications: [publication(s, a)] }, guard()), { code: "VERSION_NOT_FOUND" });
  assert.equal(repo.revision, 0);
});
test("M4/L1 publication validator rejects malformed version ledgers and sparse version arrays directly", () => {
  const { s } = setup(), a = attempt("PUBLISHED"), event = publication(s, a), broken = structuredClone(s);
  delete broken.versions[0].reviews[1];
  assert.throws(() => validatePublication(event, a, broken), { name: "FoundationError", code: "INVALID_INPUT" });
  assert.throws(() => validatePublication(event, a, { ...s, versions: new Array(1) }), { name: "FoundationError", code: "INVALID_INPUT" });
});
test("M4 technically validated but unpublished version cannot produce a publication event", async () => {
  const { repo, batch, s } = setup(), a = attempt("PUBLISHED");
  batch.versions = batch.versions.map(v => ({ ...v, reviews: v.reviews.slice(0, 2) }));
  await assert.rejects(repo.commit({ ...batch, attempts: [a], publications: [publication(s, a)] }, guard()), { code: "VERSION_UNAPPROVED" });
  assert.equal(repo.revision, 0);
});
test("M4 event from a different attempt cannot substantiate PUBLISHED", async () => {
  const { repo, batch, s } = setup(), a = attempt("PUBLISHED"), event = { ...publication(s, a), attemptId: "other-attempt" };
  await assert.rejects(repo.commit({ ...batch, attempts: [a], publications: [event] }, guard()), { code: "INVALID_PUBLICATION" });
  assert.equal(repo.revision, 0);
});
test("M4 existing snapshot alone cannot substantiate a new publication event", async () => {
  const { repo, batch, s } = setup(), a = attempt("PUBLISHED"); await repo.commit(batch, guard());
  await assert.rejects(repo.commit({ ...emptyBatch(), attempts: [a], publications: [publication(s, a)] }, guard(1, "not-a-publication")), { code: "INVALID_PUBLICATION" });
  assert.equal(repo.revision, 1); assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
});
for (const outcome of ["NO_NEW_DATA", "ERROR"]) {
  test(`M4 ${outcome} stays operational and requires no publication event`, async () => {
    const { repo, batch, s } = setup(); await repo.commit(batch, guard());
    const a = attempt(outcome); await repo.commit({ ...emptyBatch(), attempts: [a] }, guard(1, outcome));
    assert.equal(a.publicationEventId, null); assert.equal(a.publishedVersionId, null);
    assert.deepEqual(await repo.getSnapshot(s.snapshotId), s);
  });
}
