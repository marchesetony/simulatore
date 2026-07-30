import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checksumFor,
  deterministicId,
  nextVersion,
  overlaps,
  requiredBands,
  validateInterval,
  validateSource,
} from "../app/lib/foundation/regulatory-validation.ts";
import { HistoricalEffectiveDateResolver, UsableDataResolver, unsupportedMarketRequest } from "../app/lib/foundation/regulatory-service.ts";
import { AppendOnlyVersionStore } from "../app/lib/foundation/regulatory-version-store.ts";
import { ImmutableApprovalEngine } from "../app/lib/foundation/regulatory-approval.ts";
import { LocalRegulatoryRepository } from "../app/lib/foundation/regulatory-repository.ts";

assert.equal(deterministicId("series", "pun", "2027"), deterministicId("series", "pun", "2027"));
assert.equal(nextVersion("1"), "2");
assert.equal(nextVersion("1.4"), "1.5");
assert.throws(() => validateInterval({ tenantId: "tenant_alpha", id: "v", version: "1", parentVersionId: null, effectiveFrom: "2027-02-01", effectiveTo: "2027-01-01" }), /EFFECTIVE_INTERVAL_INVALID/);
const versions = [{ effectiveFrom: "2027-01-01", effectiveTo: "2027-07-01", approvalStatus: "APPROVED" }, { effectiveFrom: "2027-07-01", effectiveTo: null, approvalStatus: "APPROVED" }];
assert.equal(new HistoricalEffectiveDateResolver().resolve(versions, "2027-08-01")?.effectiveFrom, "2027-07-01");
assert.deepEqual(unsupportedMarketRequest("GAS", "MONTHLY"), { unsupported: "GAS_UNSUPPORTED" });
assert.deepEqual(unsupportedMarketRequest("ELECTRICITY", "HOURLY"), { unsupported: "HOURLY_UNSUPPORTED" });
assert.equal(overlaps([{ tenantId: "tenant_alpha", id: "a", version: "1", parentVersionId: null, effectiveFrom: "2027-01-01", effectiveTo: "2027-02-01" }, { tenantId: "tenant_alpha", id: "b", version: "2", parentVersionId: "a", effectiveFrom: "2027-02-01", effectiveTo: null }]), false);
assert.deepEqual(requiredBands("F1_F2_F3"), ["F1", "F2", "F3"]);

const sourceBase = { tenantId: "tenant_alpha", id: "source-1", sourceInstitution: "GME", officialIdentifier: "DATA-2027", sourceUrl: "https://gme.it/data", publicationDate: "2027-01-01", retrievedAt: "2027-01-02T00:00:00Z", approvalStatus: "IMPORTED", reviewer: null, provenance: [], version: "1", parentVersionId: null };
const source = { ...sourceBase, checksum: checksumFor(sourceBase) };
validateSource(source);
assert.throws(() => validateSource({ ...source, checksum: "0".repeat(64) }), /CHECKSUM_MISMATCH/);

for (const family of ["OfficialSource", "RegulatoryDocument", "RegulatoryRuleVersion", "MarketDataSeries", "MarketDataPoint", "TariffBandCalendar", "ContractFormula", "PassThroughComponentVersion", "EvidenceReference"]) {
  const store = new AppendOnlyVersionStore();
  assert.throws(() => store.put(`${family}-direct`, { family }, "APPROVED"), /INVALID_LIFECYCLE_TRANSITION/);
  const first = store.put(family, { family, value: "unchanged" }, "IMPORTED", null, "2027-01-01T00:00:00.000Z");
  const validated = store.transition(family, "VALIDATED", "review-validated", "2027-01-01T12:00:00.000Z");
  const approved = store.transition(family, "APPROVED", "review-1", "2027-01-02T00:00:00.000Z");
  assert.equal(first.version, 1);
  assert.equal(validated.version, 2);
  assert.equal(approved.version, 3);
  assert.equal(store.historyFor(family).length, 3);
}

const approval = new ImmutableApprovalEngine();
const payload = (tenantId, entityType, dependencies = []) => ({ tenantId, entityType, dependencies, business: { label: entityType } });
approval.import("OfficialSource", "source", payload("tenant_alpha", "OfficialSource"), "2027-01-01T00:00:00.000Z");
approval.import("OfficialSource", "source", payload("tenant_beta", "OfficialSource"), "2027-01-01T00:00:00.000Z");
const approvalDecision = { id: "approval-source-alpha", tenantId: "tenant_alpha", subjectType: "OfficialSource", subjectId: "source", decision: "APPROVE", reviewer: "owner", reason: "verified", createdAt: "2027-01-02T00:00:00.000Z" };
assert.equal(approval.approve("tenant_alpha", "OfficialSource", "source", approvalDecision).lifecycle, "APPROVED");
assert.equal(approval.currentApproved("tenant_beta", "OfficialSource", "source"), null);
approval.import("RegulatoryDocument", "doc", payload("tenant_alpha", "RegulatoryDocument", [{ tenantId: "tenant_alpha", entityType: "OfficialSource", entityId: "missing" }]), "2027-01-01T00:00:00.000Z");
assert.throws(() => approval.approve("tenant_alpha", "RegulatoryDocument", "doc", { id: "approval-doc-alpha", tenantId: "tenant_alpha", subjectType: "RegulatoryDocument", subjectId: "doc", decision: "APPROVE", reviewer: "owner", reason: "verify", createdAt: "2027-01-02T00:00:00.000Z" }), /APPROVAL_DEPENDENCY_DENIED/);

const chainObject = (value) => ({ ...value, checksum: checksumFor(value) });
const evidenceFor = (tenantId, subjectType, subject, suffix) => chainObject({
  tenantId,
  id: `${suffix}-${subject.id}`,
  subjectType,
  subjectId: subject.officialIdentifier,
  subjectVersionId: subject.id,
  sourceInstitution: "GME",
  sourceDocumentOrDataset: "CHAIN",
  officialIdentifier: `${suffix}-${subject.officialIdentifier}`,
  sourceUrl: "https://gme.it/chain",
  publicationDate: "2027-01-01",
  effectiveFrom: "2027-01-01",
  effectiveTo: null,
  retrievedAt: "2027-01-02T00:00:00Z",
  immutableVersion: "1",
  ingestionStatus: "APPROVED",
  reviewerApprovalStatus: "APPROVED",
  provenance: [],
});
const reviewFor = (tenantId, subjectType, subject, evidence, id) => ({
  tenantId,
  id,
  subjectType,
  subjectId: subject.officialIdentifier,
  subjectVersionId: subject.id,
  decision: "APPROVED",
  reviewer: "reviewer",
  reviewedAt: "2027-01-03T00:00:00Z",
  reason: "verified",
  evidenceReferences: [evidence],
  supersedesDecisionId: null,
});
const draftSource = (tenantId, id, officialIdentifier) => {
  const base = { tenantId, id, sourceInstitution: "GME", officialIdentifier, sourceUrl: "https://gme.it/source", publicationDate: "2027-01-01", retrievedAt: "2027-01-02T00:00:00Z", approvalStatus: "IMPORTED", reviewer: null, provenance: [], version: "1", parentVersionId: null };
  return { ...base, checksum: checksumFor(base) };
};
const draftDocument = (tenantId, id, officialIdentifier, sourceId) => {
  const base = { tenantId, id, sourceId, documentType: "OFFICIAL_DATASET", contentReference: "dataset", ruleId: null, sourceInstitution: "GME", officialIdentifier, sourceUrl: "https://gme.it/document", publicationDate: "2027-01-01", retrievedAt: "2027-01-02T00:00:00Z", approvalStatus: "IMPORTED", reviewer: null, provenance: [], version: "1", parentVersionId: null, effectiveFrom: "2027-01-01", effectiveTo: null };
  return { ...base, checksum: checksumFor(base) };
};
const draftRule = (tenantId, id, officialIdentifier, documentId) => {
  const base = { tenantId, id, documentId, ruleCode: "RULE-1", subject: "price", customerCategory: "DOMESTIC", market: "ELECTRICITY", formulaReference: "official", confidence: 1, sourceInstitution: "GME", officialIdentifier, sourceUrl: "https://gme.it/rule", publicationDate: "2027-01-01", retrievedAt: "2027-01-02T00:00:00Z", approvalStatus: "IMPORTED", reviewer: null, provenance: [], version: "1", parentVersionId: null, effectiveFrom: "2027-01-01", effectiveTo: null };
  return { ...base, checksum: checksumFor(base) };
};
const draftSeries = (tenantId, id, officialIdentifier, sourceId, documentId, ruleId) => {
  const base = { tenantId, id, sourceId, documentId, ruleId, market: "ELECTRICITY", indexType: "PUN", granularity: "MONTHLY", structure: "MONO", currency: "EUR", unit: "EUR/MWh", sourceInstitution: "GME", officialIdentifier, sourceUrl: "https://gme.it/series", publicationDate: "2027-01-01", retrievedAt: "2027-01-02T00:00:00Z", approvalStatus: "IMPORTED", reviewer: null, provenance: [], version: "1", parentVersionId: null, effectiveFrom: "2027-01-01", effectiveTo: null };
  return { ...base, checksum: checksumFor(base) };
};
const draftPoint = (tenantId, id, officialIdentifier, sourceId, seriesId) => {
  const base = { tenantId, id, sourceId, seriesId, periodStart: "2027-01-01", periodEnd: "2027-02-01", band: "MONORARY", value: 100, unit: "EUR/MWh", confidence: 1, sourceInstitution: "GME", officialIdentifier, sourceUrl: "https://gme.it/point", publicationDate: "2027-01-01", retrievedAt: "2027-01-02T00:00:00Z", approvalStatus: "IMPORTED", reviewer: null, provenance: [], version: "1", parentVersionId: null, effectiveFrom: "2027-01-01", effectiveTo: null };
  return { ...base, checksum: checksumFor(base) };
};
const approvedWithoutProvenance = (entity, reviewDecisionId) => {
  const payload = { ...entity, approvalStatus: "APPROVED", reviewer: "reviewer", reviewDecisionId, provenance: [] };
  return withChecksum(payload);
};
const withChecksum = (entity) => {
  const payload = { ...entity };
  delete payload.checksum;
  return { ...payload, checksum: checksumFor(payload) };
};
const readStore = async (rootPath) => JSON.parse(await readFile(join(rootPath, "records.json"), "utf8"));
const writeStoreCopy = async (prefix, store) => {
  const copyRoot = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(copyRoot, "records.json"), JSON.stringify(store, null, 2), "utf8");
  return copyRoot;
};

const repositoryRoot = await mkdtemp(join(tmpdir(), "regulatory-repository-"));
const repository = new LocalRegulatoryRepository(repositoryRoot);
assert.equal(await repository.get("tenant_alpha", "missing"), null);
await writeFile(join(repositoryRoot, "records.json"), "{\"revision\":");
await assert.rejects(() => repository.get("tenant_alpha", "missing"), /REPOSITORY_CORRUPT/);
await writeFile(join(repositoryRoot, "records.json"), "{\"revision\":0,\"sources\":[]}");
await assert.rejects(() => repository.get("tenant_alpha", "missing"), /REPOSITORY_SCHEMA_INVALID/);
await rm(repositoryRoot, { recursive: true, force: true });

const lockRoot = await mkdtemp(join(tmpdir(), "regulatory-lock-"));
await writeFile(join(lockRoot, "records.json"), JSON.stringify({ revision: 0, sources: [], documents: [], rules: [], series: [], points: [], evidence: [], reviews: [], versionStates: [] }));
const lockPath = join(lockRoot, "records.json.lock");
await mkdir(lockPath);
const lockRepo = new LocalRegulatoryRepository(lockRoot);
await assert.rejects(() => lockRepo.save(draftSource("tenant_alpha", "lock-source", "LOCK-SOURCE")), /REPOSITORY_LOCK_TIMEOUT/);
await rm(lockRoot, { recursive: true, force: true });

const persistenceRoot = await mkdtemp(join(tmpdir(), "regulatory-persistence-"));
const persistenceRepo = new LocalRegulatoryRepository(persistenceRoot);

const invalidApprovedSource = approvedWithoutProvenance(draftSource("tenant_alpha", "direct-source-approved", "DIRECT-SOURCE"), "review-direct-source");
await assert.rejects(() => persistenceRepo.save(invalidApprovedSource), /APPROVAL_PROVENANCE_INVALID/);
assert.equal(await persistenceRepo.get("tenant_alpha", invalidApprovedSource.id), null);

const persistenceSourceDraft = draftSource("tenant_alpha", "persistence-source-v1", "PERSISTENCE-SOURCE");
await persistenceRepo.save(persistenceSourceDraft);
const persistenceSourceEvidence = evidenceFor("tenant_alpha", "OfficialSource", persistenceSourceDraft, "persistence-source-evidence");
await persistenceRepo.put(persistenceSourceEvidence);
await persistenceRepo.approve({ tenantId: "tenant_alpha", subjectType: "OfficialSource", subjectId: persistenceSourceDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "OfficialSource", persistenceSourceDraft, persistenceSourceEvidence, "review-persistence-source") });
const persistenceSourceApproved = await persistenceRepo.getCurrentSource("tenant_alpha", persistenceSourceDraft.id);
assert.ok(persistenceSourceApproved);

const invalidApprovedDocument = approvedWithoutProvenance(draftDocument("tenant_alpha", "direct-document-approved", "DIRECT-DOCUMENT", persistenceSourceApproved.id), "review-direct-document");
await assert.rejects(() => persistenceRepo.importDocument(invalidApprovedDocument), /APPROVAL_PROVENANCE_INVALID/);
assert.equal(await persistenceRepo.getDocumentVersion("tenant_alpha", invalidApprovedDocument.id), null);

const persistenceDocumentDraft = draftDocument("tenant_alpha", "persistence-document-v1", "PERSISTENCE-DOCUMENT", persistenceSourceApproved.id);
await persistenceRepo.importDocument(persistenceDocumentDraft);
const persistenceDocumentEvidence = evidenceFor("tenant_alpha", "RegulatoryDocument", persistenceDocumentDraft, "persistence-document-evidence");
await persistenceRepo.put(persistenceDocumentEvidence);
await persistenceRepo.approve({ tenantId: "tenant_alpha", subjectType: "RegulatoryDocument", subjectId: persistenceDocumentDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "RegulatoryDocument", persistenceDocumentDraft, persistenceDocumentEvidence, "review-persistence-document") });
const persistenceDocumentApproved = await persistenceRepo.getDocument("tenant_alpha", deterministicId("RegulatoryDocument", "tenant_alpha|PERSISTENCE-DOCUMENT", "2"));
assert.ok(persistenceDocumentApproved);

const invalidApprovedRule = approvedWithoutProvenance(draftRule("tenant_alpha", "direct-rule-approved", "DIRECT-RULE", persistenceDocumentApproved.id), "review-direct-rule");
await assert.rejects(() => persistenceRepo.importRule(invalidApprovedRule), /APPROVAL_PROVENANCE_INVALID/);
assert.equal(await persistenceRepo.getRule("tenant_alpha", invalidApprovedRule.id), null);

const persistenceRuleDraft = draftRule("tenant_alpha", "persistence-rule-v1", "PERSISTENCE-RULE", persistenceDocumentApproved.id);
await persistenceRepo.importRule(persistenceRuleDraft);
const persistenceRuleEvidence = evidenceFor("tenant_alpha", "RegulatoryRuleVersion", persistenceRuleDraft, "persistence-rule-evidence");
await persistenceRepo.put(persistenceRuleEvidence);
await persistenceRepo.approve({ tenantId: "tenant_alpha", subjectType: "RegulatoryRuleVersion", subjectId: persistenceRuleDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "RegulatoryRuleVersion", persistenceRuleDraft, persistenceRuleEvidence, "review-persistence-rule") });
const persistenceRuleApproved = await persistenceRepo.getRule("tenant_alpha", deterministicId("RegulatoryRuleVersion", "tenant_alpha|PERSISTENCE-RULE", "2"));
assert.ok(persistenceRuleApproved);

const invalidApprovedSeries = approvedWithoutProvenance(draftSeries("tenant_alpha", "direct-series-approved", "DIRECT-SERIES", persistenceSourceApproved.id, persistenceDocumentApproved.id, persistenceRuleApproved.id), "review-direct-series");
await assert.rejects(() => persistenceRepo.importSeries(invalidApprovedSeries, [draftPoint("tenant_alpha", "direct-series-point-imported", "DIRECT-SERIES-POINT", persistenceSourceApproved.id, invalidApprovedSeries.id)]), /APPROVAL_PROVENANCE_INVALID/);
assert.equal(await persistenceRepo.getSeriesVersion("tenant_alpha", invalidApprovedSeries.id), null);

const validImportedSeries = draftSeries("tenant_alpha", "direct-point-series-imported", "DIRECT-POINT-SERIES", persistenceSourceApproved.id, persistenceDocumentApproved.id, persistenceRuleApproved.id);
const invalidApprovedPoint = approvedWithoutProvenance(draftPoint("tenant_alpha", "direct-point-approved", "DIRECT-POINT", persistenceSourceApproved.id, validImportedSeries.id), "review-direct-point");
const beforePersistenceFailure = await readStore(persistenceRoot);
await assert.rejects(() => persistenceRepo.importSeries(validImportedSeries, [invalidApprovedPoint]), /APPROVAL_PROVENANCE_INVALID/);
const afterPersistenceFailure = await readStore(persistenceRoot);
assert.deepEqual(afterPersistenceFailure, beforePersistenceFailure);
assert.equal(await persistenceRepo.getSeriesVersion("tenant_alpha", validImportedSeries.id), null);
assert.deepEqual(await persistenceRepo.getPointVersions("tenant_alpha", validImportedSeries.id), []);

await rm(persistenceRoot, { recursive: true, force: true });

const root = await mkdtemp(join(tmpdir(), "regulatory-foundation-"));
const repo = new LocalRegulatoryRepository(root);

const alphaSourceDraft = draftSource("tenant_alpha", "shared-source-v1-alpha", "SHARED-SOURCE");
const betaSourceDraft = draftSource("tenant_beta", "shared-source-v1-beta", "SHARED-SOURCE");
await repo.save(alphaSourceDraft);
await repo.save(betaSourceDraft);
assert.equal((await repo.get("tenant_alpha", betaSourceDraft.id)), null);
assert.equal((await repo.get("tenant_beta", alphaSourceDraft.id)), null);

const alphaSourceEvidence = evidenceFor("tenant_alpha", "OfficialSource", alphaSourceDraft, "source-evidence");
await repo.put(alphaSourceEvidence);
await repo.approve({ tenantId: "tenant_alpha", subjectType: "OfficialSource", subjectId: alphaSourceDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "OfficialSource", alphaSourceDraft, alphaSourceEvidence, "review-source-alpha") });
const alphaSourceApproved = await repo.getCurrentSource("tenant_alpha", alphaSourceDraft.id);
assert.ok(alphaSourceApproved);
assert.notEqual(alphaSourceApproved.id, alphaSourceDraft.id);
assert.equal((await repo.getVersionState("tenant_alpha", "OfficialSource", alphaSourceDraft.id))?.state, "SUPERSEDED");
assert.equal((await repo.getVersionState("tenant_alpha", "OfficialSource", alphaSourceApproved.id))?.state, "CURRENT");

const betaSourceEvidence = evidenceFor("tenant_beta", "OfficialSource", betaSourceDraft, "source-evidence");
await repo.put(betaSourceEvidence);
await assert.rejects(
  () => repo.approve({ tenantId: "tenant_beta", subjectType: "OfficialSource", subjectId: betaSourceDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_beta", "OfficialSource", betaSourceDraft, alphaSourceEvidence, "review-source-beta-bad") }),
  /REVIEW_EVIDENCE_INVALID/
);
const betaForeignSubject = draftSource("tenant_beta", "foreign-source-v1", "FOREIGN-SOURCE");
await repo.save(betaForeignSubject);
const betaForeignEvidence = evidenceFor("tenant_beta", "OfficialSource", betaSourceDraft, "foreign-evidence");
await repo.put(betaForeignEvidence);
await assert.rejects(
  () => repo.approve({ tenantId: "tenant_beta", subjectType: "OfficialSource", subjectId: betaForeignSubject.id, reviewer: "reviewer", decision: reviewFor("tenant_beta", "OfficialSource", betaForeignSubject, betaForeignEvidence, "review-source-beta-mismatch") }),
  /REVIEW_EVIDENCE_SUBJECT_MISMATCH/
);
await repo.approve({ tenantId: "tenant_beta", subjectType: "OfficialSource", subjectId: betaSourceDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_beta", "OfficialSource", betaSourceDraft, betaSourceEvidence, "review-source-beta") });
const betaSourceApproved = await repo.getCurrentSource("tenant_beta", betaSourceDraft.id);
assert.ok(betaSourceApproved);
assert.notEqual(betaSourceApproved.id, alphaSourceApproved.id);

const alphaDocumentDraft = draftDocument("tenant_alpha", "document-v1", "ALPHA-DOCUMENT", alphaSourceApproved.id);
await repo.importDocument(alphaDocumentDraft);
const alphaDocumentEvidence = evidenceFor("tenant_alpha", "RegulatoryDocument", alphaDocumentDraft, "document-evidence");
await repo.put(alphaDocumentEvidence);
await repo.approve({ tenantId: "tenant_alpha", subjectType: "RegulatoryDocument", subjectId: alphaDocumentDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "RegulatoryDocument", alphaDocumentDraft, alphaDocumentEvidence, "review-document-alpha") });
const alphaDocumentApproved = await repo.getDocument("tenant_alpha", deterministicId("RegulatoryDocument", "tenant_alpha|ALPHA-DOCUMENT", "2"));
assert.ok(alphaDocumentApproved);

const alphaRuleDraft = draftRule("tenant_alpha", "rule-v1", "ALPHA-RULE", alphaDocumentApproved.id);
await repo.importRule(alphaRuleDraft);
const alphaRuleEvidence = evidenceFor("tenant_alpha", "RegulatoryRuleVersion", alphaRuleDraft, "rule-evidence");
await repo.put(alphaRuleEvidence);
await repo.approve({ tenantId: "tenant_alpha", subjectType: "RegulatoryRuleVersion", subjectId: alphaRuleDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "RegulatoryRuleVersion", alphaRuleDraft, alphaRuleEvidence, "review-rule-alpha") });
const alphaRuleApproved = await repo.getRule("tenant_alpha", deterministicId("RegulatoryRuleVersion", "tenant_alpha|ALPHA-RULE", "2"));
assert.ok(alphaRuleApproved);

const alphaSeriesDraft = draftSeries("tenant_alpha", "series-v1", "ALPHA-SERIES", alphaSourceApproved.id, alphaDocumentApproved.id, alphaRuleApproved.id);
const alphaPointDraft = draftPoint("tenant_alpha", "point-v1", "ALPHA-POINT", alphaSourceApproved.id, alphaSeriesDraft.id);
await repo.importSeries(alphaSeriesDraft, [alphaPointDraft]);
const alphaSeriesEvidence = evidenceFor("tenant_alpha", "MarketDataSeries", alphaSeriesDraft, "series-evidence");
const alphaPointEvidence = evidenceFor("tenant_alpha", "MarketDataPoint", alphaPointDraft, "point-evidence");
await repo.put(alphaSeriesEvidence);
await repo.put(alphaPointEvidence);
await repo.approve({ tenantId: "tenant_alpha", subjectType: "MarketDataSeries", subjectId: alphaSeriesDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "MarketDataSeries", alphaSeriesDraft, alphaSeriesEvidence, "review-series-alpha") });
const alphaSeriesApprovedId = deterministicId("MarketDataSeries", "tenant_alpha|ALPHA-SERIES", "2");
const alphaSeriesApproved = await repo.getSeries("tenant_alpha", alphaSeriesApprovedId);
assert.ok(alphaSeriesApproved);
await repo.approve({ tenantId: "tenant_alpha", subjectType: "MarketDataPoint", subjectId: alphaPointDraft.id, reviewer: "reviewer", decision: reviewFor("tenant_alpha", "MarketDataPoint", alphaPointDraft, alphaPointEvidence, "review-point-alpha") });
const alphaPointApprovedId = deterministicId("MarketDataPoint", "tenant_alpha|ALPHA-POINT", "2");
const alphaPointApproved = (await repo.getPointVersions("tenant_alpha", alphaSeriesApproved.id)).find((item) => item.id === alphaPointApprovedId);
assert.ok(alphaPointApproved);
assert.equal(alphaPointApproved.seriesId, alphaSeriesApproved.id);

const resolver = new UsableDataResolver(repo);
const usable = await resolver.resolve("tenant_alpha", alphaSeriesApproved.id, "2027-01-15", "PUN", "MONTHLY");
assert.equal(usable.kind, "USABLE");
assert.equal(usable.series.id, alphaSeriesApproved.id);
assert.equal(usable.points[0].id, alphaPointApprovedId);
assert.equal(await resolver.resolve("tenant_beta", alphaSeriesApproved.id, "2027-01-15", "PUN", "MONTHLY").then((value) => value.kind === "UNUSABLE" ? value.reason : "USABLE"), "DATA_NOT_FOUND");

const seriesHistory = await repo.getSeriesHistory("tenant_alpha", alphaSeriesApproved.id);
const pointHistory = await repo.getPointHistory("tenant_alpha", alphaSeriesApproved.id);
assert.deepEqual(seriesHistory.map((item) => item.version), ["1", "2"]);
assert.deepEqual(pointHistory.map((item) => item.version), ["1", "2"]);

const storePath = join(root, "records.json");
const reversed = JSON.parse(await readFile(storePath, "utf8"));
reversed.sources = [...reversed.sources].reverse();
reversed.documents = [...reversed.documents].reverse();
reversed.rules = [...reversed.rules].reverse();
reversed.series = [...reversed.series].reverse();
reversed.points = [...reversed.points].reverse();
await writeFile(storePath, JSON.stringify(reversed, null, 2), "utf8");
const reorderedRepo = new LocalRegulatoryRepository(root);
assert.equal((await reorderedRepo.getCurrentSource("tenant_alpha", alphaSourceDraft.id))?.id, alphaSourceApproved.id);
assert.equal((await reorderedRepo.getSeriesHistory("tenant_alpha", alphaSeriesApproved.id)).at(-1)?.id, alphaSeriesApproved.id);

const baseStore = JSON.parse(await readFile(storePath, "utf8"));

const reviewVersionMismatchStore = JSON.parse(JSON.stringify(baseStore));
reviewVersionMismatchStore.reviews.find((item) => item.id === alphaSeriesApproved.reviewDecisionId).subjectVersionId = alphaSeriesDraft.id;
const reviewVersionMismatchRoot = await writeStoreCopy("regulatory-review-version-mismatch-", reviewVersionMismatchStore);
const reviewVersionMismatchResult = await new UsableDataResolver(new LocalRegulatoryRepository(reviewVersionMismatchRoot)).resolve("tenant_alpha", alphaSeriesApproved.id, "2027-01-15", "PUN", "MONTHLY");
assert.equal(reviewVersionMismatchResult.kind, "UNUSABLE");
assert.equal(reviewVersionMismatchResult.reason, "EVIDENCE_MISSING");
await rm(reviewVersionMismatchRoot, { recursive: true, force: true });

const supersededEvidenceStore = JSON.parse(JSON.stringify(baseStore));
const supersededEvidence = supersededEvidenceStore.evidence.find((item) => item.id === alphaSeriesApproved.provenance[0].id);
supersededEvidence.subjectVersionId = alphaSeriesDraft.id;
Object.assign(supersededEvidence, withChecksum(supersededEvidence));
const supersededEvidenceRoot = await writeStoreCopy("regulatory-superseded-evidence-", supersededEvidenceStore);
const supersededEvidenceResult = await new UsableDataResolver(new LocalRegulatoryRepository(supersededEvidenceRoot)).resolve("tenant_alpha", alphaSeriesApproved.id, "2027-01-15", "PUN", "MONTHLY");
assert.equal(supersededEvidenceResult.kind, "UNUSABLE");
assert.equal(supersededEvidenceResult.reason, "EFFECTIVE_DATE_MISMATCH");
await rm(supersededEvidenceRoot, { recursive: true, force: true });

const futureVersionEvidenceStore = JSON.parse(JSON.stringify(baseStore));
const futureVersionEvidence = futureVersionEvidenceStore.evidence.find((item) => item.id === alphaSeriesApproved.provenance[0].id);
futureVersionEvidence.subjectVersionId = "series-version-future";
Object.assign(futureVersionEvidence, withChecksum(futureVersionEvidence));
const futureVersionEvidenceRoot = await writeStoreCopy("regulatory-future-version-evidence-", futureVersionEvidenceStore);
const futureVersionEvidenceResult = await new UsableDataResolver(new LocalRegulatoryRepository(futureVersionEvidenceRoot)).resolve("tenant_alpha", alphaSeriesApproved.id, "2027-01-15", "PUN", "MONTHLY");
assert.equal(futureVersionEvidenceResult.kind, "UNUSABLE");
assert.equal(futureVersionEvidenceResult.reason, "EFFECTIVE_DATE_MISMATCH");
await rm(futureVersionEvidenceRoot, { recursive: true, force: true });

const historicalVersionStore = JSON.parse(JSON.stringify(baseStore));
const currentApprovedSeries = historicalVersionStore.series.find((item) => item.id === alphaSeriesApproved.id);
const historicalSeries = historicalVersionStore.series.find((item) => item.id === alphaSeriesDraft.id);
const historicalInlineEvidence = withChecksum({ ...currentApprovedSeries.provenance[0], id: "series-evidence-historical-mismatch", subjectVersionId: alphaSeriesDraft.id });
const historicalStoredEvidence = withChecksum({ ...historicalInlineEvidence, subjectVersionId: alphaSeriesApproved.id });
historicalSeries.approvalStatus = "APPROVED";
historicalSeries.reviewer = "reviewer";
historicalSeries.reviewDecisionId = "review-series-historical-mismatch";
historicalSeries.provenance = [historicalInlineEvidence];
Object.assign(historicalSeries, withChecksum(historicalSeries));
historicalVersionStore.evidence.push(historicalStoredEvidence);
historicalVersionStore.reviews.push({
  tenantId: "tenant_alpha",
  id: "review-series-historical-mismatch",
  subjectType: "MarketDataSeries",
  subjectId: historicalSeries.officialIdentifier,
  subjectVersionId: historicalSeries.id,
  decision: "APPROVED",
  reviewer: "reviewer",
  reviewedAt: "2027-01-05T00:00:00Z",
  reason: "verified",
  evidenceReferences: [historicalStoredEvidence],
  supersedesDecisionId: null,
});
historicalVersionStore.versionStates = historicalVersionStore.versionStates.map((state) => {
  if (state.subjectType !== "MarketDataSeries") return state;
  if (state.recordId === alphaSeriesDraft.id) return { ...state, state: "CURRENT", supersededBy: null, changedAt: "2027-01-05T00:00:00Z" };
  if (state.recordId === alphaSeriesApproved.id) return { ...state, state: "SUPERSEDED", supersededBy: alphaSeriesDraft.id, changedAt: "2027-01-05T00:00:00Z" };
  return state;
});
const historicalVersionRoot = await writeStoreCopy("regulatory-historical-version-", historicalVersionStore);
const historicalVersionRepo = new LocalRegulatoryRepository(historicalVersionRoot);
const historicalVersionResolver = new UsableDataResolver(historicalVersionRepo);
const historicalSource = await historicalVersionRepo.getCurrentSource("tenant_alpha", alphaSourceDraft.id);
const historicalSeriesVersion = await historicalVersionRepo.getSeriesVersion("tenant_alpha", alphaSeriesDraft.id);
const historicalVersionResult = await historicalVersionResolver.verify("MarketDataSeries", historicalSeriesVersion, "SERIES_NOT_APPROVED", "2027-01-15", historicalSource);
assert.equal(historicalVersionResult.kind, "UNUSABLE");
assert.equal(historicalVersionResult.reason, "EFFECTIVE_DATE_MISMATCH");
await rm(historicalVersionRoot, { recursive: true, force: true });

const conflicting = JSON.parse(await readFile(storePath, "utf8"));
const duplicateEvidencePayload = {
  tenantId: "tenant_alpha",
  id: "point-evidence-duplicate",
  subjectType: "MarketDataPoint",
  subjectId: "ALPHA-POINT-DUPLICATE",
  subjectVersionId: "point-v2-duplicate",
  sourceInstitution: "GME",
  sourceDocumentOrDataset: "CHAIN",
  officialIdentifier: "point-evidence-duplicate",
  sourceUrl: "https://gme.it/point",
  publicationDate: "2027-01-01",
  effectiveFrom: "2027-01-01",
  effectiveTo: null,
  retrievedAt: "2027-01-02T00:00:00Z",
  immutableVersion: "1",
  ingestionStatus: "APPROVED",
  reviewerApprovalStatus: "APPROVED",
  provenance: [],
};
const duplicateEvidence = { ...duplicateEvidencePayload, checksum: checksumFor(duplicateEvidencePayload) };
const duplicateReview = {
  tenantId: "tenant_alpha",
  id: "review-point-duplicate",
  subjectType: "MarketDataPoint",
  subjectId: "ALPHA-POINT-DUPLICATE",
  subjectVersionId: "point-v2-duplicate",
  decision: "APPROVED",
  reviewer: "reviewer",
  reviewedAt: "2027-01-03T00:00:00Z",
  reason: "verified",
  evidenceReferences: [duplicateEvidence],
  supersedesDecisionId: null,
};
const duplicatePointPayload = { ...alphaPointApproved, id: "point-v2-duplicate", officialIdentifier: "ALPHA-POINT-DUPLICATE", version: "1", parentVersionId: null, reviewDecisionId: duplicateReview.id, provenance: [duplicateEvidence] };
delete duplicatePointPayload.checksum;
const duplicatePoint = { ...duplicatePointPayload, checksum: checksumFor(duplicatePointPayload) };
conflicting.points.push(duplicatePoint);
conflicting.evidence.push(duplicateEvidence);
conflicting.reviews.push(duplicateReview);
conflicting.versionStates.push({
  tenantId: "tenant_alpha",
  subjectType: "MarketDataPoint",
  subjectId: duplicatePoint.officialIdentifier,
  recordId: duplicatePoint.id,
  state: "CURRENT",
  supersededBy: null,
  changedAt: "2027-01-04T00:00:00Z",
});
await writeFile(storePath, JSON.stringify(conflicting, null, 2), "utf8");
const conflictingRepo = new LocalRegulatoryRepository(root);
const conflictResult = await new UsableDataResolver(conflictingRepo).resolve("tenant_alpha", alphaSeriesApproved.id, "2027-01-15", "PUN", "MONTHLY");
assert.equal(conflictResult.kind, "UNUSABLE");
assert.equal(conflictResult.reason, "CONFLICTING_APPROVED_VERSIONS");

await rm(root, { recursive: true, force: true });
console.log("regulatory-market smoke tests passed");
