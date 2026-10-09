/** Transport evidence only: deliberately distinct from reviewed economic Versions. */
export interface AreraAcquisitionEvidence {
  readonly authority: "ARERA";
  readonly actReference: "573/2025/R/eel";
  readonly documentUrl: string;
  /** Completion time, never publication or approval time. */
  readonly retrievedAt: string;
  readonly httpStatus: 200;
  readonly contentType: string;
  readonly contentLengthReceived: number;
  readonly sha256: string;
  readonly acquisitionStatus: "B2A_CHECKS_PASSED";
}
export interface AreraAcquisitionResult {
  readonly evidence: AreraAcquisitionEvidence;
  /** Original bytes in memory; mutable and NOT immutable persistent custody. */
  readonly bytes: Uint8Array;
}
export interface AreraAcquisitionOptions {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  /** Optional independently obtained digest; never inferred from the downloaded bytes. */
  readonly expectedSha256?: string;
}
export type AreraAcquisitionErrorCode = "UNTRUSTED_SOURCE" | "NETWORK_ERROR" | "REQUEST_TIMEOUT" |
  "UNEXPECTED_REDIRECT" | "HTTP_ERROR" | "INVALID_CONTENT_TYPE" | "DOCUMENT_TOO_LARGE" |
  "EMPTY_DOCUMENT" | "INVALID_FILE_SIGNATURE" | "INCOMPLETE_DOWNLOAD" | "INTEGRITY_ERROR" |
  "INVALID_CONFIGURATION";
export class AreraAcquisitionError extends Error {
  readonly code: AreraAcquisitionErrorCode;
  constructor(code: AreraAcquisitionErrorCode) {
    super(code); this.name = "AreraAcquisitionError"; this.code = code;
  }
}
