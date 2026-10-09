export type FoundationErrorCode = "INVALID_INPUT" | "UNKNOWN_SOURCE" | "SOURCE_UNAPPROVED" |
  "DOCUMENT_UNVERIFIED" | "VERSION_NOT_FOUND" | "VERSION_UNAPPROVED" | "INVALID_TRANSITION" |
  "APPROVAL_REQUIRED" | "AS_OF_UNPROVEN" | "INCOMPATIBLE_VERSION" | "MISSING_VALUE" |
  "GAP" | "OVERLAP" | "DUPLICATE_IDENTITY" | "PARTIAL_PUBLICATION" | "HASH_MISMATCH" |
  "IMMUTABLE_CONFLICT" | "CONCURRENCY_CONFLICT" | "UNAVAILABLE" | "SNAPSHOT_UNVERIFIED" |
  "UNRESOLVED_RELATION" | "INVALID_PUBLICATION";
export class FoundationError extends Error {
  readonly code: FoundationErrorCode;
  constructor(code: FoundationErrorCode) { super(code); this.name = "FoundationError"; this.code = code; }
}
export function fail(code: FoundationErrorCode): never { throw new FoundationError(code); }
