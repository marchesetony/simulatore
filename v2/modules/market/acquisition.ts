import { fail } from "./errors";
import { immutable } from "./integrity";
import { list, object, text } from "./primitives";
import { date, timestamp } from "./temporal";
import { parseVersion, type Version } from "./governance";

export const acquisitionPolicy = Object.freeze({ daysOfMonth: Object.freeze([1, 16]), timezone: "Europe/Rome" });
interface AttemptBase {
  readonly attemptId: string; readonly sourceId: string;
  /** Rome calendar control date, not an economic validity date. No execution hour implied. */
  readonly scheduledFor: string; readonly startedAt: string; readonly finishedAt: string;
}
export type AcquisitionAttempt = AttemptBase & (
  | { readonly outcome: "NEW_DATA_AVAILABLE" | "NO_NEW_DATA"; readonly errorCode: null; readonly publishedVersionId: null; readonly publicationEventId: null }
  | { readonly outcome: "ERROR" | "INVALID_DATA"; readonly errorCode: string; readonly publishedVersionId: null; readonly publicationEventId: null }
  | { readonly outcome: "PUBLISHED"; readonly errorCode: null; readonly publishedVersionId: string; readonly publicationEventId: string }
);
export interface PublicationEvent {
  readonly eventId: string; readonly attemptId: string; readonly sourceId: string;
  readonly versionId: string; readonly snapshotId: string; readonly publishedAt: string;
}
export function parsePublicationEvent(input: unknown): PublicationEvent {
  const r = object(input, ["eventId", "attemptId", "sourceId", "versionId", "snapshotId", "publishedAt"]);
  return immutable({ eventId: text(r.eventId), attemptId: text(r.attemptId), sourceId: text(r.sourceId),
    versionId: text(r.versionId), snapshotId: text(r.snapshotId), publishedAt: timestamp(r.publishedAt) });
}
export function parseAcquisitionAttempt(input: unknown): AcquisitionAttempt {
  const r = object(input, ["attemptId", "sourceId", "scheduledFor", "startedAt", "finishedAt", "outcome", "errorCode", "publishedVersionId", "publicationEventId"]);
  const base = { attemptId: text(r.attemptId), sourceId: text(r.sourceId), scheduledFor: date(r.scheduledFor),
    startedAt: timestamp(r.startedAt), finishedAt: timestamp(r.finishedAt) };
  if (!["01", "16"].includes(base.scheduledFor.slice(-2)) || base.finishedAt < base.startedAt) return fail("INVALID_INPUT");
  if ((r.outcome === "NEW_DATA_AVAILABLE" || r.outcome === "NO_NEW_DATA") && r.errorCode === null && r.publishedVersionId === null && r.publicationEventId === null)
    return immutable({ ...base, outcome: r.outcome, errorCode: null, publishedVersionId: null, publicationEventId: null });
  if ((r.outcome === "ERROR" || r.outcome === "INVALID_DATA") && r.publishedVersionId === null && r.publicationEventId === null)
    return immutable({ ...base, outcome: r.outcome, errorCode: text(r.errorCode), publishedVersionId: null, publicationEventId: null });
  if (r.outcome === "PUBLISHED" && r.errorCode === null)
    return immutable({ ...base, outcome: r.outcome, errorCode: null, publishedVersionId: text(r.publishedVersionId), publicationEventId: text(r.publicationEventId) });
  return fail("INVALID_INPUT");
}
/** Adapter must also prove that event, attempt and new snapshot are committed together. */
export function validatePublication(eventInput: PublicationEvent, attemptInput: AcquisitionAttempt,
  snapshot: { readonly snapshotId: string; readonly createdAt: string; readonly selectionPolicy: { readonly versionIds: readonly string[] }; readonly versions: readonly Version[] }): void {
  const event = parsePublicationEvent(eventInput), attempt = parseAcquisitionAttempt(attemptInput);
  const version = list(snapshot.versions, parseVersion).find(v => v.versionId === event.versionId);
  const selectedIds = list(snapshot.selectionPolicy.versionIds, text);
  if (!version) return fail("VERSION_NOT_FOUND");
  if (version.validationStatus !== "VALID" || version.reviews.at(-1)?.stage !== "PUBLISHED") return fail("VERSION_UNAPPROVED");
  if (attempt.outcome !== "PUBLISHED" || attempt.publicationEventId !== event.eventId || attempt.attemptId !== event.attemptId ||
      attempt.sourceId !== event.sourceId || version.sourceId !== event.sourceId || attempt.publishedVersionId !== event.versionId ||
      snapshot.snapshotId !== event.snapshotId || !selectedIds.includes(event.versionId)) return fail("INVALID_PUBLICATION");
  if (event.publishedAt < attempt.startedAt || event.publishedAt > attempt.finishedAt || event.publishedAt < timestamp(snapshot.createdAt) ||
      event.publishedAt < version.acquiredAt || version.reviews.some(r => r.at > event.publishedAt)) return fail("INVALID_PUBLICATION");
}
