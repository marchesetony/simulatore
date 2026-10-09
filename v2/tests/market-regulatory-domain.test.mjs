import assert from "node:assert/strict";
import { test } from "node:test";
import { economicState, parseFreshness } from "../modules/market/economic-state.ts";
import { parseSource, parseVersion, transition, unavailableAuthority } from "../modules/market/governance.ts";
import { digest } from "../modules/market/integrity.ts";
import { parseMarketObservation, parseMarketRequest } from "../modules/market/schema.ts";
import { createMarketSnapshot, replayMarket } from "../modules/market/service.ts";
import { completeCoverage, date, period } from "../modules/market/temporal.ts";
import { parseAcquisitionAttempt, acquisitionPolicy } from "../modules/market/acquisition.ts";
import { parseRegulatoryComponent, componentIdentity } from "../modules/regulatory/schema.ts";
import { createRegulatorySnapshot, replayRegulatory } from "../modules/regulatory/service.ts";
import { marketRepository } from "../modules/market/repository.ts";
import { regulatoryRepository } from "../modules/regulatory/repository.ts";
import { at, coverage, source, version, observations, marketCatalog, marketRequest, component,
  regulatoryCatalog, regulatoryRequest, authorityFor, attempt, snapshotEvidence } from "./market-regulatory-fixtures.mjs";

const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);
const market = (c = marketCatalog(), r = marketRequest(c), authority = authorityFor(c)) => createMarketSnapshot(r, c, authority);
const regulatory = (c = regulatoryCatalog(), r = regulatoryRequest(c)) => createRegulatorySnapshot(r, c, authorityFor(c));

test("01 KNOWN zero survives validation and snapshot without missing coercion", () => {
  assert.deepEqual(economicState({ valueState: "KNOWN", value: "0.000", evidence: null }), { valueState: "KNOWN", value: "0", evidence: null });
  assert.equal(market().observations[0].value, "0");
});
test("02 MISSING differs from zero and blocks required market value", () => {
  const c = marketCatalog(); c.observations[0] = { ...c.observations[0], valueState: "MISSING", value: null };
  assert.equal(economicState({ valueState: "MISSING", value: null, evidence: null }).value, null);
  throwsCode(() => market(c), "MISSING_VALUE");
});
test("03 NOT_APPLICABLE requires evidence and differs from MISSING", () => {
  throwsCode(() => economicState({ valueState: "NOT_APPLICABLE", value: null, evidence: null }), "INVALID_INPUT");
  const c = regulatoryCatalog([component({ valueState: "NOT_APPLICABLE", value: null, evidence: "SYNTHETIC exclusion",
    applicability: { status: "DOES_NOT_APPLY", evidence: "SYNTHETIC exclusion" } })]);
  assert.equal(regulatory(c).components[0].valueState, "NOT_APPLICABLE");
  throwsCode(() => createRegulatorySnapshot(regulatoryRequest(c), c, { ...authorityFor(c), verifyApplicability: () => false }), "DOCUMENT_UNVERIFIED");
});
test("04 NOT_PROVIDED and INVALID remain distinct; neither becomes zero", () => {
  throwsCode(() => economicState({ valueState: { toString: () => "MISSING" }, value: null, evidence: null }), "INVALID_INPUT");
  for (const valueState of ["NOT_PROVIDED", "INVALID"]) {
    assert.equal(economicState({ valueState, value: null, evidence: null }).valueState, valueState);
    throwsCode(() => economicState({ valueState, value: "0", evidence: null }), "INVALID_INPUT");
  }
});
test("05 unknown source blocks", () => { const c = marketCatalog(); c.sources = []; throwsCode(() => market(c), "UNKNOWN_SOURCE"); });
test("06 nonexistent version blocks", () => {
  const c = marketCatalog(), r = marketRequest(c); r.selectionPolicy.versionIds = ["absent"];
  throwsCode(() => market(c, r), "VERSION_NOT_FOUND");
});
test("07 technically validated but unapproved version blocks", () => {
  const c = marketCatalog(); c.versions[0].reviews = c.versions[0].reviews.slice(0, 2);
  throwsCode(() => market(c), "VERSION_UNAPPROVED");
});
test("08 immutable snapshot is detached, nested frozen and hash verified", () => {
  const c = marketCatalog(), s = market(c); c.observations[0].value = "99";
  assert.equal(s.observations[0].value, "0");
  assert.throws(() => { s.observations[0].value = "99"; }, TypeError);
  assert.ok(Object.isFrozen(s.versions[0].reviews));
  throwsCode(() => replayMarket({ ...s, snapshotId: "tampered" }, authorityFor(marketCatalog())), "HASH_MISMATCH");
});
test("10 replay pins original version even when later correction exists", () => {
  const c = marketCatalog(), original = market(c);
  const revised = marketCatalog([version(), version("version-b", at, "version-a")]);
  assert.deepEqual(replayMarket(original, authorityFor(revised), snapshotEvidence(original)), original);
});
test("11 recalculation needs new identity, explicit revision and previous snapshot", () => {
  const original = market(), c = marketCatalog([version(), version("version-b", at, "version-a")]);
  const r = marketRequest(c); r.snapshotId = "market-snapshot-b"; r.selectionPolicy = { mode: "RECALCULATION", previousSnapshotId: original.snapshotId, versionIds: ["version-b"] };
  r.observationIds = observations("version-b").map(o => o.observationId);
  throwsCode(() => createMarketSnapshot(r, c, authorityFor(c)), "SNAPSHOT_UNVERIFIED");
  const next = createMarketSnapshot(r, c, authorityFor(c), original, snapshotEvidence(original));
  assert.equal(next.versions[0].versionId, "version-b"); assert.notEqual(next.hash, original.hash);
  assert.deepEqual(replayMarket(next, authorityFor(c), snapshotEvidence(original, next)), next);
  throwsCode(() => createMarketSnapshot({ ...r, snapshotId: original.snapshotId }, c, authorityFor(c), original, snapshotEvidence(original)), "INCOMPATIBLE_VERSION");
});
test("12 no implicit latest and revision labels never determine selection", () => {
  const c = marketCatalog([version("revision-z"), version("revision-a", at, "revision-z")]);
  assert.equal(market(c).versions[0].versionId, "revision-z");
  const r = marketRequest(c); r.selectionPolicy.versionIds = [];
  throwsCode(() => market(c, r), "INVALID_INPUT");
  const missingPolicy = { ...marketRequest(c) }; delete missingPolicy.selectionPolicy;
  throwsCode(() => parseMarketRequest(missingPolicy), "INVALID_INPUT");
});
test("13 complete inclusive regulatory temporal coverage", () => {
  const c = regulatoryCatalog([component({ validTo: "2026-02-14" }), component({ componentId: "component-b", validFrom: "2026-02-15" })]);
  assert.equal(regulatory(c).components.length, 2);
});
test("14 temporal gap blocks", () => {
  const c = regulatoryCatalog([component({ validTo: "2026-02-14" }), component({ componentId: "component-b", validFrom: "2026-02-16" })]);
  throwsCode(() => regulatory(c), "GAP");
});
test("15 overlapping inclusive dates block", () => {
  const c = regulatoryCatalog([component({ validTo: "2026-02-15" }), component({ componentId: "component-b", validFrom: "2026-02-15" })]);
  throwsCode(() => regulatory(c), "OVERLAP");
});
test("16 inclusive single day accepted, invalid/reversed dates rejected", () => {
  const day = { validFrom: "2026-02-28", validTo: "2026-02-28" };
  assert.doesNotThrow(() => completeCoverage(day, [day]));
  throwsCode(() => period({ validFrom: "2026-03-01", validTo: "2026-02-28" }), "INVALID_INPUT");
  throwsCode(() => date("2026-02-29"), "INVALID_INPUT");
});
test("17 F1/F2/F3 only and missing band blocks", () => {
  assert.deepEqual(market().observations.map(o => o.band), ["F1", "F2", "F3"]);
  for (const band of ["F0", "MONO", "F23"]) throwsCode(() => parseMarketObservation({ ...observations()[0], band }), "INVALID_INPUT");
  const c = marketCatalog(); c.observations.pop(); throwsCode(() => market(c), "GAP");
});
test("18 missing month blocks a multi-month request", () => {
  const c = marketCatalog(), r = marketRequest(c); r.coverage = { ...coverage, validTo: "2026-03-31" };
  throwsCode(() => market(c, r), "GAP");
});
test("19 wrong unit and implicit conversions rejected", () => {
  throwsCode(() => parseMarketObservation({ ...observations()[0], unit: "EUR_PER_KWH" }), "INVALID_INPUT");
  throwsCode(() => parseRegulatoryComponent(component({ unit: "EUR_PER_MWH" })), "INVALID_INPUT");
});
test("20 invalid economic numbers and contradictory states rejected", () => {
  for (const value of [NaN, Infinity, 0, "NaN", "1e3", "0.1234567", "", null])
    throwsCode(() => economicState({ valueState: "KNOWN", value, evidence: null }), "INVALID_INPUT");
  throwsCode(() => economicState({ valueState: "KNOWN", value: "0", evidence: "contradiction" }), "INVALID_INPUT");
});
test("21 duplicate component identity rejected despite different component IDs", () => {
  throwsCode(() => regulatory(regulatoryCatalog([component(), component({ componentId: "another-id" })])), "DUPLICATE_IDENTITY");
});
test("22 same abbreviation with distinct bases remains distinct", () => {
  const fixed = component({ componentId: "fixed", applicationBasis: "MONTH", unit: "EUR_PER_MONTH" });
  assert.notEqual(componentIdentity(fixed), componentIdentity(component()));
  assert.equal(regulatory(regulatoryCatalog([component(), fixed])).components.length, 2);
});
test("27 STALE is separate from economic value and does not invalidate historical replay", () => {
  const c = marketCatalog(), historical = market(c), freshness = parseFreshness({ status: "STALE", checkedAt: at, reason: "SYNTHETIC refresh failure" });
  assert.equal(freshness.status, "STALE"); assert.deepEqual(replayMarket(historical, authorityFor(c), snapshotEvidence(historical)), historical);
  throwsCode(() => economicState({ valueState: "STALE", value: null, evidence: null }), "INVALID_INPUT");
});
test("28 acquisition no-new-data is a distinct successful operational result", () => {
  assert.equal(parseAcquisitionAttempt(attempt()).outcome, "NO_NEW_DATA");
  assert.deepEqual(acquisitionPolicy.daysOfMonth, [1, 16]); assert.equal(acquisitionPolicy.timezone, "Europe/Rome");
});
test("29 acquisition error preserves explicit code and cannot claim publication", () => {
  assert.equal(parseAcquisitionAttempt(attempt("ERROR")).errorCode, "SYNTHETIC_FAILURE");
  throwsCode(() => parseAcquisitionAttempt({ ...attempt("ERROR"), publishedVersionId: "version-a" }), "INVALID_INPUT");
  throwsCode(() => parseAcquisitionAttempt({ ...attempt(), scheduledFor: "2026-03-02" }), "INVALID_INPUT");
});
test("30 no automatic economic approval and no lifecycle skipping", () => {
  const v = version(); v.reviews[2].human = false;
  throwsCode(() => parseVersion(v), "APPROVAL_REQUIRED");
  const acquired = version(); acquired.reviews = acquired.reviews.slice(0, 1); acquired.validationStatus = "PENDING";
  throwsCode(() => transition(acquired, version().reviews[2], authorityFor(marketCatalog())), "INVALID_TRANSITION");
  assert.equal(parseVersion(acquired).reviews.length, 1);
});
test("31 no client declaration confers official trust and normalized values need attestation", () => {
  const c = marketCatalog(); throwsCode(() => market(c, marketRequest(c), unavailableAuthority), "SOURCE_UNAPPROVED");
  throwsCode(() => parseSource({ ...source, official: true }), "INVALID_INPUT");
  throwsCode(() => market(c, marketRequest(c), { ...authorityFor(c), verifyNormalizedRecord: () => false }), "DOCUMENT_UNVERIFIED");
});
test("32 runtime repositories fail closed without any live provider dependency", async () => {
  for (const repo of [marketRepository, regulatoryRepository]) {
    await assert.rejects(repo.getSnapshot("id"), { code: "UNAVAILABLE" });
    await assert.rejects(repo.selectAsOf(["id"], at), { code: "UNAVAILABLE" });
  }
});
test("publication and acquisition are distinct cutoffs; unknown publication blocks", () => {
  const c = marketCatalog(), r = marketRequest(c); r.asOf = "2026-02-28T00:00:00.000Z";
  throwsCode(() => market(c, r), "AS_OF_UNPROVEN");
  c.versions[0].publicationEvidence = null; throwsCode(() => market(c), "AS_OF_UNPROVEN");
});
test("regulatory replay verifies provenance and inclusion/exclusion double-counting", () => {
  const c = regulatoryCatalog(), s = regulatory(c); assert.deepEqual(replayRegulatory(s, authorityFor(c), snapshotEvidence(s)), s);
  const fixed = component({ componentId: "fixed", applicationBasis: "MONTH", unit: "EUR_PER_MONTH" });
  throwsCode(() => regulatory(regulatoryCatalog([component({ includes: ["fixed"] }), fixed])), "DUPLICATE_IDENTITY");
});
test("snapshot content hash is deterministic and changes with economic content", () => {
  assert.equal(market().hash, market().hash);
  const c = marketCatalog(); c.observations[0].value = "7";
  assert.notEqual(market(c).hash, market().hash);
  assert.equal(digest({ a: "0", b: "1" }), digest({ b: "1", a: "0" }));
});

function relationCase(parent, targets) {
  const c = regulatoryCatalog([parent, ...targets]), r = regulatoryRequest(c);
  r.componentIds = [parent.componentId]; r.requiredIdentities = [componentIdentity(parent)];
  r.selectionPolicy.versionIds = [parent.sourceVersionId];
  return { c, r, authority: authorityFor(c) };
}
for (const relation of ["includes", "excludes"]) {
  test(`H1 nonexistent ${relation} target blocks`, () => {
    const { c, r, authority } = relationCase(component({ [relation]: ["absent"] }), []);
    throwsCode(() => createRegulatorySnapshot(r, c, authority), "UNRESOLVED_RELATION");
  });
}
test("H1 physical and economic self-relations block", () => {
  throwsCode(() => parseRegulatoryComponent(component({ includes: ["component-a"] })), "INVALID_INPUT");
  const { c, r, authority } = relationCase(component({ includes: ["same-identity"] }), [component({ componentId: "same-identity" })]);
  throwsCode(() => createRegulatorySnapshot(r, c, authority), "UNRESOLVED_RELATION");
});
test("H1 relation to an old component also conflicts with its selected revision", () => {
  const parent = component({ componentId: "parent", code: "PARENT", includes: ["child-old"] });
  const child = component({ componentId: "child-old", code: "CHILD" });
  const c = regulatoryCatalog([parent, child, { ...child, componentId: "child-new", sourceVersionId: "version-b" }]);
  c.versions.push(version("version-b", at, "version-a"));
  const r = regulatoryRequest(c); r.componentIds = ["parent", "child-new"];
  throwsCode(() => createRegulatorySnapshot(r, c, authorityFor(c)), "DUPLICATE_IDENTITY");
});
test("H1 ambiguous target identities and duplicate references block", () => {
  const { c, r, authority } = relationCase(component({ code: "PARENT", includes: ["b1", "b2"] }),
    [component({ componentId: "b1", code: "CHILD" }), component({ componentId: "b2", code: "CHILD" })]);
  throwsCode(() => createRegulatorySnapshot(r, c, authority), "DUPLICATE_IDENTITY");
  throwsCode(() => parseRegulatoryComponent(component({ includes: ["b1", "b1"] })), "DUPLICATE_IDENTITY");
});
test("H1 cycles between shared relation targets block", () => {
  const { c, r, authority } = relationCase(component({ code: "PARENT", includes: ["b", "c"] }), [
    component({ componentId: "b", code: "B", includes: ["c"] }), component({ componentId: "c", code: "C", excludes: ["b"] }),
  ]);
  throwsCode(() => createRegulatorySnapshot(r, c, authority), "UNRESOLVED_RELATION");
});
test("H1 resolved relations are attested, embedded and replayable without a mutable catalog", () => {
  const { c, r, authority } = relationCase(component({ code: "PARENT", includes: ["child"] }), [component({ componentId: "child", code: "CHILD" })]);
  const s = createRegulatorySnapshot(r, c, authority), evidence = snapshotEvidence(s);
  assert.equal(s.relationComponents[0].componentId, "child"); assert.equal(s.components.length, 1);
  c.components[1].value = "99";
  assert.deepEqual(replayRegulatory(s, authority, evidence), s);
  throwsCode(() => createRegulatorySnapshot(r, c, authority), "DOCUMENT_UNVERIFIED");
});
test("H1 target with unproven period blocks", () => {
  const { c, r, authority } = relationCase(component({ code: "PARENT", includes: ["child"] }),
    [component({ componentId: "child", code: "CHILD", validFrom: "2026-02-15" })]);
  throwsCode(() => createRegulatorySnapshot(r, c, authority), "UNRESOLVED_RELATION");
});
for (const newDocument of [false, true]) {
  test(`M3 correction with ${newDocument ? "new" : "same"} document retains stable source and approved chain`, () => {
    const c = regulatoryCatalog([component({ sourceVersionId: "version-b" })]);
    const revised = version("version-b", at, "version-a");
    if (newDocument) { revised.documentReference = "SYNTHETIC corrected document"; revised.contentHash = digest("SYNTHETIC corrected bytes"); }
    c.versions.push(revised);
    const authority = authorityFor(c), r = regulatoryRequest(c); r.selectionPolicy.versionIds = ["version-b"];
    const s = createRegulatorySnapshot(r, c, authority);
    assert.equal(s.sources.length, 1); assert.equal(s.versions[0].sourceId, source.sourceId);
    assert.equal(s.versions[0].documentReference, revised.documentReference);
    assert.equal(s.versionHistory[0].versionId, "version-a");
    assert.deepEqual(replayRegulatory(s, authority, snapshotEvidence(s)), s);
  });
}
test("M3 unattested document cannot inherit approval from the original fixture", () => {
  const c = regulatoryCatalog(), authority = authorityFor(c);
  c.versions[0].documentReference = "UNATTESTED replacement";
  throwsCode(() => createRegulatorySnapshot(regulatoryRequest(c), c, authority), "DOCUMENT_UNVERIFIED");
});
test("M3 unauthorized source replacement and cross-source correction block", () => {
  const c = regulatoryCatalog([component({ sourceVersionId: "version-b" })]);
  c.versions.push(version("version-b", at, "version-a"));
  const authority = authorityFor(c), r = regulatoryRequest(c); r.selectionPolicy.versionIds = ["version-b"];
  c.sources.push({ ...c.sources[0], sourceId: "other-source" }); c.versions[1].sourceId = "other-source";
  throwsCode(() => createRegulatorySnapshot(r, c, authority), "SOURCE_UNAPPROVED");
  // Even independently attesting both sources must not authorize a cross-source supersedes link.
  throwsCode(() => createRegulatorySnapshot(r, c, authorityFor(c)), "INCOMPATIBLE_VERSION");
});
