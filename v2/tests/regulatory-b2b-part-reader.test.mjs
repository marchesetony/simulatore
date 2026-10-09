import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { ZipPreflightError } from "../modules/regulatory/b2b/errors.ts";
import { preflightZip } from "../modules/regulatory/b2b/preflight.ts";
import { readBoundedPart } from "../modules/regulatory/b2b/part-reader.ts";

const u16 = (n) => Buffer.from([n & 255, n >>> 8 & 255]);
const u32 = (n) => Buffer.from([n >>> 0 & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]);
const crc32 = (data) => { let c = 0xffffffff; for (const byte of data) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
function zip(name, value, options = {}) {
  const fileName = Buffer.from(name); const plain = Buffer.from(value); const method = options.method ?? 0; const data = method === 8 ? deflateRawSync(plain) : plain; const crc = options.crc ?? crc32(plain);
  const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(data.length), u32(plain.length), u16(fileName.length), u16(0), fileName, data]);
  const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(data.length), u32(plain.length), u16(fileName.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), fileName]);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0)]);
  return Buffer.concat([local, central, eocd]);
}
async function prepared(bytes) { const preflight = await preflightZip(bytes); return { archive: bytes, preflight, partName: "xl/workbook.xml" }; }
async function code(promise) { try { await promise; assert.fail("expected failure"); } catch (error) { assert.ok(error instanceof ZipPreflightError); return error.code; } }

test("reads a validated part and returns complete bytes", async () => {
  const bytes = zip("xl/workbook.xml", "<workbook/>", { method: 8 }); const result = await readBoundedPart(await prepared(bytes));
  assert.equal(result.partName, "xl/workbook.xml"); assert.deepEqual(result.bytes, Buffer.from("<workbook/>")); assert.equal(result.byteLength, 11);
});
test("rejects a missing or ambiguous part name", async () => {
  const request = await prepared(zip("xl/workbook.xml", "x"));
  assert.equal(await code(readBoundedPart({ ...request, partName: "xl/missing.xml" })), "PART_NOT_FOUND");
  assert.equal(await code(readBoundedPart({ ...request, partName: "xl//workbook.xml" })), "PART_NAME_INVALID");
});
test("rejects an invalid archive before opening a part", async () => {
  const archive = Buffer.from("not zip"); const originalSha256 = createHash("sha256").update(archive).digest("hex");
  const preflight = { status: "ZIP_PREFLIGHT_PASSED", archiveBytes: archive.length, originalSha256, entries: [{ name: "xl/workbook.xml" }], preflightVersion: "test" };
  assert.equal(await code(readBoundedPart({ archive, preflight, partName: "xl/workbook.xml" })), "INVALID_ZIP");
});
test("rejects a part limit before returning bytes", async () => {
  const request = await prepared(zip("xl/workbook.xml", "abcdef"));
  assert.equal(await code(readBoundedPart({ ...request, maxBytes: 3 })), "PART_TOO_LARGE");
});
test("rejects CRC failures and returns no partial buffer", async () => {
  const bytes = zip("xl/workbook.xml", "abcdef", { crc: 1 });
  assert.equal(await code(preflightZip(bytes)), "CRC_MISMATCH");
});
test("rejects forged preflight evidence even when the SHA is correct", async () => {
  const archive = zip("xl/workbook.xml", "abcdef", { crc: 1 }); const originalSha256 = createHash("sha256").update(archive).digest("hex");
  const preflight = { status: "ZIP_PREFLIGHT_PASSED", archiveBytes: archive.length, originalSha256, entries: [{ name: "xl/workbook.xml", crc32: "00000000" }], preflightVersion: "forged" };
  assert.equal(await code(readBoundedPart({ archive, preflight, partName: "xl/workbook.xml" })), "CRC_MISMATCH");
});
test("binds the requested archive to the preflight hash", async () => {
  const first = await prepared(zip("xl/workbook.xml", "first")); const second = zip("xl/workbook.xml", "second");
  assert.equal(await code(readBoundedPart({ ...first, archive: second })), "INTEGRITY_ERROR");
});
test("rejects malformed deflate during the shared preflight", async () => {
  const bytes = zip("xl/workbook.xml", "abcdef", { method: 8 }); const nameLength = bytes.readUInt16LE(26); const offset = 30 + nameLength; bytes[offset] ^= 0xff;
  assert.equal(await code(preflightZip(bytes)), "INVALID_DEFLATE");
});
test("does not expose partial success after a read failure", async () => {
  const request = await prepared(zip("xl/workbook.xml", "complete"));
  await assert.rejects(() => readBoundedPart({ ...request, maxBytes: 2 }), (error) => error instanceof ZipPreflightError && error.code === "PART_TOO_LARGE");
});
test("rejects numerically invalid part limits", async () => {
  const request = await prepared(zip("xl/workbook.xml", "ok"));
  for (const maxBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) assert.equal(await code(readBoundedPart({ ...request, maxBytes })), "PART_TOO_LARGE");
});
