import { fail } from "./errors";
import { parseSource, parseVersion, usableVersion, type Source, type SourceAuthority, type Version } from "./governance";
import { distinct, list, text } from "./primitives";
import { timestamp } from "./temporal";

/** Explicit IDs only. Revision labels have no ordering semantics. */
export function selectVersions(ids: readonly string[], catalog: readonly Version[], sources: readonly Source[],
  asOf: string, authority: SourceAuthority): { versions: readonly Version[]; versionHistory: readonly Version[]; sources: readonly Source[] } {
  list(ids, text); list(catalog, value => value); list(sources, value => value); timestamp(asOf);
  if (!ids.length) return fail("INVALID_INPUT");
  distinct(ids); distinct(catalog.map(v => v.versionId)); distinct(sources.map(s => s.sourceId));
  const parsedSources = sources.map(parseSource);
  const versions = ids.map(id => {
    const raw = catalog.find(v => v.versionId === id);
    if (!raw) return fail("VERSION_NOT_FOUND");
    const v = parseVersion(raw);
    usableVersion(v, parsedSources, asOf, authority);
    return v;
  });
  const history = new Map<string, Version>();
  for (const selected of versions) {
    let current = selected;
    const visited = new Set<string>();
    while (current.supersedesVersionId) {
      if (visited.has(current.versionId)) return fail("INCOMPATIBLE_VERSION");
      visited.add(current.versionId);
      const raw = catalog.find(item => item.versionId === current.supersedesVersionId);
      if (!raw) return fail("VERSION_NOT_FOUND");
      const old = parseVersion(raw);
      if (old.acquiredAt > asOf || (old.publicationEvidence && old.publicationEvidence.publishedAt > asOf) ||
          old.reviews.some(review => review.at > asOf)) return fail("AS_OF_UNPROVEN");
      if (old.sourceId !== current.sourceId || old.acquiredAt >= current.acquiredAt) return fail("INCOMPATIBLE_VERSION");
      if (!authority.verifyDocument(old)) return fail("DOCUMENT_UNVERIFIED");
      if (old.reviews.some(review => !authority.verifyReview(old, review))) return fail("APPROVAL_REQUIRED");
      if (!ids.includes(old.versionId)) history.set(old.versionId, old);
      current = old;
    }
  }
  return { versions, versionHistory: [...history.values()], sources: parsedSources.filter(s => versions.some(v => v.sourceId === s.sourceId)) };
}
