import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { ARERA_575_TIME_TABLES_URL, ARERA_MEASUREMENT_PAGE, fetchOfficialBta6Sources, parseArera575Bta6MeasurementXlsx } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { REQUIRED_OFFICIAL_TABLES, requiredTableAlerts, uploadedTableFetcher } from "../app/lib/regulatory-refresh/required-tables.ts";

// Tony (6/11, quota fissa BPower 3,56 €/mese vs 3,74 billed): "ti fornisco la tabella, ma devi mettere un allert che quando aggiorni
// noi produttori dell'app dobbiamo scaricare e inserire le tabelle che servono secondo le indicazioni". Synthetic TIME-like
// workbook with invented values; the layout follows ARERA's sheet "Tabelle 1, 2" (two tables, each with its own Anno header row).
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
const text = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
const num = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
const years = (row) => `<row r="${row}">${["C", "D", "E", "F"].map((column, index) => text(`${column}${row}`, `Anno ${2024 + index}`)).join("")}${["G", "H", "I", "J"].map((column, index) => text(`${column}${row}`, `Anno ${2024 + index}`)).join("")}</row>`;
const values = (row, base) => `<row r="${row}">${text(`A${row}`, "Altre utenze in bassa tensione")}${["C", "D", "E", "F"].map((column, index) => num(`${column}${row}`, base + index * 10)).join("")}${["G", "H", "I", "J"].map((column) => num(`${column}${row}`, 0.01)).join("")}</row>`;
const time = zip({
  "xl/workbook.xml": `<workbook><sheets><sheet name="Indice" sheetId="1" r:id="rId1"/><sheet name="Tabelle 1, 2" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": "<sst></sst>",
  "xl/worksheets/sheet1.xml": "<worksheet><sheetData></sheetData></worksheet>",
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData>${years(4)}${values(8, 1000)}${years(19)}${values(23, 100)}</sheetData></worksheet>`,
});
const retrievedAt = "2026-11-06T10:00:00.000Z";

// 1. Both tables are summed for the year: 2026 = 1020 + 120 c€ = 11,40 €/POD/anno.
const metering = parseArera575Bta6MeasurementXlsx({ body: time, retrievedAt, requiredYear: 2026 });
assert.equal(metering.normalizedValue, 11.4);
assert.equal(metering.effectiveFrom.slice(0, 10), "2026-01-01");
assert.match(metering.officialIdentifier, /:TIME:/);
assert.throws(() => parseArera575Bta6MeasurementXlsx({ body: time, retrievedAt, requiredYear: 2030 }), /SOURCE_YEAR_NOT_AVAILABLE/);

// 2. ARERA unreachable for the TIME file: no partial MIS1 value from the page, an "Azione richiesta" error instead.
const table = REQUIRED_OFFICIAL_TABLES[0];
const offline = async () => new Response("", { status: 403 });
const failingFetch = async (url) => { if (url === ARERA_575_TIME_TABLES_URL || url === ARERA_MEASUREMENT_PAGE) return offline(); throw new Error("UNEXPECTED_" + url); };
const { fetchOfficialAreraSource } = await import("../app/lib/foundation/arera-electricity-regulatory.ts");
await assert.rejects(() => fetchOfficialAreraSource(ARERA_575_TIME_TABLES_URL, failingFetch), /ARERA_HTTP_403/);

// 3. The uploaded file is served where the refresh downloads it; the measurement page is skipped.
const fetcher = uploadedTableFetcher(table, time, failingFetch);
const served = await fetchOfficialAreraSource(ARERA_575_TIME_TABLES_URL, fetcher);
assert.equal(parseArera575Bta6MeasurementXlsx({ body: served.bytes, retrievedAt, requiredYear: 2026 }).normalizedValue, 11.4);
await assert.rejects(() => fetchOfficialAreraSource(ARERA_MEASUREMENT_PAGE, fetcher), /ARERA_HTTP_404/);
assert.equal(typeof fetchOfficialBta6Sources, "function");

// 4. Alerts: missing for the year, cleared by an approved TIME value, next year from 15 December.
const record = (scope, from, to) => ({ ...metering, customerScope: scope, effectiveFrom: from, effectiveTo: to });
const covered = [record("NON_DOMESTIC_BT_BTA1_5", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"), record("NON_DOMESTIC_BT_BTA6", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")];
const missing = requiredTableAlerts([], ["ARERA_BTA_METERING:ARERA_TIME_TABLES_REQUIRED:2026:ARERA_HTTP_403"], retrievedAt);
assert.equal(missing.length, 1);
assert.equal(missing[0].year, 2026);
assert.equal(missing[0].reason, "MISSING");
assert.match(missing[0].refreshError, /ARERA_TIME_TABLES_REQUIRED/);
assert.ok(missing[0].instructions.length >= 3);
assert.deepEqual(requiredTableAlerts(covered, [], retrievedAt), []);
// The old page value (MIS1 only, not from TIME) does not count as covered.
assert.equal(requiredTableAlerts(covered.map((item) => ({ ...item, officialIdentifier: "ARERA_MEASUREMENT_PAGE:MIS1" })), [], retrievedAt).length, 1);
const december = requiredTableAlerts(covered, [], "2026-12-16T08:00:00.000Z");
assert.equal(december.length, 1);
assert.equal(december[0].year, 2027);
assert.equal(december[0].reason, "NEXT_YEAR");
console.log("required official tables: ok");
