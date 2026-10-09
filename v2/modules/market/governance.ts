import "server-only";
import { fail } from "./errors";
import { immutable } from "./integrity";
import { choice, hashText, list, object, text } from "./primitives";
import { timestamp } from "./temporal";

export interface Source {
  readonly sourceId: string;
  readonly institution: string;
  readonly dataset: string;
  readonly authorizedIdentity: string;
  readonly parserVersion: string;
  readonly status: "UNAPPROVED" | "APPROVED" | "REVOKED";
}
export type Stage = "ACQUIRED" | "VALIDATED" | "APPROVED" | "PUBLISHED";
export interface Review {
  readonly stage: Stage;
  readonly at: string;
  readonly actorId: string;
  readonly evidence: string;
  readonly human: boolean;
}
export interface Version {
  readonly versionId: string;
  readonly sourceId: string;
  readonly acquiredAt: string;
  readonly publicationEvidence: { readonly publishedAt: string; readonly reference: string } | null;
  readonly documentReference: string;
  readonly contentHash: string;
  readonly parserVersion: string;
  readonly revision: string;
  readonly validationStatus: "PENDING" | "VALID" | "INVALID";
  readonly supersedesVersionId: string | null;
  readonly reviews: readonly Review[];
}
/** Trusted server-owned port. Implementations must bind attestations to the exact payload.
 * No production authority is installed by this foundation. Never implement from client flags. */
export interface SourceAuthority {
  verifySource(source: Source): boolean;
  verifyDocument(version: Version): boolean;
  verifyReview(version: Version, review: Review): boolean;
  verifyApplicability(componentId: string, evidence: string, version: Version): boolean;
  verifyNormalizedRecord(record: unknown, version: Version): boolean;
}
export const unavailableAuthority: SourceAuthority = Object.freeze({
  verifySource: () => false, verifyDocument: () => false,
  verifyReview: () => false, verifyApplicability: () => false,
  verifyNormalizedRecord: () => false,
});
export function parseSource(input: unknown): Source {
  const r = object(input, ["sourceId", "institution", "dataset", "authorizedIdentity", "parserVersion", "status"]);
  return immutable({ sourceId: text(r.sourceId), institution: text(r.institution), dataset: text(r.dataset),
    authorizedIdentity: text(r.authorizedIdentity), parserVersion: text(r.parserVersion),
    status: choice(r.status, ["UNAPPROVED", "APPROVED", "REVOKED"]) });
}
function parseReview(input: unknown): Review {
  const r = object(input, ["stage", "at", "actorId", "evidence", "human"]);
  if (typeof r.human !== "boolean") return fail("INVALID_INPUT");
  return { stage: choice(r.stage, ["ACQUIRED", "VALIDATED", "APPROVED", "PUBLISHED"]),
    at: timestamp(r.at), actorId: text(r.actorId), evidence: text(r.evidence), human: r.human };
}
export function parseVersion(input: unknown): Version {
  const r = object(input, ["versionId", "sourceId", "acquiredAt", "publicationEvidence", "documentReference",
    "contentHash", "parserVersion", "revision", "validationStatus", "supersedesVersionId", "reviews"]);
  const pub = r.publicationEvidence === null ? null : object(r.publicationEvidence, ["publishedAt", "reference"]);
  const v: Version = { versionId: text(r.versionId), sourceId: text(r.sourceId), acquiredAt: timestamp(r.acquiredAt),
    publicationEvidence: pub && { publishedAt: timestamp(pub.publishedAt), reference: text(pub.reference) },
    documentReference: text(r.documentReference), contentHash: hashText(r.contentHash), parserVersion: text(r.parserVersion),
    revision: text(r.revision), validationStatus: choice(r.validationStatus, ["PENDING", "VALID", "INVALID"]),
    supersedesVersionId: r.supersedesVersionId === null ? null : text(r.supersedesVersionId), reviews: list(r.reviews, parseReview) };
  const stages: readonly Stage[] = ["ACQUIRED", "VALIDATED", "APPROVED", "PUBLISHED"];
  if (!v.reviews.length || v.reviews.length > stages.length || v.supersedesVersionId === v.versionId) return fail("INVALID_TRANSITION");
  v.reviews.forEach((review, i) => {
    if (review.stage !== stages[i] || review.at < (i ? v.reviews[i - 1].at : v.acquiredAt)) fail("INVALID_TRANSITION");
    if (review.stage === "APPROVED" && !review.human) fail("APPROVAL_REQUIRED");
  });
  if ((v.reviews.length === 1 && v.validationStatus === "VALID") ||
      (v.reviews.length > 1 && v.validationStatus !== "VALID") ||
      (v.publicationEvidence && v.publicationEvidence.publishedAt > v.acquiredAt)) return fail("INVALID_INPUT");
  return immutable(v);
}
export function transition(input: Version, reviewInput: unknown, authority: SourceAuthority): Version {
  const v = parseVersion(input), review = parseReview(reviewInput);
  const next = parseVersion({ ...v, reviews: [...v.reviews, review],
    validationStatus: review.stage === "VALIDATED" ? "VALID" : v.validationStatus });
  if (!authority.verifyDocument(next) || !authority.verifyReview(next, review)) return fail("DOCUMENT_UNVERIFIED");
  return next;
}
export function usableVersion(v: Version, sources: readonly Source[], asOf: string, authority: SourceAuthority): void {
  const source = sources.find(s => s.sourceId === v.sourceId);
  if (!source) return fail("UNKNOWN_SOURCE");
  if (source.status !== "APPROVED" || !authority.verifySource(source)) return fail("SOURCE_UNAPPROVED");
  if (source.parserVersion !== v.parserVersion || !authority.verifyDocument(v)) return fail("DOCUMENT_UNVERIFIED");
  if (v.validationStatus !== "VALID" || v.reviews.at(-1)?.stage !== "PUBLISHED") return fail("VERSION_UNAPPROVED");
  if (v.reviews.some(r => !authority.verifyReview(v, r))) return fail("APPROVAL_REQUIRED");
  if (!v.publicationEvidence || v.publicationEvidence.publishedAt > asOf || v.acquiredAt > asOf ||
      v.reviews.some(r => r.at > asOf)) return fail("AS_OF_UNPROVEN");
}
