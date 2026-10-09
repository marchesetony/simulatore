// SYNTHETIC fixtures only. No institutional values, documents or official golden tests.
import { createHash } from "node:crypto";
import { digest, immutable } from "../modules/market/integrity.ts";
import { componentIdentity } from "../modules/regulatory/schema.ts";

export const at = "2026-03-02T12:00:00.000Z";
export const coverage = { validFrom: "2026-02-01", validTo: "2026-02-28" };
export const source = { sourceId: "synthetic-source", institution: "SYNTHETIC TEST INSTITUTION", dataset: "SYNTHETIC EE",
  authorizedIdentity: "test-only-authority", parserVersion: "test-parser-1", status: "APPROVED" };
export function version(id = "version-a", acquiredAt = "2026-03-01T12:00:00.000Z", supersedesVersionId = null) {
  return { versionId: id, sourceId: source.sourceId, acquiredAt,
    publicationEvidence: { publishedAt: acquiredAt, reference: "SYNTHETIC publication evidence" },
    documentReference: "test-fixture-document", contentHash: createHash("sha256").update("SYNTHETIC TEST DOCUMENT").digest("hex"),
    parserVersion: source.parserVersion, revision: id, validationStatus: "VALID", supersedesVersionId,
    reviews: ["ACQUIRED", "VALIDATED", "APPROVED", "PUBLISHED"].map(stage => ({ stage, at: acquiredAt,
      actorId: "synthetic-reviewer", evidence: "test-only-review", human: stage === "APPROVED" })) };
}
export const observations = (versionId = "version-a", referenceMonth = "2026-02") => ["F1", "F2", "F3"].map((band, i) => ({
  observationId: `${versionId}/${referenceMonth}/${band}`, versionId, referenceMonth, band,
  unit: "EUR_PER_MWH", sourceLocator: `synthetic-row-${i}`, valueState: "KNOWN", value: String(i), evidence: null,
}));
export function marketCatalog(versions = [version()]) {
  return { sources: [source], versions, observations: versions.flatMap(v => observations(v.versionId)) };
}
export function marketRequest(catalog = marketCatalog()) {
  return { snapshotId: "market-snapshot-a", coverage, selectionPolicy: { mode: "REPLAY", previousSnapshotId: null,
    versionIds: [catalog.versions[0].versionId] }, asOf: at, createdAt: at,
    observationIds: catalog.observations.filter(o => o.versionId === catalog.versions[0].versionId).map(o => o.observationId) };
}
export function component(overrides = {}) {
  return { componentId: "component-a", code: "SYNTHETIC_COMPONENT", economicDomain: "NETWORK", customerScope: "SYNTHETIC EE CUSTOMER",
    applicationBasis: "ENERGY_KWH", unit: "EUR_PER_KWH", valueState: "KNOWN", value: "0", evidence: null, ...coverage,
    sourceVersionId: "version-a", sourceLocator: "synthetic-cell", applicability: { status: "APPLIES", evidence: "synthetic-applicability" },
    includes: [], excludes: [], ...overrides };
}
export function regulatoryCatalog(components = [component()]) {
  return { sources: [{ ...source, authorityReference: "synthetic-legal-authority" }],
    versions: [version()], components };
}
export function regulatoryRequest(catalog = regulatoryCatalog()) {
  return { snapshotId: "regulatory-snapshot-a", coverage, selectionPolicy: { mode: "REPLAY", previousSnapshotId: null,
    versionIds: catalog.versions.map(v => v.versionId) }, asOf: at, createdAt: at, componentIds: catalog.components.map(c => c.componentId),
    requiredIdentities: [...new Set(catalog.components.map(componentIdentity))] };
}
/** Explicit test authority, bound to fixture content; never imported by runtime. */
export function authorityFor(catalog) {
  const trusted = immutable(catalog);
  const document = v => Object.fromEntries(Object.entries(v).filter(([key]) => key !== "reviews" && key !== "validationStatus"));
  return {
    verifySource: s => trusted.sources.some(item => digest(item) === digest(s)),
    verifyDocument: v => trusted.versions.some(item => digest(document(item)) === digest(document(v))),
    verifyReview: (v, r) => trusted.versions.some(item => item.versionId === v.versionId && item.reviews.some(review => digest(review) === digest(r))),
    verifyNormalizedRecord: (r, v) => [...(trusted.observations ?? []), ...(trusted.components ?? [])].some(item =>
      (item.versionId ?? item.sourceVersionId) === v.versionId && digest(item) === digest(r)),
    verifyApplicability: (id, evidence, v) => (trusted.components ?? []).some(c => c.componentId === id && c.sourceVersionId === v.versionId &&
      (c.applicability.evidence === evidence || c.evidence === evidence)),
  };
}
/** Test-only published read view, captured BEFORE exercising mutations. */
export function snapshotEvidence(...snapshots) {
  const pinned = immutable(snapshots);
  return Object.freeze({ readPublishedSnapshot: id => pinned.find(s => s.snapshotId === id) ?? null });
}
export function attempt(outcome = "NO_NEW_DATA") {
  return { attemptId: `attempt-${outcome}`, sourceId: source.sourceId, scheduledFor: "2026-03-01", startedAt: at, finishedAt: at,
    outcome, errorCode: outcome === "ERROR" || outcome === "INVALID_DATA" ? "SYNTHETIC_FAILURE" : null,
    publishedVersionId: outcome === "PUBLISHED" ? "version-a" : null,
    publicationEventId: outcome === "PUBLISHED" ? "synthetic-publication" : null };
}
export function publication(snapshot, a = attempt("PUBLISHED")) {
  return { eventId: a.publicationEventId, attemptId: a.attemptId, sourceId: a.sourceId,
    versionId: a.publishedVersionId, snapshotId: snapshot.snapshotId, publishedAt: at };
}
