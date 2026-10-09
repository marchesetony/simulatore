import { createHash } from "node:crypto";
import { ZipPreflightError } from "./errors";
import type { ZipPreflightErrorCode } from "./errors";
import { ZIP_PREFLIGHT_LIMITS, ZIP_PREFLIGHT_VERSION } from "./limits";
import type { ZipPreflightOptions, ZipPreflightResult, ZipEntryEvidence } from "./preflight-types";
import { assertDisjoint, inspectZipStructure, prepareYauzlBuffer } from "./structure";
import type { CentralRecord, ZipStructure } from "./structure";
import * as yauzl from "yauzl";

const DATA_DESCRIPTOR = 0x08;
const ZIP64_EXTRA = 0x0001;
const SYMLINK_MODE = 0xa000;

function fail(code: ZipPreflightErrorCode, message?: string): never {
  throw new ZipPreflightError(code, message);
}
function crc32(bytes: Uint8Array, prior = 0): number {
  let crc = (prior ^ 0xffffffff) >>> 0;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function validateName(name: string, names: Set<string>): void {
  if (!name || name.length > ZIP_PREFLIGHT_LIMITS.maxPathLength || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) fail("INVALID_PATH");
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part.length === 0) || parts.length > ZIP_PREFLIGHT_LIMITS.maxPathDepth) fail("INVALID_PATH");
  if (names.has(name)) fail("DUPLICATE_ENTRY"); names.add(name);
}
function hasExtraField(raw: Buffer, wanted: number): boolean {
  for (let cursor = 0; cursor < raw.length;) {
    if (cursor + 4 > raw.length) fail("INVALID_ZIP");
    const size = raw.readUInt16LE(cursor + 2); const end = cursor + 4 + size;
    if (end > raw.length) fail("INVALID_ZIP");
    if (raw.readUInt16LE(cursor) === wanted) return true;
    cursor = end;
  }
  return false;
}
function validateEntryMetadata(entry: yauzl.Entry, names: Set<string>): void {
  validateName(entry.fileName, names);
  if (entry.isEncrypted()) fail("ENCRYPTED_ENTRY");
  if ((entry.externalFileAttributes >>> 16 & 0xf000) === SYMLINK_MODE) fail("SYMLINK_ENTRY");
  if (entry.extraFields.some((field) => field.id === ZIP64_EXTRA) || entry.versionNeededToExtract >= 45 || entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff) fail("ZIP64_UNSUPPORTED");
  if (entry.compressionMethod === 0 && !entry.isEncrypted() && entry.compressedSize !== entry.uncompressedSize) fail("LOCAL_HEADER_MISMATCH");
  if (entry.compressedSize > ZIP_PREFLIGHT_LIMITS.maxCompressedEntryBytes || entry.uncompressedSize > ZIP_PREFLIGHT_LIMITS.maxUncompressedEntryBytes) fail("ENTRY_TOO_LARGE");
  if (entry.compressedSize === 0 ? entry.uncompressedSize !== 0 : entry.uncompressedSize / entry.compressedSize > ZIP_PREFLIGHT_LIMITS.maxCompressionRatio) fail("COMPRESSION_RATIO_EXCEEDED");
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) fail("UNSUPPORTED_COMPRESSION");
}
async function validateLocalHeader(entry: yauzl.Entry, zip: yauzl.ZipFile, archive: Buffer, structure: ZipStructure, record: CentralRecord, regions: [number, number][]): Promise<void> {
  if (record.localHeaderOffset !== entry.relativeOffsetOfLocalHeader || record.compressedSize !== entry.compressedSize || record.uncompressedSize !== entry.uncompressedSize || record.crc32 !== entry.crc32) fail("LOCAL_HEADER_MISMATCH");
  const local = await zip.readLocalFileHeaderPromise(entry);
  if (hasExtraField(local.extraField, 0x0001)) fail("ZIP64_UNSUPPORTED");
  if (!local.fileName.equals(entry.fileNameRaw) || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag || local.compressionMethod !== entry.compressionMethod) fail("LOCAL_HEADER_MISMATCH");
  const descriptor = (entry.generalPurposeBitFlag & DATA_DESCRIPTOR) !== 0;
  if (!descriptor && (local.crc32 !== entry.crc32 || local.compressedSize !== entry.compressedSize || local.uncompressedSize !== entry.uncompressedSize)) fail("LOCAL_HEADER_MISMATCH");
  if (descriptor && local.crc32 !== 0 && (local.crc32 !== entry.crc32 || local.compressedSize !== entry.compressedSize || local.uncompressedSize !== entry.uncompressedSize)) fail("DATA_DESCRIPTOR_INVALID");
  const localEnd = entry.relativeOffsetOfLocalHeader + 30 + local.fileName.length + local.extraField.length;
  if (!Number.isSafeInteger(localEnd) || localEnd < entry.relativeOffsetOfLocalHeader || localEnd > structure.centralOffset) fail("INVALID_ZIP");
  const payloadEnd = localEnd + entry.compressedSize;
  if (!Number.isSafeInteger(payloadEnd) || payloadEnd < localEnd || payloadEnd > structure.centralOffset) fail("INVALID_ZIP");
  let descriptorEnd = payloadEnd;
  if (descriptor) {
    const candidates: number[] = [];
    if (payloadEnd + 12 <= structure.centralOffset && archive.readUInt32LE(payloadEnd) === entry.crc32 && archive.readUInt32LE(payloadEnd + 4) === entry.compressedSize && archive.readUInt32LE(payloadEnd + 8) === entry.uncompressedSize) candidates.push(payloadEnd + 12);
    if (payloadEnd + 16 <= structure.centralOffset && archive.readUInt32LE(payloadEnd) === 0x08074b50 && archive.readUInt32LE(payloadEnd + 4) === entry.crc32 && archive.readUInt32LE(payloadEnd + 8) === entry.compressedSize && archive.readUInt32LE(payloadEnd + 12) === entry.uncompressedSize) candidates.push(payloadEnd + 16);
    if (candidates.length !== 1) fail("DATA_DESCRIPTOR_INVALID");
    descriptorEnd = candidates[0];
  }
  regions.push([entry.relativeOffsetOfLocalHeader, localEnd], [localEnd, payloadEnd]);
  if (descriptor) regions.push([payloadEnd, descriptorEnd]);
  assertDisjoint([...regions, [structure.centralOffset, structure.centralEnd]]);
}
async function readEntry(entry: yauzl.Entry, zip: yauzl.ZipFile, archive: Buffer, structure: ZipStructure, record: CentralRecord, regions: [number, number][], total: { value: number }): Promise<ZipEntryEvidence> {
  await validateLocalHeader(entry, zip, archive, structure, record, regions);
  const stream = await zip.openReadStreamPromise(entry);
  let size = 0; let checksum = 0;
  try {
    for await (const chunk of stream) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
      size += bytes.byteLength; total.value += bytes.byteLength;
      if (size > ZIP_PREFLIGHT_LIMITS.maxUncompressedEntryBytes) { stream.destroy(); fail("ENTRY_TOO_LARGE"); }
      if (total.value > ZIP_PREFLIGHT_LIMITS.maxTotalUncompressedBytes) { stream.destroy(); fail("TOTAL_UNCOMPRESSED_TOO_LARGE"); }
      checksum = crc32(bytes, checksum);
    }
  } catch (error) {
    stream.destroy();
    if (error instanceof ZipPreflightError) throw error;
    if (error instanceof Error && /invalid|data error|distance|inflate/i.test(error.message)) fail("INVALID_DEFLATE", error.message);
    fail("TRUNCATED_ENTRY", error instanceof Error ? error.message : "entry stream failed");
  }
  if (size !== entry.uncompressedSize) fail("TRUNCATED_ENTRY");
  if (checksum !== entry.crc32) fail("CRC_MISMATCH");
  return { name: entry.fileName, compressedBytes: entry.compressedSize, uncompressedBytes: size, crc32: checksum.toString(16).padStart(8, "0"), compressionMethod: entry.compressionMethod, usesDataDescriptor: (entry.generalPurposeBitFlag & DATA_DESCRIPTOR) !== 0 };
}
export async function preflightZip(bytes: Uint8Array, options: ZipPreflightOptions = {}): Promise<ZipPreflightResult> {
  if (bytes.byteLength > ZIP_PREFLIGHT_LIMITS.maxArchiveBytes) fail("ARCHIVE_TOO_LARGE");
  const original = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const originalSha256 = createHash("sha256").update(original).digest("hex");
  if (options.sourceSha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.sourceSha256)) fail("INTEGRITY_ERROR");
  if (options.sourceSha256 !== undefined && options.sourceSha256 !== originalSha256) fail("INTEGRITY_ERROR");
  let zip: yauzl.ZipFile | undefined; const entries: ZipEntryEvidence[] = []; const total = { value: 0 }; const names = new Set<string>(); const regions: [number, number][] = [];
  try {
    const structure = inspectZipStructure(original, ZIP_PREFLIGHT_LIMITS.maxEntries);
    const parserBytes = prepareYauzlBuffer(original, structure);
    zip = await yauzl.fromBufferPromise(parserBytes, { lazyEntries: true, validateEntrySizes: false, strictFileNames: true, decodeStrings: true });
    parserBytes.set(original);
    for (;;) {
      const next = await new Promise<yauzl.Entry | undefined>((resolve, reject) => {
        const onEntry = (entry: yauzl.Entry) => { cleanup(); resolve(entry); };
        const onEnd = () => { cleanup(); resolve(undefined); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const cleanup = () => { zip?.removeListener("entry", onEntry); zip?.removeListener("end", onEnd); zip?.removeListener("error", onError); };
        zip!.once("entry", onEntry); zip!.once("end", onEnd); zip!.once("error", onError); zip!.readEntry();
      });
      if (!next) break;
      if (entries.length >= ZIP_PREFLIGHT_LIMITS.maxEntries) fail("TOO_MANY_ENTRIES");
      const record = structure.records[entries.length];
      if (!record) fail("INVALID_ZIP");
      validateEntryMetadata(next, names); entries.push(await readEntry(next, zip, original, structure, record, regions, total));
    }
    if (entries.length !== structure.records.length) fail("INVALID_ZIP");
  } catch (error) {
    if (error instanceof ZipPreflightError) throw error;
    if (error instanceof Error && /absolute path|invalid relative path|invalid characters in fileName/.test(error.message)) fail("INVALID_PATH", error.message);
    if (error instanceof Error && /multi-disk/.test(error.message)) fail("MULTI_VOLUME_UNSUPPORTED", error.message);
    if (error instanceof Error && /zip64/i.test(error.message)) fail("ZIP64_UNSUPPORTED", error.message);
    fail("INVALID_ZIP", error instanceof Error ? error.message : "invalid ZIP");
  } finally { zip?.close(); }
  return { status: "ZIP_PREFLIGHT_PASSED", preflightVersion: ZIP_PREFLIGHT_VERSION, originalSha256, sourceSha256Verified: options.sourceSha256 !== undefined, archiveBytes: original.byteLength, entryCount: entries.length, totalUncompressedBytes: total.value, entries, limits: ZIP_PREFLIGHT_LIMITS };
}
