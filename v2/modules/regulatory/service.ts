import "server-only";
import { fail } from "../market/errors";
import type { SourceAuthority } from "../market/governance";
import { digest, immutable, verifyHash } from "../market/integrity";
import { distinct, list } from "../market/primitives";
import { checkRecalculation, checkRevisions, verifySnapshotChain, unavailableSnapshotEvidence, type SnapshotEvidence } from "../market/recalculation";
import { selectVersions } from "../market/selection";
import { completeCoverage, type Period } from "../market/temporal";
import { componentIdentity, parseRegulatoryComponent, parseRegulatoryRequest, parseRegulatorySource } from "./schema";
import type { RegulatoryComponent, RegulatorySnapshot, RegulatorySource, RegulatoryVersion } from "./types";

export interface RegulatoryCatalog {
  readonly sources: readonly RegulatorySource[]; readonly versions: readonly RegulatoryVersion[];
  readonly components: readonly RegulatoryComponent[];
}
function loadComponent(id: string, catalog: RegulatoryCatalog): RegulatoryComponent {
  const raw = catalog.components.find(c => c.componentId === id);
  if (!raw) return fail("UNRESOLVED_RELATION");
  return parseRegulatoryComponent(raw);
}
function checkRelationCycles(rows: readonly RegulatoryComponent[]): void {
  const edges = new Map<string, Set<string>>();
  rows.forEach(c => {
    const identity = componentIdentity(c), targets = edges.get(identity) ?? new Set<string>();
    [...c.includes, ...c.excludes].forEach(id => {
      const target = rows.find(r => r.componentId === id);
      if (!target) return fail("UNRESOLVED_RELATION");
      targets.add(componentIdentity(target));
    });
    edges.set(identity, targets);
  });
  while (edges.size) {
    const leaves = [...edges].filter(([, targets]) => targets.size === 0).map(([id]) => id);
    if (!leaves.length) return fail("UNRESOLVED_RELATION");
    leaves.forEach(id => { edges.delete(id); edges.forEach(targets => targets.delete(id)); });
  }
}
/** Relations pin physical records but conflicts/cycles follow stable economic identities. */
function resolveRelations(components: readonly RegulatoryComponent[], catalog: RegulatoryCatalog, coverage: Period): readonly RegulatoryComponent[] {
  const resolved = new Map<string, RegulatoryComponent>();
  const pending = components.map(component => ({ component, path: [] as readonly string[] }));
  while (pending.length) {
    const { component: c, path } = pending.pop()!;
    const identity = componentIdentity(c);
    if (path.includes(identity)) return fail("UNRESOLVED_RELATION");
    const targets = [...c.includes, ...c.excludes].map(id => loadComponent(id, catalog));
    distinct(targets.map(componentIdentity));
    for (const target of targets) {
      const targetIdentity = componentIdentity(target);
      if (targetIdentity === identity || path.includes(targetIdentity)) return fail("UNRESOLVED_RELATION");
      const from = c.validFrom > coverage.validFrom ? c.validFrom : coverage.validFrom;
      const to = c.validTo < coverage.validTo ? c.validTo : coverage.validTo;
      if (from > to || target.validFrom > from || target.validTo < to) return fail("UNRESOLVED_RELATION");
      if (components.some(selected => componentIdentity(selected) === targetIdentity && selected.validFrom <= to && selected.validTo >= from)) return fail("DUPLICATE_IDENTITY");
      const bound = [...resolved.values()].find(other => componentIdentity(other) === targetIdentity);
      if (bound && bound.componentId !== target.componentId) return fail("UNRESOLVED_RELATION");
      if (!resolved.has(target.componentId)) {
        resolved.set(target.componentId, target);
        pending.push({ component: target, path: [...path, identity] });
      }
    }
  }
  checkRelationCycles([...components, ...resolved.values()]);
  return [...resolved.values()].sort((a, b) => a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0);
}
function verifyComponent(c: RegulatoryComponent, versions: readonly RegulatoryVersion[], authority: SourceAuthority): void {
  const version = versions.find(v => v.versionId === c.sourceVersionId);
  if (!version) return fail("INCOMPATIBLE_VERSION");
  if (!authority.verifyNormalizedRecord(c, version) || !authority.verifyApplicability(c.componentId, c.applicability.evidence, version)) return fail("DOCUMENT_UNVERIFIED");
  if (c.valueState !== "KNOWN" && c.valueState !== "NOT_APPLICABLE") return fail("MISSING_VALUE");
  if (c.valueState === "NOT_APPLICABLE" && !authority.verifyApplicability(c.componentId, c.evidence, version)) return fail("DOCUMENT_UNVERIFIED");
}
export function createRegulatorySnapshot(input: unknown, catalog: RegulatoryCatalog, authority: SourceAuthority, previous?: RegulatorySnapshot,
  evidence: SnapshotEvidence<RegulatorySnapshot> = unavailableSnapshotEvidence): RegulatorySnapshot {
  const request = parseRegulatoryRequest(input), sources = list(catalog.sources, parseRegulatorySource);
  checkRecalculation(request, previous, evidence);
  list(catalog.components, value => value);
  distinct(catalog.components.map(c => c.componentId));
  const components = request.componentIds.map(id => {
    if (!catalog.components.some(c => c.componentId === id)) return fail("MISSING_VALUE");
    return loadComponent(id, catalog);
  });
  if (components.some(c => !request.selectionPolicy.versionIds.includes(c.sourceVersionId))) return fail("INCOMPATIBLE_VERSION");
  const relationComponents = resolveRelations(components, catalog, request.coverage);
  const versionIds = [...new Set([...request.selectionPolicy.versionIds, ...relationComponents.map(c => c.sourceVersionId)])];
  // Keep regulatory authority metadata in the trusted source check; base schema is deliberately strict.
  const baseSources = sources.map(s => ({ sourceId: s.sourceId, institution: s.institution, dataset: s.dataset,
    authorizedIdentity: s.authorizedIdentity, parserVersion: s.parserVersion, status: s.status }));
  const selected = selectVersions(versionIds, catalog.versions, baseSources, request.asOf, {
    verifyDocument: v => authority.verifyDocument(v), verifyReview: (v, r) => authority.verifyReview(v, r),
    verifyApplicability: (id, e, v) => authority.verifyApplicability(id, e, v),
    verifyNormalizedRecord: (r, v) => authority.verifyNormalizedRecord(r, v),
    verifySource: s => { const full = sources.find(source => source.sourceId === s.sourceId); return !!full && authority.verifySource(full); },
  });
  if (previous) {
    verifySnapshotChain(previous, evidence);
    checkRevisions(selected.versions.filter(v => request.selectionPolicy.versionIds.includes(v.versionId)),
      previous.versions.filter(v => previous.selectionPolicy.versionIds.includes(v.versionId)), catalog.versions);
    if (digest([...request.requiredIdentities].sort()) !== digest([...previous.requiredIdentities].sort())) return fail("INCOMPATIBLE_VERSION");
  }
  [...components, ...relationComponents].forEach(c => verifyComponent(c, selected.versions, authority));
  distinct(components.map(c => JSON.stringify([componentIdentity(c), c.validFrom, c.validTo])));
  if (components.some(c => !request.requiredIdentities.includes(componentIdentity(c)))) return fail("INVALID_INPUT");
  request.requiredIdentities.forEach(id => completeCoverage(request.coverage, components.filter(c => componentIdentity(c) === id).map(c => ({ validFrom: c.validFrom, validTo: c.validTo }))));
  if (request.selectionPolicy.versionIds.some(id => !components.some(c => c.sourceVersionId === id))) return fail("INCOMPATIBLE_VERSION");
  const payload = { ...request, schemaVersion: 1 as const, components, relationComponents, versions: selected.versions, versionHistory: selected.versionHistory,
    sources: sources.filter(s => selected.sources.some(selectedSource => selectedSource.sourceId === s.sourceId)), validationResult: "VALID" as const };
  return immutable({ ...payload, hash: digest(payload) });
}
export function replayRegulatory(snapshot: RegulatorySnapshot, authority: SourceAuthority,
  evidence: SnapshotEvidence<RegulatorySnapshot> = unavailableSnapshotEvidence): RegulatorySnapshot {
  verifySnapshotChain(snapshot, evidence);
  const { snapshotId, coverage, selectionPolicy, asOf, createdAt, componentIds, requiredIdentities } = parseRegulatoryRequest({
    snapshotId: snapshot.snapshotId, coverage: snapshot.coverage, selectionPolicy: snapshot.selectionPolicy,
    asOf: snapshot.asOf, createdAt: snapshot.createdAt, componentIds: snapshot.componentIds, requiredIdentities: snapshot.requiredIdentities });
  const previous = selectionPolicy.previousSnapshotId === null ? undefined : evidence.readPublishedSnapshot(selectionPolicy.previousSnapshotId) ?? undefined;
  const result = createRegulatorySnapshot({ snapshotId, coverage, selectionPolicy, asOf, createdAt, componentIds, requiredIdentities },
    { ...snapshot, components: [...snapshot.components, ...snapshot.relationComponents], versions: [...snapshot.versions, ...snapshot.versionHistory] }, authority, previous, evidence);
  verifyHash({ ...result, hash: snapshot.hash });
  return immutable(snapshot);
}
