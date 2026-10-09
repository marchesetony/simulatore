export type ZipPreflightErrorCode =
  | "ARCHIVE_TOO_LARGE" | "INVALID_ZIP" | "TOO_MANY_ENTRIES" | "ENTRY_TOO_LARGE"
  | "TOTAL_UNCOMPRESSED_TOO_LARGE" | "COMPRESSION_RATIO_EXCEEDED" | "INVALID_PATH"
  | "DUPLICATE_ENTRY" | "SYMLINK_ENTRY" | "ENCRYPTED_ENTRY" | "ZIP64_UNSUPPORTED"
  | "MULTI_VOLUME_UNSUPPORTED" | "LOCAL_HEADER_MISMATCH" | "DATA_DESCRIPTOR_INVALID"
  | "CRC_MISMATCH" | "TRUNCATED_ENTRY" | "INVALID_DEFLATE" | "UNSUPPORTED_COMPRESSION"
  | "INTEGRITY_ERROR" | "PREFLIGHT_ERROR" | "PART_NOT_FOUND"
  | "PART_NAME_INVALID" | "PART_TOO_LARGE" | "PART_READ_ERROR";

export class ZipPreflightError extends Error {
  readonly code: ZipPreflightErrorCode;
  constructor(code: ZipPreflightErrorCode, message: string = code) {
    super(message); this.name = "ZipPreflightError"; this.code = code;
  }
}
