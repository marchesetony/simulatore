import { fail } from "./errors";
import { digest, verifyHash } from "./integrity";
import { selectionPolicy } from "./schema";
import type { Period } from "./temporal";
import type { SelectionPolicy } from "./types";
import type { Version } from "./governance";

export interface Selected {
  readonly snapshotId: string; readonly coverage: Period; readonly selectionPolicy: SelectionPolicy;
  readonly asOf: string; readonly hash: string;
}
/** Server-owned immutable published-snapshot read view, never a client-supplied hash.
 * A future persistence adapter must authenticate this view. No provider or default store exists. */
export interface SnapshotEvidence<T extends Selected> {
  readPublishedSnapshot(snapshotId: string): T | null;
}
export const unavailableSnapshotEvidence: SnapshotEvidence<never> = Object.freeze({ readPublishedSnapshot: () => null });
export function verifyPublishedSnapshot<T extends Selected>(snapshot: T, evidence: SnapshotEvidence<T>): void {
  verifyHash(snapshot);
  const published = evidence.readPublishedSnapshot(snapshot.snapshotId);
  if (!published || digest(published) !== digest(snapshot)) return fail("SNAPSHOT_UNVERIFIED");
  verifyHash(published);
}
export function checkRevisions(selected: readonly Version[], previous: readonly Version[], catalog: readonly Version[]): void {
  for (const version of selected) {
    if (previous.some(old => old.versionId === version.versionId)) continue;
    let current = version;
    const visited = new Set<string>();
    while (!previous.some(old => old.versionId === current.versionId)) {
      if (visited.has(current.versionId) || !current.supersedesVersionId) return fail("INCOMPATIBLE_VERSION");
      visited.add(current.versionId);
      const predecessor = catalog.find(v => v.versionId === current.supersedesVersionId);
      if (!predecessor || predecessor.sourceId !== current.sourceId || predecessor.acquiredAt >= current.acquiredAt) return fail("INCOMPATIBLE_VERSION");
      current = predecessor;
    }
  }
}
export function checkRecalculation(request: Omit<Selected, "hash">, previous?: Selected,
  evidence: SnapshotEvidence<Selected> = unavailableSnapshotEvidence): void {
  selectionPolicy(request.selectionPolicy);
  if (request.selectionPolicy.mode === "REPLAY") {
    if (previous || request.selectionPolicy.previousSnapshotId !== null) fail("INVALID_INPUT");
    return;
  }
  if (request.snapshotId === request.selectionPolicy.previousSnapshotId) return fail("INCOMPATIBLE_VERSION");
  if (!previous) return fail("SNAPSHOT_UNVERIFIED");
  verifyPublishedSnapshot(previous, evidence);
  if (request.snapshotId === previous.snapshotId || request.selectionPolicy.previousSnapshotId !== previous.snapshotId ||
    request.coverage.validFrom !== previous.coverage.validFrom || request.coverage.validTo !== previous.coverage.validTo ||
    request.asOf < previous.asOf || request.selectionPolicy.versionIds.every(id => previous.selectionPolicy.versionIds.includes(id))) fail("INCOMPATIBLE_VERSION");
}
export function verifySnapshotChain<T extends Selected & { readonly versions: readonly Version[]; readonly versionHistory: readonly Version[] }>(
  snapshot: T, evidence: SnapshotEvidence<T>): void {
  const visited = new Set<string>();
  let current = snapshot;
  while (true) {
    if (visited.has(current.snapshotId)) return fail("INCOMPATIBLE_VERSION");
    visited.add(current.snapshotId);
    verifyPublishedSnapshot(current, evidence);
    const policy = selectionPolicy(current.selectionPolicy);
    if (policy.mode === "REPLAY") { checkRecalculation(current); return; }
    const previous = evidence.readPublishedSnapshot(policy.previousSnapshotId!);
    if (!previous) return fail("SNAPSHOT_UNVERIFIED");
    checkRecalculation(current, previous, evidence);
    checkRevisions(current.versions.filter(v => policy.versionIds.includes(v.versionId)),
      previous.versions.filter(v => previous.selectionPolicy.versionIds.includes(v.versionId)), [...current.versions, ...current.versionHistory]);
    current = previous;
  }
}
