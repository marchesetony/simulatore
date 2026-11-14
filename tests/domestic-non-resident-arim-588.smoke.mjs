import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { parseArera588DomesticNonResidentArimXlsx } from "../app/lib/foundation/arera-electricity-regulatory.ts";

// Tony (30/10, "ancora errori"): the refresh still failed on ARIM|DOMESTIC_NON_RESIDENT_BT|EUR/POD/YEAR. The 588 Tabella B
// row "non residenti" must give both quota fissa and quota energia; a row whose quota fissa column is empty (a note, or a
// quota without aliquota) never hides the row that carries it, and an empty column alone is archived as 0.
// Synthetic workbook, invented values.
function zip(entries) {
  const files = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name); const data = Buffer.from(text); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(nameBytes.length, 28); header.writeUInt32LE(offset, 42);
    files.push(local, nameBytes, data); central.push(header, nameBytes); offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...files, directory, end]));
}
const cell = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const num = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const workbook = (rows) => zip({ "xl/sharedStrings.xml": "<sst></sst>", "xl/worksheets/sheet6.xml": `<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>` });
const parse = (body) => parseArera588DomesticNonResidentArimXlsx({ body, retrievedAt: "2026-10-30T00:00:00.000Z" }).map((record) => [record.normalizedUnit, record.normalizedValue]);
assert.deepEqual(parse(workbook([
  `<row r="9">${cell("B9", "Utenze domestiche non residenti (nota)")}${num("E9", "9")}</row>`,
  `<row r="10">${cell("B10", "Utenze domestiche non residenti")}${num("C10", "1200")}${num("E10", "2")}</row>`,
])), [["EUR/POD/YEAR", 12], ["EUR/KWH", 0.02]]);
assert.deepEqual(parse(workbook([`<row r="10">${cell("B10", "Utenze domestiche non residenti")}${num("E10", "2")}</row>`])), [["EUR/POD/YEAR", 0], ["EUR/KWH", 0.02]]);
console.log("NON_RESIDENT_ARIM_QUOTA_FISSA=PASS");
