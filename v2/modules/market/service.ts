import "server-only";
import { fail } from "./errors";
import type { SourceAuthority } from "./governance";
import { digest, immutable, verifyHash } from "./integrity";
import { distinct, list } from "./primitives";
import { checkRecalculation, checkRevisions, verifySnapshotChain, unavailableSnapshotEvidence, type SnapshotEvidence } from "./recalculation";
import { parseMarketObservation, parseMarketRequest } from "./schema";
import { selectVersions } from "./selection";
import { months } from "./temporal";
import type { MarketObservation, MarketSnapshot, MarketSource, MarketVersion } from "./types";

export interface MarketCatalog {
  readonly sources: readonly MarketSource[]; readonly versions: readonly MarketVersion[];
  readonly observations: readonly MarketObservation[];
}
export function createMarketSnapshot(input: unknown, catalog: MarketCatalog, authority: SourceAuthority, previous?: MarketSnapshot,
  evidence: SnapshotEvidence<MarketSnapshot> = unavailableSnapshotEvidence): MarketSnapshot {
  const request = parseMarketRequest(input);
  checkRecalculation(request, previous, evidence);
  const selected = selectVersions(request.selectionPolicy.versionIds, catalog.versions, catalog.sources, request.asOf, authority);
  if (previous) { verifySnapshotChain(previous, evidence); checkRevisions(selected.versions, previous.versions, catalog.versions); }
  list(catalog.observations, value => value);
  distinct(catalog.observations.map(o => o.observationId));
  const observations = request.observationIds.map(id => {
    const raw = catalog.observations.find(o => o.observationId === id);
    if (!raw) return fail("MISSING_VALUE");
    const o = parseMarketObservation(raw);
    const version = selected.versions.find(v => v.versionId === o.versionId);
    if (!version) return fail("INCOMPATIBLE_VERSION");
    if (!authority.verifyNormalizedRecord(o, version)) return fail("DOCUMENT_UNVERIFIED");
    if (o.valueState !== "KNOWN") return fail("MISSING_VALUE");
    return o;
  });
  distinct(observations.map(o => `${o.referenceMonth}/${o.band}`));
  const expected = months(request.coverage).flatMap(m => ["F1", "F2", "F3"].map(b => `${m}/${b}`));
  if (observations.length !== expected.length || expected.some(key => !observations.some(o => `${o.referenceMonth}/${o.band}` === key))) return fail("GAP");
  if (selected.versions.some(v => !observations.some(o => o.versionId === v.versionId))) return fail("INCOMPATIBLE_VERSION");
  const payload = { ...request, schemaVersion: 1 as const, ...selected, observations };
  return immutable({ ...payload, hash: digest(payload) });
}
/** Replay uses the embedded selection, never a mutable current catalog or freshness flag. */
export function replayMarket(snapshot: MarketSnapshot, authority: SourceAuthority,
  evidence: SnapshotEvidence<MarketSnapshot> = unavailableSnapshotEvidence): MarketSnapshot {
  verifySnapshotChain(snapshot, evidence);
  const { snapshotId, coverage, selectionPolicy, asOf, createdAt, observationIds } = parseMarketRequest({
    snapshotId: snapshot.snapshotId, coverage: snapshot.coverage, selectionPolicy: snapshot.selectionPolicy,
    asOf: snapshot.asOf, createdAt: snapshot.createdAt, observationIds: snapshot.observationIds });
  const previous = selectionPolicy.previousSnapshotId === null ? undefined : evidence.readPublishedSnapshot(selectionPolicy.previousSnapshotId) ?? undefined;
  const result = createMarketSnapshot({ snapshotId, coverage, selectionPolicy, asOf, createdAt, observationIds },
    { ...snapshot, versions: [...snapshot.versions, ...snapshot.versionHistory] }, authority, previous, evidence);
  verifyHash({ ...result, hash: snapshot.hash });
  return immutable(snapshot);
}
