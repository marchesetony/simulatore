// TEST ONLY: serial synchronous staging models an atomic transaction; not production persistence.
import { parseAcquisitionAttempt, parsePublicationEvent, validatePublication } from "../modules/market/acquisition.ts";
import { fail } from "../modules/market/errors.ts";
import { parseSource, parseVersion, transition } from "../modules/market/governance.ts";
import { digest, immutable, verifyHash } from "../modules/market/integrity.ts";
import { distinct, list, text } from "../modules/market/primitives.ts";
import { parseMarketObservation } from "../modules/market/schema.ts";
import { selectVersions } from "../modules/market/selection.ts";
import { createMarketSnapshot } from "../modules/market/service.ts";
import { timestamp } from "../modules/market/temporal.ts";
import { parseRegulatoryComponent, parseRegulatorySource } from "../modules/regulatory/schema.ts";
import { createRegulatorySnapshot } from "../modules/regulatory/service.ts";

export const emptyBatch = () => ({ sources: [], versions: [], records: [], reviews: [], snapshots: [], attempts: [], publications: [] });
export class MemoryRepository {
  #state = { sources: [], versions: [], records: [], snapshots: [], attempts: [], publications: [] };
  #receipts = new Map();
  #revision = 0;
  constructor(kind, authority) { this.kind = kind; this.authority = authority; }
  get revision() { return this.#revision; }
  #catalog(state) {
    return { sources: state.sources, versions: state.versions,
      [this.kind === "market" ? "observations" : "components"]: state.records };
  }
  #append(rows, incoming, idKey, parse) {
    distinct(incoming.map(row => row[idKey]));
    for (const raw of incoming) {
      const row = parse(raw);
      if (rows.some(old => old[idKey] === row[idKey])) fail("IMMUTABLE_CONFLICT");
      rows.push(row);
    }
  }
  async commit(batch, guard) {
    [batch.sources, batch.versions, batch.records, batch.reviews, batch.snapshots, batch.attempts, batch.publications].forEach(rows => list(rows, row => row));
    text(guard.idempotencyKey);
    if (!Number.isSafeInteger(guard.expectedRevision) || guard.expectedRevision < 0) fail("INVALID_INPUT");
    const fingerprint = digest({ batch, guard }), cached = this.#receipts.get(guard.idempotencyKey);
    if (cached) { if (cached.fingerprint !== fingerprint) fail("IMMUTABLE_CONFLICT"); return cached.receipt; }
    if (guard.expectedRevision !== this.#revision) fail("CONCURRENCY_CONFLICT");
    const staged = structuredClone(this.#state), regulatory = this.kind === "regulatory";
    this.#append(staged.sources, batch.sources, "sourceId", regulatory ? parseRegulatorySource : parseSource);
    this.#append(staged.versions, batch.versions, "versionId", parseVersion);
    for (const v of staged.versions) {
      if (!staged.sources.some(s => s.sourceId === v.sourceId)) fail("UNKNOWN_SOURCE");
      if (v.supersedesVersionId) {
        const old = staged.versions.find(item => item.versionId === v.supersedesVersionId);
        if (!old || old.sourceId !== v.sourceId || old.acquiredAt >= v.acquiredAt) fail("INCOMPATIBLE_VERSION");
      }
    }
    for (const event of batch.reviews) {
      const index = staged.versions.findIndex(v => v.versionId === event.versionId);
      if (index < 0) fail("VERSION_NOT_FOUND");
      staged.versions[index] = transition(staged.versions[index], event.review, this.authority);
    }
    this.#append(staged.records, batch.records, regulatory ? "componentId" : "observationId", regulatory ? parseRegulatoryComponent : parseMarketObservation);
    for (const row of staged.records) {
      if (!staged.versions.some(v => v.versionId === (regulatory ? row.sourceVersionId : row.versionId))) fail("VERSION_NOT_FOUND");
    }
    for (const snapshot of batch.snapshots) {
      verifyHash(snapshot);
      if (staged.snapshots.some(s => s.snapshotId === snapshot.snapshotId)) fail("IMMUTABLE_CONFLICT");
      const request = { snapshotId: snapshot.snapshotId, coverage: snapshot.coverage, selectionPolicy: snapshot.selectionPolicy,
        asOf: snapshot.asOf, createdAt: snapshot.createdAt,
        ...(regulatory ? { componentIds: snapshot.componentIds, requiredIdentities: snapshot.requiredIdentities } : { observationIds: snapshot.observationIds }) };
      const previous = staged.snapshots.find(s => s.snapshotId === request.selectionPolicy.previousSnapshotId);
      const build = regulatory ? createRegulatorySnapshot : createMarketSnapshot;
      const evidence = { readPublishedSnapshot: id => staged.snapshots.find(s => s.snapshotId === id) ?? null };
      const verified = build(request, this.#catalog(staged), this.authority, previous, evidence);
      if (verified.hash !== snapshot.hash) fail("PARTIAL_PUBLICATION");
      staged.snapshots.push(verified);
    }
    this.#append(staged.attempts, batch.attempts, "attemptId", parseAcquisitionAttempt);
    this.#append(staged.publications, batch.publications, "eventId", parsePublicationEvent);
    distinct(staged.publications.map(event => event.attemptId));
    for (const event of batch.publications) {
      if (!batch.snapshots.some(s => s.snapshotId === event.snapshotId)) fail("INVALID_PUBLICATION");
      const attempt = staged.attempts.find(a => a.attemptId === event.attemptId);
      const snapshot = staged.snapshots.find(s => s.snapshotId === event.snapshotId);
      if (!attempt || !snapshot) fail("INVALID_PUBLICATION");
      validatePublication(event, attempt, snapshot);
    }
    for (const a of staged.attempts) {
      if (!staged.sources.some(s => s.sourceId === a.sourceId)) fail("UNKNOWN_SOURCE");
      if (a.outcome === "PUBLISHED" && !staged.publications.some(event => event.eventId === a.publicationEventId && event.attemptId === a.attemptId)) fail("INVALID_PUBLICATION");
    }
    const receipt = immutable({ revision: this.#revision + 1, idempotencyKey: guard.idempotencyKey });
    this.#state = immutable(staged); this.#revision = receipt.revision;
    this.#receipts.set(guard.idempotencyKey, { fingerprint, receipt });
    return receipt;
  }
  async getSnapshot(id) { text(id); return this.#state.snapshots.find(s => s.snapshotId === id) ?? null; }
  async selectAsOf(ids, asOf) {
    if (!ids.length) fail("INVALID_INPUT");
    timestamp(asOf);
    const sources = this.#state.sources.map(s => ({ sourceId: s.sourceId, institution: s.institution, dataset: s.dataset,
      authorizedIdentity: s.authorizedIdentity, parserVersion: s.parserVersion, status: s.status }));
    const authority = { ...this.authority, verifySource: s => this.authority.verifySource(this.#state.sources.find(item => item.sourceId === s.sourceId)) };
    return immutable(selectVersions(ids, this.#state.versions, sources, asOf, authority).versions);
  }
}
