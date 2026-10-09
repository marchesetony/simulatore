import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { preflightZip } from "../modules/regulatory/b2b/preflight.ts";
import { ZipPreflightError } from "../modules/regulatory/b2b/errors.ts";
import { ZIP_PREFLIGHT_LIMITS } from "../modules/regulatory/b2b/limits.ts";

const u16 = (n) => Buffer.from([n & 255, n >>> 8 & 255]);
const u32 = (n) => Buffer.from([n >>> 0 & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); return c >>> 0; });
const crc32 = (data) => { let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
const patterned = (size) => { const seed = Buffer.alloc(1024 * 1024); for (let i = 0; i < seed.length; i++) seed[i] = (i * 31 + i / 257 | 0) & 255; return Buffer.concat(Array.from({ length: Math.ceil(size / seed.length) }, () => seed)).subarray(0, size); };
function entryBytes(spec) {
  const name = Buffer.from(spec.name ?? "xl/a.xml"); const plain = Buffer.isBuffer(spec.data) ? spec.data : Buffer.from(spec.data ?? "");
  const method = spec.method ?? 0; const compressed = method === 8 ? deflateRawSync(plain) : plain;
  const flags = spec.flags ?? 0; const crc = spec.crc ?? crc32(plain); const localCrc = spec.descriptor ? 0 : (spec.localCrc ?? crc);
  const localSize = spec.descriptor ? 0 : (spec.localSize ?? compressed.length); const localPlainSize = spec.descriptor ? 0 : (spec.localPlainSize ?? plain.length);
  const extra = spec.zip64 ? Buffer.from([1, 0, 4, 0, 0, 0, 0, 0]) : Buffer.alloc(0);
  const local = Buffer.concat([u32(0x04034b50), u16(spec.zip64 ? 45 : 20), u16(flags | (spec.descriptor ? 8 : 0)), u16(method), u16(0), u16(0), u32(localCrc), u32(localSize), u32(localPlainSize), u16(name.length), u16(extra.length), name, extra]);
  const descriptor = spec.descriptor ? Buffer.concat([spec.descriptorSignature === false ? Buffer.alloc(0) : u32(0x08074b50), u32(crc), u32(compressed.length), u32(plain.length)]) : Buffer.alloc(0);
  const central = (offset) => Buffer.concat([u32(0x02014b50), u16(spec.symlink ? 0x031e : 20), u16(spec.zip64 ? 45 : 20), u16(flags | (spec.descriptor ? 8 : 0)), u16(method), u16(0), u16(0), u32(crc), u32(compressed.length), u32(plain.length), u16(name.length), u16(extra.length), u16(0), u16(0), u16(0), u32(spec.symlink ? 0xa0000000 : 0), u32(offset), name, extra]);
  return { local: Buffer.concat([local, compressed, descriptor]), central, plain, compressed };
}
function zip(specs, options = {}) {
  const locals = []; const centrals = []; let offset = 0;
  for (const spec of specs) { const e = entryBytes(spec); locals.push(e.local); centrals.push(e.central(offset)); offset += e.local.length; }
  const central = Buffer.concat(centrals); const comment = Buffer.from(options.comment ?? ""); const eocd = Buffer.concat([u32(0x06054b50), u16(options.disk ?? 0), u16(0), u16(specs.length), u16(specs.length), u32(central.length), u32(offset), u16(comment.length), comment]);
  return Buffer.concat([...locals, central, eocd]);
}
const errorCode = async (bytes, options) => { try { await preflightZip(bytes, options); assert.fail("expected failure"); } catch (error) { assert.ok(error instanceof ZipPreflightError); return error.code; } };
const empty = zip([]);
const centralOffset = (bytes) => bytes.readUInt32LE(bytes.length - 22 + 16);
const firstPayloadOffset = (bytes) => { const central = centralOffset(bytes); const local = bytes.readUInt32LE(central + 42); return local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28); };
const centralRecordOffset = (bytes, index) => { let cursor = centralOffset(bytes); for (let i = 0; i < index; i++) cursor += 46 + bytes.readUInt16LE(cursor + 28) + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32); return cursor; };
const centralField = (bytes, record, offset, value) => { const copy = Buffer.from(bytes); copy.writeUInt32LE(value >>> 0, centralRecordOffset(copy, record) + offset); return copy; };

test("valid minimal ZIP and empty entry pass with original hash", async () => {
  const bytes = zip([{ name: "xl/workbook.xml", data: "<x/>" }, { name: "xl/empty", data: "" }]);
  const result = await preflightZip(bytes, { sourceSha256: createHash("sha256").update(bytes).digest("hex") });
  assert.equal(result.status, "ZIP_PREFLIGHT_PASSED"); assert.equal(result.entryCount, 2); assert.equal(result.sourceSha256Verified, true); assert.equal(result.totalUncompressedBytes, 4);
});
test("many entries within limit pass and entry limit fails", async () => { assert.equal((await preflightZip(zip(Array.from({ length: 256 }, (_, i) => ({ name: `e/${i}`, data: "" }))))).entryCount, 256); assert.equal(await errorCode(zip(Array.from({ length: 257 }, (_, i) => ({ name: `e/${i}`, data: "" })))), "TOO_MANY_ENTRIES"); });
test("archive, compressed, uncompressed and total limits fail closed", async () => {
  assert.equal(await errorCode(Buffer.concat([empty, Buffer.alloc(ZIP_PREFLIGHT_LIMITS.maxArchiveBytes)])), "ARCHIVE_TOO_LARGE");
  assert.equal(await errorCode(zip([{ name: "big", data: Buffer.alloc(8 * 1024 * 1024 + 1) }])), "ENTRY_TOO_LARGE");
  assert.equal(await errorCode(zip([{ name: "big", data: Buffer.alloc(16 * 1024 * 1024 + 1) }])), "ENTRY_TOO_LARGE");
  assert.equal(await errorCode(zip(Array.from({ length: 5 }, (_, i) => ({ name: `big${i}`, data: patterned(13 * 1024 * 1024), method: 8 })))), "TOTAL_UNCOMPRESSED_TOO_LARGE");
});
test("ratio, bomb-like deflate and malformed compression fail", async () => { assert.equal(await errorCode(zip([{ name: "ratio", data: Buffer.alloc(10001, 65), method: 8 }])), "COMPRESSION_RATIO_EXCEEDED"); assert.equal(await errorCode(zip([{ name: "bad", data: Buffer.from("hello"), method: 8, crc: 0 }])), "CRC_MISMATCH"); });
test("paths, duplicates and symlink are rejected", async () => {
  for (const name of ["../x", "/x", "C:/x", "a\\b", "a//b", "a/" + "x/".repeat(16) + "z", "x".repeat(257)]) assert.equal(await errorCode(zip([{ name, data: "x" }])), "INVALID_PATH");
  assert.equal(await errorCode(zip([{ name: "same", data: "a" }, { name: "same", data: "b" }])), "DUPLICATE_ENTRY");
  assert.equal(await errorCode(zip([{ name: "link", data: "x", symlink: true }])), "SYMLINK_ENTRY");
});
test("encrypted, ZIP64 and multi-volume archives are rejected", async () => { assert.equal(await errorCode(zip([{ name: "secret", data: "x", flags: 1 }])), "ENCRYPTED_ENTRY"); assert.equal(await errorCode(zip([{ name: "zip64", data: "x", zip64: true }])), "ZIP64_UNSUPPORTED"); assert.equal(await errorCode(zip([{ name: "x", data: "x" }], { disk: 1 })), "MULTI_VOLUME_UNSUPPORTED"); });
test("CRC, truncation, deflate and header discrepancies fail", async () => {
  const badCrc = zip([{ name: "x", data: "x", crc: 1 }]); assert.equal(await errorCode(badCrc), "CRC_MISMATCH");
  assert.equal(await errorCode(badCrc.subarray(0, badCrc.length - 3)), "INVALID_ZIP");
  const malformed = zip([{ name: "x", data: "hello", method: 8 }]); malformed[40] ^= 1; assert.ok(["INVALID_ZIP", "INVALID_DEFLATE", "TRUNCATED_ENTRY", "CRC_MISMATCH"].includes(await errorCode(malformed)));
  assert.equal(await errorCode(zip([{ name: "x", data: "x", localSize: 9 }])), "LOCAL_HEADER_MISMATCH");
});
test("data descriptor with zero local sizes is accepted", async () => { const result = await preflightZip(zip([{ name: "dd", data: "descriptor", descriptor: true }])); assert.equal(result.entries[0].usesDataDescriptor, true); });
test("malformed data descriptor is rejected", async () => { const bytes = zip([{ name: "dd", data: "descriptor", descriptor: true }]); const marker = bytes.indexOf(Buffer.from("descriptor")); bytes[marker + 12] ^= 1; assert.equal(await errorCode(bytes), "DATA_DESCRIPTOR_INVALID"); });
test("descriptor without signature is accepted when CRC equals the signature value", async () => { const result = await preflightZip(zip([{ name: "crc-signature", data: Buffer.from("ac0a7ad5", "hex"), descriptor: true, descriptorSignature: false }])); assert.equal(result.entryCount, 1); });
// Both forms would require CRC, compressed size and uncompressed size to equal 0x08074b50; that exceeds B2b.1 limits, so the true simultaneous case is impossible here.
test("descriptor alternate interpretation is rejected when incoherent", async () => { const bytes = zip([{ name: "ambiguous", data: "x", descriptor: true, descriptorSignature: false }]); const marker = bytes.indexOf(Buffer.from("x")); bytes.writeUInt32LE(0x08074b50, marker + 1); assert.equal(await errorCode(bytes), "DATA_DESCRIPTOR_INVALID"); });
// With centralEnd === eocdOffset, two EOCD records cannot both be structurally valid: the earlier one necessarily has a gap.
test("EOCD signatures in comments are ignored unless structurally valid", async () => { const fake = Buffer.alloc(22); fake.writeUInt32LE(0x06054b50, 0); const result = await preflightZip(zip([{ name: "x", data: "x" }], { comment: fake })); assert.equal(result.entryCount, 1); });
test("unclassified central-directory gap is rejected", async () => { const bytes = zip([{ name: "x", data: "x" }]); const eocd = bytes.length - 22; const withGap = Buffer.concat([bytes.subarray(0, eocd), Buffer.from([1, 2, 3]), bytes.subarray(eocd)]); assert.equal(await errorCode(withGap), "INVALID_ZIP"); });
test("truncated and incompatible EOCD are typed", async () => { assert.equal(await errorCode(Buffer.from([0x50, 0x4b, 0x05])), "INVALID_ZIP"); const bytes = zip([{ name: "x", data: "x" }]); bytes.writeUInt32LE(0xfffffff0, bytes.length - 22 + 16); assert.equal(await errorCode(bytes), "INVALID_ZIP"); });
test("overlapping and out-of-bounds ZIP regions are rejected", async () => {
  const two = zip([{ name: "a", data: "first" }, { name: "b", data: "second" }]);
  assert.equal(await errorCode(centralField(two, 1, 42, two.readUInt32LE(centralOffset(two) + 42))), "INVALID_ZIP");
  assert.equal(await errorCode(centralField(two, 1, 42, firstPayloadOffset(two))), "INVALID_ZIP");
  const descriptor = zip([{ name: "a", data: "first", descriptor: true }, { name: "b", data: "second" }]);
  assert.equal(await errorCode(centralField(descriptor, 1, 42, firstPayloadOffset(descriptor) + 8)), "INVALID_ZIP");
  assert.equal(await errorCode(centralField(two, 0, 20, 0xfffffff0)), "INVALID_ZIP");
  assert.equal(await errorCode(centralField(two, 0, 42, two.length + 1)), "INVALID_ZIP");
});
test("invalid deflate has a specific error", async () => { const bytes = zip([{ name: "deflate", data: "payload", method: 8 }]); bytes[firstPayloadOffset(bytes)] ^= 0xff; assert.equal(await errorCode(bytes), "INVALID_DEFLATE"); });
test("failure in a later entry never returns a partial result", async () => { const bytes = zip([{ name: "first", data: "ok" }, { name: "second", data: "bad", crc: 1 }]); await assert.rejects(() => preflightZip(bytes), (error) => error instanceof ZipPreflightError && error.code === "CRC_MISMATCH"); });
test("error cleanup settles and does not leave an unhandled rejection", async () => { const bytes = zip([{ name: "too-large", data: Buffer.alloc(16 * 1024 * 1024 + 1) }]); let unhandled = false; const handler = () => { unhandled = true; }; process.once("unhandledRejection", handler); await assert.rejects(() => preflightZip(bytes), ZipPreflightError); await new Promise((resolve) => setImmediate(resolve)); process.removeListener("unhandledRejection", handler); assert.equal(unhandled, false); });
test("streaming limit cleanup settles after decompression abort", async () => { const bytes = zip(Array.from({ length: 5 }, (_, i) => ({ name: `stream${i}`, data: patterned(13 * 1024 * 1024), method: 8 }))); let unhandled = false; const handler = () => { unhandled = true; }; process.once("unhandledRejection", handler); await assert.rejects(() => preflightZip(bytes), (error) => error instanceof ZipPreflightError && error.code === "TOTAL_UNCOMPRESSED_TOO_LARGE"); await new Promise((resolve) => setImmediate(resolve)); process.removeListener("unhandledRejection", handler); assert.equal(unhandled, false); });
test("source hash mismatch and invalid signature are typed; no partial result", async () => { assert.equal(await errorCode(zip([{ name: "x", data: "x" }]), { sourceSha256: "0".repeat(64) }), "INTEGRITY_ERROR"); assert.equal(await errorCode(Buffer.from("not zip")), "INVALID_ZIP"); await assert.rejects(() => preflightZip(Buffer.from("not zip")), (error) => error instanceof ZipPreflightError && error.code === "INVALID_ZIP"); });
