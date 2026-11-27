import { crc32, inflateRawSync } from "node:zlib";

/**
 * Control Room produttore: lettura di un file Excel ufficiale (xlsx = archivio zip di XML), senza librerie e senza presumere
 * celle. Ogni voce dell'archivio è controllata con il proprio CRC-32 e la dimensione dichiarata (integrità del documento); le
 * celle unite (mergeCells) sono espanse, così un'intestazione su più colonne vale per ognuna.
 */
export interface XlsxCell { readonly sheet: string; readonly ref: string; readonly row: number; readonly col: number; readonly text: string; readonly number: string | null }
export interface XlsxWorkbook { readonly sheets: readonly { readonly name: string; readonly cells: readonly XlsxCell[] }[] }

const fail = (code: string): never => { throw new Error(code); };

function readEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  if (end < 0) fail("OFFICIAL_XLSX_NOT_ZIP");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let entry = 0; entry < count; entry += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) fail("OFFICIAL_XLSX_DIRECTORY_CORRUPT");
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true); const extra = view.getUint16(cursor + 30, true); const comment = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extra + comment;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) fail("OFFICIAL_XLSX_ENTRY_CORRUPT");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const payload = bytes.subarray(start, start + compressed);
    if (payload.length !== compressed) fail("OFFICIAL_XLSX_TRUNCATED");
    const data = method === 0 ? payload : method === 8 ? new Uint8Array(inflateRawSync(payload)) : fail(`OFFICIAL_XLSX_COMPRESSION_UNSUPPORTED:${method}`);
    if (data.length !== size || crc32(data) !== crc) fail(`OFFICIAL_XLSX_CRC_MISMATCH:${name}`);
    entries.set(name, data);
  }
  return entries;
}

const decode = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&amp;/g, "&");
const textOf = (xml: string) => decode([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join("")).replace(/\s+/g, " ").trim();

function column(letters: string): number { let value = 0; for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64); return value; }
function address(ref: string): { row: number; col: number } {
  const match = /^([A-Z]{1,3})(\d+)$/.exec(ref) ?? fail(`OFFICIAL_XLSX_CELL_REF:${ref}`);
  return { col: column(match![1]), row: Number(match![2]) };
}
const letters = (col: number): string => { let out = ""; let value = col; while (value > 0) { const rest = (value - 1) % 26; out = String.fromCharCode(65 + rest) + out; value = Math.floor((value - 1) / 26); } return out; };

export function readXlsx(bytes: Uint8Array): XlsxWorkbook {
  const entries = readEntries(bytes);
  const xml = (name: string) => { const data = entries.get(name); return data ? new TextDecoder().decode(data) : null; };
  const workbook = xml("xl/workbook.xml") ?? fail("OFFICIAL_XLSX_WORKBOOK_MISSING");
  const rels = xml("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => [/Id="([^"]+)"/.exec(match[0])?.[1] ?? "", /Target="([^"]+)"/.exec(match[0])?.[1] ?? ""]));
  const sharedXml = xml("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1])) : [];
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match, index) => {
    const name = decode(/name="([^"]*)"/.exec(match[0])?.[1] ?? `Foglio${index + 1}`);
    const target = targets.get(/r:id="([^"]+)"/.exec(match[0])?.[1] ?? "") ?? `worksheets/sheet${index + 1}.xml`;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const sheetXml = xml(path) ?? fail(`OFFICIAL_XLSX_SHEET_MISSING:${name}`);
    const cells = new Map<string, XlsxCell>();
    for (const cell of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]; const body = cell[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]; if (!ref) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const text = type === "s" ? shared[Number(raw)] ?? "" : type === "inlineStr" ? textOf(body) : decode(raw ?? "").trim();
      const number = (type === undefined || type === "n") && raw !== undefined && /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(raw.trim()) ? raw.trim() : null;
      if (text === "" && number === null) continue;
      const { row, col } = address(ref);
      cells.set(ref, { sheet: name, ref, row, col, text, number });
    }
    // Merged header cells: the value of the top-left cell applies to every cell of the range.
    for (const merge of sheetXml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const from = address(merge[1]); const to = address(merge[2]); const origin = cells.get(merge[1]); if (!origin) continue;
      for (let row = from.row; row <= to.row; row += 1) for (let col = from.col; col <= to.col; col += 1) {
        const ref = `${letters(col)}${row}`; if (!cells.has(ref)) cells.set(ref, { ...origin, ref, row, col });
      }
    }
    return { name, cells: [...cells.values()].sort((a, b) => a.row - b.row || a.col - b.col) };
  });
  if (!sheets.length) fail("OFFICIAL_XLSX_NO_SHEETS");
  return { sheets };
}

/** Exact decimal text of a numeric cell (Excel stores binary doubles as shortest round-trip text; exponents are expanded). */
export function cellDecimal(cell: XlsxCell): string | null {
  if (cell.number === null) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i.exec(cell.number);
  if (!match) return null;
  const exponent = Number(match[4] ?? "0"); const digits = `${match[2]}${match[3] ?? ""}`; const point = match[2].length + exponent;
  const whole = point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0");
  const fraction = point <= 0 ? `${"0".repeat(-point)}${digits}` : digits.slice(point);
  const clean = `${whole.replace(/^0+(?=\d)/, "")}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
  return `${match[1]}${clean}`;
}
