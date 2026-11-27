import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { parseAreraDomesticCdispdXlsx } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { createAreraRegulatorySourceReader } from "../app/lib/regulatory-refresh/arera.ts";

// Tony (28/10): "se lo carico manualmente diventa un errore perché sono dati che si devono aggiornare in automatico". The
// nightly refresh must keep reading ARERA's CDISPD workbook when a new month is added: synthetic workbook, invented values.
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
const sheet = (value, header = "Corrispettivo dispacciamento") => `<worksheet><sheetData>
<row r="4">${cell("A4", "CLIENTI DOMESTICI")}${cell("B4", "MERCATO LIBERO")}</row>
<row r="11">${cell("C11", header)}</row><row r="14"><c r="C14"><v>${value}</v></c></row>
<row r="24"><c r="C24"><v>${value}</v></c></row></sheetData></worksheet>`;
// The newest month is the first tab but the last file, as when ARERA inserts it in front of the others.
const tabs = [["Settembre 2026", "rId3", "worksheets/sheet3.xml"], ["agosto 2026", "rId2", "worksheets/sheet2.xml"], ["Lug. 2026", "rId1", "worksheets/sheet1.xml"], ["giugno 2026", "rId4", "worksheets/sheet4.xml"]];
const workbook = zip({
  "xl/workbook.xml": `<workbook><sheets>${tabs.map(([name, id], index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="${id}"/>`).join("")}</sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships>${tabs.map(([, id, target]) => `<Relationship Id="${id}" Type="worksheet" Target="${target}"/>`).join("")}</Relationships>`,
  "xl/sharedStrings.xml": "<sst></sst>",
  "xl/worksheets/sheet1.xml": sheet(0.031),
  "xl/worksheets/sheet2.xml": sheet(0.022),
  "xl/worksheets/sheet3.xml": sheet(0.013),
  "xl/worksheets/sheet4.xml": sheet(0.044, "Nuova colonna"),
});
const imported = parseAreraDomesticCdispdXlsx({ body: workbook, sourceReference: "https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx", retrievedAt: "2026-10-28T00:00:00.000Z" });
assert.deepEqual(imported.records.map((record) => [record.effectiveFrom, record.normalizedValue]), [["2026-09-01", 0.013], ["2026-08-01", 0.022], ["2026-07-01", 0.031]]);
assert.deepEqual(imported.errors, ["ARERA_DOMESTIC_CDISPD_HEADER_MISSING:giugno 2026"]);
console.log("CDISPD_SHEET_FILE_FROM_RELATIONSHIPS=PASS");
console.log("CDISPD_ABBREVIATED_MONTH_NAMES=PASS");
console.log("CDISPD_UNREADABLE_MONTH_SKIPPED_AND_REPORTED=PASS");

// One ARERA source that cannot be read never empties the archive refresh of the others.
const page = `<a href="https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx">xlsx</a>`;
const fetcher = async (url) => url.endsWith(".xlsx")
  ? { status: 200, headers: { get: () => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, text: async () => "", arrayBuffer: async () => workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) }
  : url.includes("valori-rete-oneri-domestici") ? { status: 200, headers: { get: () => "text/html" }, text: async () => page, arrayBuffer: async () => new TextEncoder().encode(page).buffer } : { status: 503, headers: { get: () => "text/html" }, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
const reader = createAreraRegulatorySourceReader({ fetcher });
const records = await reader.load({ tenantId: "tenant_cdispd-resilience", retrievedAt: "2026-10-28T00:00:00.000Z" });
assert.deepEqual(records.filter((record) => record.componentCode === "DISPATCHING_TOTAL").map((record) => record.effectiveFrom), ["2026-09-01", "2026-08-01", "2026-07-01"]);
assert.ok(reader.lastErrors().some((error) => error.startsWith("ARERA_TARIFFS:")));
assert.ok(reader.lastErrors().includes("ARERA_CDISPD:ARERA_DOMESTIC_CDISPD_HEADER_MISSING:giugno 2026"));
console.log("ARERA_SOURCES_READ_INDEPENDENTLY=PASS");
