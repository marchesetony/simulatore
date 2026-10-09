import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createMarketSnapshot, replayMarket } from "../modules/market/service.ts";
import { createRegulatorySnapshot, replayRegulatory } from "../modules/regulatory/service.ts";
import { parseVersion, transition } from "../modules/market/governance.ts";
import { list, text } from "../modules/market/primitives.ts";
import { parseMarketRequest } from "../modules/market/schema.ts";
import { parseAcquisitionAttempt } from "../modules/market/acquisition.ts";
import { digest } from "../modules/market/integrity.ts";
import { at, source, version, observations, marketCatalog, marketRequest, component,
  regulatoryCatalog, regulatoryRequest, authorityFor, attempt, snapshotEvidence } from "./market-regulatory-fixtures.mjs";
import { emptyBatch, MemoryRepository } from "./market-regulatory-memory.mjs";

test("runtime dependency boundary contains no previous brick, network or test adapter imports", () => {
  for (const directory of [new URL("../modules/market/", import.meta.url), new URL("../modules/regulatory/", import.meta.url)]) {
    for (const name of readdirSync(directory).filter(name => name.endsWith(".ts"))) {
      const content = readFileSync(new URL(name, directory), "utf8");
      const imports = [...content.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)].map(match => match[1]);
      assert.ok(imports.every(path => path === "server-only" || path === "node:crypto" || /^\.\/(?!.*\.\.)/.test(path) || path.startsWith("../market/")), name);
      assert.doesNotMatch(content, /\b(?:fetch|XMLHttpRequest|WebSocket|setInterval|setTimeout)\s*\(|https?:\/\/|\bimport\s*\(/, name);
      assert.doesNotMatch(content, /\bany\b|@ts-ignore|@ts-nocheck/, name);
    }
  }
});
test("full multi-month market coverage preserves every month/band without aggregation", () => {
  const c = marketCatalog(); c.observations.push(...observations("version-a", "2026-03"));
  const r = marketRequest(c); r.coverage = { validFrom: "2026-02-14", validTo: "2026-03-02" };
  const snapshot = createMarketSnapshot(r, c, authorityFor(c));
  assert.equal(snapshot.observations.length, 6);
  assert.equal(snapshot.observations.filter(o => o.referenceMonth === "2026-03").length, 3);
});
test("correction without a predecessor fails; original and correction replay embed complete lineage", () => {
  const c = marketCatalog([version("version-b", at, "absent")]);
  assert.throws(() => createMarketSnapshot(marketRequest(c), c, authorityFor(c)), { code: "VERSION_NOT_FOUND" });
  const catalog = marketCatalog([version(), version("version-b", at, "version-a")]), r = marketRequest(catalog);
  r.selectionPolicy.versionIds = ["version-b"]; r.observationIds = observations("version-b").map(o => o.observationId);
  const s = createMarketSnapshot(r, catalog, authorityFor(catalog));
  assert.equal(s.versionHistory[0].versionId, "version-a");
  assert.deepEqual(replayMarket(s, authorityFor(catalog), snapshotEvidence(s)), s);
});
test("unrelated version is not a recalculation of the original", () => {
  const catalog = marketCatalog([version(), version("unrelated", at)]), authority = authorityFor(catalog);
  const old = createMarketSnapshot(marketRequest(catalog), catalog, authority), r = marketRequest(catalog);
  r.snapshotId = "new-id"; r.selectionPolicy = { mode: "RECALCULATION", previousSnapshotId: old.snapshotId, versionIds: ["unrelated"] };
  r.observationIds = observations("unrelated").map(o => o.observationId);
  assert.throws(() => createMarketSnapshot(r, catalog, authority, old, snapshotEvidence(old)), { code: "INCOMPATIBLE_VERSION" });
});
test("regulatory correction preserves identities and old snapshot, then replays independently", () => {
  const oldCatalog = regulatoryCatalog(), old = createRegulatorySnapshot(regulatoryRequest(oldCatalog), oldCatalog, authorityFor(oldCatalog));
  const c = regulatoryCatalog([component(), component({ componentId: "component-b", sourceVersionId: "version-b", value: "2" })]);
  c.versions.push(version("version-b", at, "version-a"));
  const r = regulatoryRequest(c); r.snapshotId = "regulatory-b"; r.componentIds = ["component-b"];
  r.selectionPolicy = { mode: "RECALCULATION", previousSnapshotId: old.snapshotId, versionIds: ["version-b"] };
  const next = createRegulatorySnapshot(r, c, authorityFor(c), old, snapshotEvidence(old));
  assert.equal(old.components[0].value, "0"); assert.equal(next.components[0].value, "2");
  assert.deepEqual(replayRegulatory(next, authorityFor(c), snapshotEvidence(old, next)), next);
});
test("lifecycle event ledger requires explicit human approval before atomic publication", async () => {
  const c = marketCatalog(), authority = authorityFor(c), repo = new MemoryRepository("market", authority);
  const acquired = { ...version(), validationStatus: "PENDING", reviews: version().reviews.slice(0, 1) };
  await repo.commit({ ...emptyBatch(), sources: [source], versions: [acquired], records: c.observations }, { expectedRevision: 0, idempotencyKey: "acquired" });
  await assert.rejects(repo.selectAsOf(["version-a"], at), { code: "VERSION_UNAPPROVED" });
  const reviews = version().reviews.slice(1).map(review => ({ versionId: "version-a", review }));
  const snapshot = createMarketSnapshot(marketRequest(c), c, authority);
  await repo.commit({ ...emptyBatch(), reviews, snapshots: [snapshot] }, { expectedRevision: 1, idempotencyKey: "reviewed" });
  assert.equal((await repo.selectAsOf(["version-a"], at))[0].reviews.length, 4);
  assert.equal(acquired.reviews.length, 1); assert.deepEqual(await repo.getSnapshot(snapshot.snapshotId), snapshot);
});
test("malformed lifecycle, timestamp, acquisition result and applicability never normalize to usable values", () => {
  const v = version(); v.reviews[3].at = "2026-02-01T00:00:00.000Z";
  assert.throws(() => parseVersion(v), { code: "INVALID_TRANSITION" });
  assert.throws(() => parseAcquisitionAttempt({ ...attempt(), finishedAt: "2026-02-01T00:00:00.000Z" }), { code: "INVALID_INPUT" });
  assert.throws(() => parseAcquisitionAttempt({ ...attempt(), outcome: "ERROR" }), { code: "INVALID_INPUT" });
  const c = regulatoryCatalog([component({ applicability: { status: "DOES_NOT_APPLY", evidence: "test" } })]);
  assert.throws(() => createRegulatorySnapshot(regulatoryRequest(c), c, authorityFor(c)), { code: "INVALID_INPUT" });
});
test("rehashing malformed selection does not bypass schema or provenance validation", () => {
  const c = marketCatalog(), s = createMarketSnapshot(marketRequest(c), c, authorityFor(c));
  const payload = structuredClone(s); delete payload.hash; payload.selectionPolicy.mode = "LATEST";
  assert.throws(() => replayMarket({ ...payload, hash: digest(payload) }, authorityFor(c), snapshotEvidence(s)), { code: "SNAPSHOT_UNVERIFIED" });
});

for (const kind of ["market", "regulatory"]) {
  const create = kind === "market" ? createMarketSnapshot : createRegulatorySnapshot;
  const replay = kind === "market" ? replayMarket : replayRegulatory;
  const catalog = kind === "market" ? marketCatalog : regulatoryCatalog;
  const request = kind === "market" ? marketRequest : regulatoryRequest;
  test(`H2 ${kind}: ordinary replay requires independently pinned publication evidence`, () => {
    const c = catalog(), authority = authorityFor(c), s = create(request(c), c, authority), evidence = snapshotEvidence(s);
    assert.deepEqual(replay(s, authority, evidence), s);
    assert.throws(() => replay(s, authority), { code: "SNAPSHOT_UNVERIFIED" });
    const changed = structuredClone(s); delete changed.hash; changed.createdAt = "2026-03-03T12:00:00.000Z";
    assert.throws(() => replay({ ...changed, hash: digest(changed) }, authority, evidence), { code: "SNAPSHOT_UNVERIFIED" });
  });
  test(`H2 ${kind}: original self-referencing recalculation exploit is rejected`, () => {
    const c = catalog(), authority = authorityFor(c), s = create(request(c), c, authority), evidence = snapshotEvidence(s);
    const changed = structuredClone(s); delete changed.hash;
    changed.selectionPolicy = { ...changed.selectionPolicy, mode: "RECALCULATION", previousSnapshotId: s.snapshotId };
    assert.throws(() => replay({ ...changed, hash: digest(changed) }, authority, evidence), { code: "SNAPSHOT_UNVERIFIED" });
    assert.throws(() => create({ ...request(c), selectionPolicy: changed.selectionPolicy }, c, authority, s, evidence), { code: "INCOMPATIBLE_VERSION" });
  });
  test(`H2 ${kind}: valid recalculation verifies predecessor and rejects missing/incoherent chains`, () => {
    const c = catalog();
    c.versions.push(version("version-b", at, "version-a"));
    if (kind === "market") c.observations.push(...observations("version-b"));
    else c.components.push(component({ componentId: "component-b", sourceVersionId: "version-b" }));
    const authority = authorityFor(c), first = request(c); first.selectionPolicy.versionIds = ["version-a"];
    if (kind === "regulatory") first.componentIds = ["component-a"];
    const old = create(first, c, authority), evidence = snapshotEvidence(old), r = { ...first, snapshotId: `${kind}-new`,
      selectionPolicy: { mode: "RECALCULATION", previousSnapshotId: old.snapshotId, versionIds: ["version-b"] } };
    if (kind === "market") r.observationIds = observations("version-b").map(o => o.observationId);
    else r.componentIds = ["component-b"];
    assert.throws(() => create(r, c, authority, old), { code: "SNAPSHOT_UNVERIFIED" });
    assert.throws(() => create({ ...r, selectionPolicy: { ...r.selectionPolicy, previousSnapshotId: "absent" } }, c, authority, old, evidence), { code: "INCOMPATIBLE_VERSION" });
    const next = create(r, c, authority, old, evidence);
    assert.deepEqual(replay(next, authority, snapshotEvidence(old, next)), next);
    assert.throws(() => replay(next, authority, snapshotEvidence(next)), { code: "SNAPSHOT_UNVERIFIED" });
  });
}
for (const eventAt of ["2026-03-01T12:00:00.000Z", at]) {
  test(`M1 ancestor event ${eventAt === at ? "at" : "before"} as-of is retained without backdating`, () => {
    const old = version(); old.reviews = old.reviews.map(r => ({ ...r, at: eventAt }));
    const c = marketCatalog([old, version("version-b", at, "version-a")]), r = marketRequest(c);
    r.selectionPolicy.versionIds = ["version-b"]; r.observationIds = observations("version-b").map(o => o.observationId);
    const s = createMarketSnapshot(r, c, authorityFor(c));
    assert.equal(s.versionHistory[0].reviews.at(-1).at, eventAt);
  });
}
test("M1 future ancestor event blocks without truncating or rewriting the catalog", () => {
  const c = marketCatalog([version(), version("version-b", at, "version-a")]), authority = authorityFor(c), r = marketRequest(c);
  r.selectionPolicy.versionIds = ["version-b"]; r.observationIds = observations("version-b").map(o => o.observationId);
  c.versions[0].reviews[3].at = "2026-03-10T12:00:00.000Z";
  assert.throws(() => createMarketSnapshot(r, c, authority), { code: "AS_OF_UNPROVEN" });
  assert.equal(c.versions[0].reviews[3].at, "2026-03-10T12:00:00.000Z");
});
test("M1 incoherent historical acquisition ordering blocks", () => {
  const c = marketCatalog([version(), version("version-b", at, "version-a")]), r = marketRequest(c);
  c.versions[0] = version("version-a", at);
  r.selectionPolicy.versionIds = ["version-b"]; r.observationIds = observations("version-b").map(o => o.observationId);
  assert.throws(() => createMarketSnapshot(r, c, authorityFor(c)), { code: "INCOMPATIBLE_VERSION" });
});
for (const [index, stage] of ["ACQUIRED", "VALIDATED", "APPROVED", "PUBLISHED"].entries()) {
  test(`M2 ${stage} validation status matches actual lifecycle`, () => {
    const v = version(); v.reviews = v.reviews.slice(0, index + 1); v.validationStatus = index ? "VALID" : "PENDING";
    assert.equal(parseVersion(v).reviews.at(-1).stage, stage);
    assert.throws(() => parseVersion({ ...v, validationStatus: index ? "PENDING" : "VALID" }), { code: "INVALID_INPUT" });
  });
}
test("M2 explicit attested sequence advances one event at a time, never automatically", () => {
  const authority = authorityFor(marketCatalog()), full = version();
  let current = parseVersion({ ...full, reviews: full.reviews.slice(0, 1), validationStatus: "PENDING" });
  assert.throws(() => transition(current, full.reviews[2], authority), { code: "INVALID_TRANSITION" });
  for (const event of full.reviews.slice(1)) {
    const previous = current; current = transition(current, event, authority);
    assert.equal(current.reviews.length, previous.reviews.length + 1); assert.equal(current.reviews.at(-1).stage, event.stage);
  }
  const tampered = { ...full.reviews[2], actorId: "unattested-human" };
  assert.throws(() => transition({ ...full, reviews: full.reviews.slice(0, 2) }, tampered, authority), { code: "DOCUMENT_UNVERIFIED" });
});
test("L1 ordinary arrays accepted and required empty arrays rejected", () => {
  assert.deepEqual(list(["a", "b"], text), ["a", "b"]);
  const r = marketRequest(); r.selectionPolicy.versionIds = [];
  assert.throws(() => parseMarketRequest(r), { code: "INVALID_INPUT" });
  assert.throws(() => parseVersion({ ...version(), reviews: [] }), { code: "INVALID_TRANSITION" });
});
for (const kind of ["null", "undefined", "hole"]) {
  test(`L1 ${kind} array element produces a typed error`, () => {
    const values = ["a", "b"];
    if (kind === "hole") delete values[1]; else values[1] = kind === "null" ? null : undefined;
    assert.throws(() => list(values, text), { name: "FoundationError", code: "INVALID_INPUT" });
    const v = version();
    if (kind === "hole") delete v.reviews[1]; else v.reviews[1] = kind === "null" ? null : undefined;
    assert.throws(() => parseVersion(v), { name: "FoundationError", code: "INVALID_INPUT" });
  });
}
test("L1 sparse source/version/observation catalogs are rejected before dereferencing", () => {
  for (const key of ["sources", "versions", "observations"]) {
    const c = marketCatalog(), authority = authorityFor(c), r = marketRequest(c); delete c[key][0];
    assert.throws(() => createMarketSnapshot(r, c, authority), { name: "FoundationError", code: "INVALID_INPUT" });
  }
});
test("L1 sparse regulatory component catalogs and repository batches are rejected", async () => {
  const c = regulatoryCatalog(), authority = authorityFor(c), r = regulatoryRequest(c); delete c.components[0];
  assert.throws(() => createRegulatorySnapshot(r, c, authority), { name: "FoundationError", code: "INVALID_INPUT" });
  const repo = new MemoryRepository("market", authorityFor(marketCatalog())), batch = emptyBatch(); batch.snapshots = new Array(1);
  await assert.rejects(repo.commit(batch, { expectedRevision: 0, idempotencyKey: "sparse-batch" }), { name: "FoundationError", code: "INVALID_INPUT" });
  assert.equal(repo.revision, 0);
});
