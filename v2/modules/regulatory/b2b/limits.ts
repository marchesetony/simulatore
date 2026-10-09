export const ZIP_PREFLIGHT_LIMITS = Object.freeze({
  maxArchiveBytes: 32 * 1024 * 1024,
  maxEntries: 256,
  maxCompressedEntryBytes: 8 * 1024 * 1024,
  maxUncompressedEntryBytes: 16 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxPathLength: 256,
  maxPathDepth: 16,
});

export const ZIP_PREFLIGHT_VERSION = "B2B1-1";
