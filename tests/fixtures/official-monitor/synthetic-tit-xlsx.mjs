import { zipSync, strToU8 } from "fflate";

/**
 * SYNTHETIC test workbook, NOT the ARERA file: it imitates a TIT tables workbook (several sheets, Tabella 4 before Tabella 5,
 * merged year/kind headers, shared strings, "quota parte" blocks, a value stored with Excel binary noise). Its numbers are
 * test values. The real file 575-2025-R-eel-TABELLE_TIT.xlsx must be checked separately: the reader finds the table by its
 * labels precisely because the real layout is not assumed.
 */
const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colLetter = (col) => { let out = ""; let value = col; while (value > 0) { const rest = (value - 1) % 26; out = String.fromCharCode(65 + rest) + out; value = Math.floor((value - 1) / 26); } return out; };

export function syntheticTitWorkbook({ extraNote, thresholdPercent = 33, table5 = true, years = [2024, 2025, 2026], bt = { 2024: "1.169", 2025: "1.046", 2026: "1.0880000000000001" }, mt = { 2024: "0.408", 2025: "0.361", 2026: "0.377" }, unit = "centesimi di euro/kvarh", omitMtYear = null } = {}) {
  const shared = [];
  const s = (text) => { let index = shared.indexOf(text); if (index < 0) { shared.push(text); index = shared.length - 1; } return index; };
  const rows = new Map(); const merges = [];
  const put = (row, col, value) => { if (!rows.has(row)) rows.set(row, []); rows.get(row).push([col, value]); };
  // Tabella 4 (another table, same sheet, above): its numbers must not be read as Tabella 5.
  put(1, 1, "Tabella 4: Tariffa D2 per clienti domestici"); put(2, 1, "F1"); put(2, 2, 9.99);
  if (table5) {
    put(4, 1, "Tabella 5: Corrispettivi per energia reattiva"); merges.push("A4:H4");
    put(5, 3, unit); merges.push(`C5:${colLetter(2 + years.length * 2)}5`);
    years.forEach((year, index) => { const col = 3 + index * 2; put(6, col, `anno ${year}`); merges.push(`${colLetter(col)}6:${colLetter(col + 1)}6`); put(7, col, `energia reattiva prelevata eccedente il ${thresholdPercent}% dell'energia attiva`); put(7, col + 1, "energia reattiva immessa"); });
    put(6, 1, "Fasce orarie");
    let row = 8;
    const block = (label, values, skipYear) => {
      put(row, 1, label); row += 1;
      for (const band of ["F1", "F2", "F3"]) {
        put(row, 2, band);
        years.forEach((year, index) => {
          if (year === skipYear) return;
          const col = 3 + index * 2; const value = values[year];
          put(row, col, band === "F3" ? 0 : Number.isNaN(Number(value)) ? value : { raw: value });
          put(row, col + 1, band === "F3" ? { raw: value } : 0);
        });
        row += 1;
      }
    };
    block("Punti di prelievo di clienti finali e punti di interconnessione in bassa tensione", bt);
    block("Quota parte del corrispettivo per clienti finali che concorre alla determinazione dei ricavi effettivi (bassa tensione)", { 2024: "0.782", 2025: "0.782", 2026: "0.795" });
    block("Punti di prelievo di clienti finali e punti di interconnessione in media tensione", mt, omitMtYear);
    block("Quota parte del corrispettivo per clienti finali che concorre alla determinazione dei ricavi effettivi (media tensione)", { 2024: "0.259", 2025: "0.259", 2026: "0.264" });
    put(row + 1, 1, "(*) Le soglie qui riportate si applicano salvo soglie diverse ai sensi del TIT");
    if (extraNote) put(row + 3, 1, `nota di prova: ${extraNote}`);
  }
  const cellXml = (row, col, value) => {
    const ref = `${colLetter(col)}${row}`;
    if (typeof value === "string") return `<c r="${ref}" t="s"><v>${s(value)}</v></c>`;
    if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
    return `<c r="${ref}"><v>${value.raw}</v></c>`;
  };
  const sheetData = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => `<row r="${row}">${cells.sort((a, b) => a[0] - b[0]).map(([col, value]) => cellXml(row, col, value)).join("")}</row>`).join("");
  const sheet2 = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : ""}</worksheet>`;
  const sheet1 = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Tabella 1: copertina di prova</t></is></c></row></sheetData></worksheet>`;
  const sharedXml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((text) => `<si><t xml:space="preserve">${esc(text)}</t></si>`).join("")}</sst>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Copertina" sheetId="1" r:id="rId1"/><sheet name="Tabelle 4-5" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet1),
    "xl/worksheets/sheet2.xml": strToU8(sheet2),
    "xl/sharedStrings.xml": strToU8(sharedXml),
  });
}

/** In-memory TenantRecordRepository with versions, for tests. */
export function memoryRepository() {
  const store = new Map();
  const key = (tenantId, recordId) => `${tenantId}|${recordId}`;
  return {
    store,
    async get(tenantId, recordId) { return store.get(key(tenantId, recordId)) ?? null; },
    async list(tenantId) { return [...store.values()].filter((record) => record.tenantId === tenantId); },
    async append(input) { if (store.has(key(input.tenantId, input.recordId))) throw new Error("RECORD_EXISTS"); const record = { tenantId: input.tenantId, recordId: input.recordId, version: 1, payload: structuredClone(input.payload) }; store.set(key(input.tenantId, input.recordId), record); return record; },
    async put(input) { const current = store.get(key(input.tenantId, input.recordId)); if (current && input.expectedVersion !== undefined && current.version !== input.expectedVersion) throw new Error("VERSION_CONFLICT"); const record = { tenantId: input.tenantId, recordId: input.recordId, version: (current?.version ?? 0) + 1, payload: structuredClone(input.payload) }; store.set(key(input.tenantId, input.recordId), record); return record; },
  };
}
