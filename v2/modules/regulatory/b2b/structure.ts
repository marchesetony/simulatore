import { ZipPreflightError } from "./errors";

export interface CentralRecord {
  readonly offset: number;
  readonly nextOffset: number;
  readonly localHeaderOffset: number;
  readonly fileNameRaw: Buffer;
  readonly flags: number;
  readonly method: number;
  readonly diskStart: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly versionNeeded: number;
}
export interface ZipStructure {
  readonly centralOffset: number;
  readonly centralEnd: number;
  readonly eocdOffset: number;
  readonly records: readonly CentralRecord[];
}
function fail(message: string): never { throw new ZipPreflightError("INVALID_ZIP", message); }
function add(a: number, b: number, limit: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a > limit - b) fail("ZIP interval overflow");
  return a + b;
}
function findEocdCandidates(bytes: Buffer): number[] {
  const candidates: number[] = [];
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 0xffff - 22); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) candidates.push(i);
  return candidates;
}
function parseCentral(bytes: Buffer, start: number, size: number, count: number): CentralRecord[] {
  const end = add(start, size, bytes.length); const records: CentralRecord[] = []; let cursor = start;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail("central directory record is invalid");
    const nameLength = bytes.readUInt16LE(cursor + 28); const extraLength = bytes.readUInt16LE(cursor + 30); const commentLength = bytes.readUInt16LE(cursor + 32);
    const next = add(add(add(cursor, 46, end), nameLength, end), extraLength + commentLength, end);
    const nameEnd = cursor + 46 + nameLength;
    records.push({ offset: cursor, nextOffset: next, localHeaderOffset: bytes.readUInt32LE(cursor + 42), fileNameRaw: bytes.subarray(cursor + 46, nameEnd), flags: bytes.readUInt16LE(cursor + 8), method: bytes.readUInt16LE(cursor + 10), crc32: bytes.readUInt32LE(cursor + 16), compressedSize: bytes.readUInt32LE(cursor + 20), uncompressedSize: bytes.readUInt32LE(cursor + 24), versionNeeded: bytes.readUInt16LE(cursor + 6), diskStart: bytes.readUInt16LE(cursor + 34) });
    cursor = next;
  }
  if (cursor !== end) fail("central directory size does not match records");
  return records;
}
function parseCandidate(bytes: Buffer, eocdOffset: number, maxEntries: number): ZipStructure {
  const disk = bytes.readUInt16LE(eocdOffset + 4); const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const diskCount = bytes.readUInt16LE(eocdOffset + 8); const entryCount = bytes.readUInt16LE(eocdOffset + 10); const centralSize = bytes.readUInt32LE(eocdOffset + 12); const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || diskCount !== entryCount) throw new ZipPreflightError("MULTI_VOLUME_UNSUPPORTED");
  if (entryCount > maxEntries) throw new ZipPreflightError("TOO_MANY_ENTRIES");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new ZipPreflightError("ZIP64_UNSUPPORTED");
  const centralEnd = add(centralOffset, centralSize, bytes.length);
  if (centralEnd !== eocdOffset) fail("unclassified bytes between central directory and EOCD");
  const records = parseCentral(bytes, centralOffset, centralSize, entryCount);
  const regions: [number, number][] = [[centralOffset, centralEnd]];
  for (const record of records) {
    if (record.diskStart !== 0) throw new ZipPreflightError("MULTI_VOLUME_UNSUPPORTED");
    if (record.localHeaderOffset + 30 > centralOffset || bytes.readUInt32LE(record.localHeaderOffset) !== 0x04034b50) fail("local header is invalid");
    const nameLength = bytes.readUInt16LE(record.localHeaderOffset + 26); const extraLength = bytes.readUInt16LE(record.localHeaderOffset + 28);
    const localEnd = add(add(record.localHeaderOffset, 30, centralOffset), nameLength + extraLength, centralOffset);
    const payloadEnd = add(localEnd, record.compressedSize, centralOffset);
    regions.push([record.localHeaderOffset, localEnd], [localEnd, payloadEnd]);
  }
  assertDisjoint(regions);
  return { centralOffset, centralEnd, eocdOffset, records };
}
export function inspectZipStructure(bytes: Buffer, maxEntries: number): ZipStructure {
  if (bytes.length < 22) fail("archive is shorter than EOCD");
  const candidates = findEocdCandidates(bytes); if (candidates.length === 0) fail("EOCD not found or comment length is invalid");
  const valid: ZipStructure[] = []; const failures: ZipPreflightError[] = [];
  for (const candidate of candidates) { try { valid.push(parseCandidate(bytes, candidate, maxEntries)); } catch (error) { if (error instanceof ZipPreflightError) failures.push(error); } }
  if (valid.length > 1) fail("multiple structurally valid EOCD records");
  if (valid.length === 1) return valid[0];
  if (failures.length > 0) throw failures[failures.length - 1];
  fail("no structurally valid EOCD record");
}
export function assertDisjoint(intervals: readonly [number, number][]): void {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] < sorted[i - 1][1]) fail("ZIP regions overlap");
}
export function prepareYauzlBuffer(bytes: Buffer, structure: ZipStructure): Buffer {
  const copy = Buffer.from(bytes); const start = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = start; i <= bytes.length - 22; i++) if (copy.readUInt32LE(i) === 0x06054b50 && i !== structure.eocdOffset) copy.writeUInt32LE(0, i);
  return copy;
}
