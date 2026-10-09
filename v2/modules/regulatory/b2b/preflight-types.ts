import type { ZIP_PREFLIGHT_LIMITS } from "./limits";
import type { ZipPreflightErrorCode } from "./errors";

export interface ZipPreflightOptions {
  readonly sourceSha256?: string;
}
export interface ZipEntryEvidence {
  readonly name: string;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly crc32: string;
  readonly compressionMethod: number;
  readonly usesDataDescriptor: boolean;
}
export interface ZipPreflightResult {
  readonly status: "ZIP_PREFLIGHT_PASSED";
  readonly preflightVersion: string;
  readonly originalSha256: string;
  readonly sourceSha256Verified: boolean;
  readonly archiveBytes: number;
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
  readonly entries: readonly ZipEntryEvidence[];
  readonly limits: typeof ZIP_PREFLIGHT_LIMITS;
}
export interface ZipPreflightFailure {
  readonly code: ZipPreflightErrorCode;
}
