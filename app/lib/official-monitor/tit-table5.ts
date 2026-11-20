import { cellDecimal, readXlsx, type XlsxCell, type XlsxWorkbook } from "./xlsx";

/**
 * Control Room produttore: TIT 2024-2027, Tabella 5 "Corrispettivi per energia reattiva" (Tony, 17/11/2026). La tabella si trova
 * per testo, non per posizione: foglio e cella del titolo "Tabella 5 … energia reattiva", colonne per anno ("anno 2026") e per
 * tipo ("prelevata eccedente il 33% dell'energia attiva" / "immessa"), unità "centesimi di euro/kvarh", righe per livello di
 * tensione ("punti di prelievo … in bassa/media tensione") e fascia (F1, F2, F3). Le righe "quota parte … ricavi effettivi"
 * (perequazione, TIT art. 34) non sono corrispettivi al cliente e sono scartate. Ogni valore porta foglio e cella d'origine.
 */
export interface Table5Value {
  readonly voltage: "BT" | "MT";
  readonly year: number;
  readonly kind: "WITHDRAWN" | "INJECTED";
  readonly band: "F1" | "F2" | "F3";
  /** Exact decimal as published (c€/kvarh). */
  readonly centsPerKvarh: string;
  /** Threshold as a share of the active energy of the band, from the column header ("33%" → "0.33"); "0" for injected. */
  readonly thresholdRatio: string;
  readonly sheet: string;
  readonly cell: string;
}

export interface Table5Check { readonly code: string; readonly ok: boolean; readonly detail: string }
export interface Table5Reading { readonly ok: boolean; readonly checks: readonly Table5Check[]; readonly values: readonly Table5Value[]; readonly warnings: readonly string[]; readonly structure: { readonly sheet: string | null; readonly titleCell: string | null; readonly years: readonly number[] } }

const isTable5Title = (text: string) => /tabella\s*5\b/i.test(text) && /reattiva/i.test(text);
/** "anno 2026" or a bare "2026" header cell (text or number). */
const YEAR = /^(?:anno\s*)?(20\d\d)$/i;
const yearOf = (cell: XlsxCell) => YEAR.exec((cell.number ?? cell.text).trim())?.[1];
const isOtherTableTitle = (text: string) => /^tabella\s*\d+/i.test(text.trim()) && !/^tabella\s*5\b/i.test(text.trim());

/** Excel keeps binary doubles: "1.0880000000000001" is 1,088 as typed. Accept the shortest decimal (≤ 6 digits) within 1e-12. */
function publishedDecimal(cell: XlsxCell, warnings: string[]): string | null {
  const exact = cellDecimal(cell); if (exact === null) return null;
  const [, fraction = ""] = exact.split(".");
  if (fraction.length <= 6) return exact;
  const number = Number(exact);
  for (let digits = 0; digits <= 6; digits += 1) {
    const candidate = number.toFixed(digits);
    if (Math.abs(Number(candidate) - number) < 1e-12) { warnings.push(`${cell.sheet}!${cell.ref}: ${exact} letto come ${candidate} (rappresentazione binaria di Excel)`); return candidate.replace(/\.?0+$/, ""); }
  }
  return null;
}

export function readTitTable5(workbook: XlsxWorkbook): Table5Reading {
  const checks: Table5Check[] = []; const warnings: string[] = []; const values: Table5Value[] = [];
  const check = (code: string, ok: boolean, detail: string) => { checks.push({ code, ok, detail }); return ok; };
  const found = workbook.sheets.flatMap((sheet) => sheet.cells.filter((cell) => isTable5Title(cell.text)).map((cell) => ({ sheet, cell })));
  // Merged titles repeat over their range: keep the top-left cell of the first sheet that has one.
  const title = found.sort((a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col)[0];
  if (!check("TITLE", Boolean(title), title ? `"${title.cell.text}" in ${title.sheet.name}!${title.cell.ref}` : "nessuna cella con \"Tabella 5\" e \"reattiva\" in nessun foglio")) {
    return { ok: false, checks, values, warnings, structure: { sheet: null, titleCell: null, years: [] } };
  }
  const { sheet, cell: titleCell } = title!;
  const nextTitleRow = sheet.cells.filter((cell) => cell.row > titleCell.row && isOtherTableTitle(cell.text)).map((cell) => cell.row).sort((a, b) => a - b)[0] ?? Number.POSITIVE_INFINITY;
  const region = sheet.cells.filter((cell) => cell.row >= titleCell.row && cell.row < nextTitleRow);
  check("UNIT", region.some((cell) => /centesimi di euro\s*\/\s*kvarh/i.test(cell.text)), "unità \"centesimi di euro/kvarh\" nell'intestazione della tabella");

  const yearCells = region.filter((cell) => yearOf(cell) !== undefined);
  const kindCells = region.filter((cell) => cell.number === null && (/prelevat/i.test(cell.text) || /immess/i.test(cell.text)));
  const bandCells = region.filter((cell) => /^F[123]$/.test(cell.text.trim()));
  const firstDataRow = bandCells.length ? Math.min(...bandCells.map((cell) => cell.row)) : Number.POSITIVE_INFINITY;
  check("HEADERS", yearCells.length > 0 && kindCells.length > 0 && bandCells.length > 0, `${yearCells.length} intestazioni anno, ${kindCells.length} intestazioni prelevata/immessa, ${bandCells.length} celle di fascia`);

  // For each column, the header texts above the first data row (merged headers already expanded).
  // Nearest header first, so a year in a wider title above never wins over the column's own year.
  const header = (col: number) => region.filter((cell) => cell.col === col && cell.row < firstDataRow && cell.row > titleCell.row).sort((a, b) => b.row - a.row);
  const voltageRows = region.filter((cell) => cell.number === null && /punti di prelievo/i.test(cell.text) && /(bassa|media) tensione/i.test(cell.text))
    .sort((a, b) => a.row - b.row);
  check("VOLTAGE_ROWS", voltageRows.some((cell) => /bassa/i.test(cell.text) && !/quota parte/i.test(cell.text)) && voltageRows.some((cell) => /media/i.test(cell.text) && !/quota parte/i.test(cell.text)), "righe \"punti di prelievo … in bassa tensione\" e \"… in media tensione\"");
  // A "quota parte" label starts a block that is not charged to the customer.
  const blockStarts = region.filter((cell) => cell.number === null && (/punti di prelievo/i.test(cell.text) || /quota parte/i.test(cell.text))).sort((a, b) => a.row - b.row);

  const numbers = region.filter((cell) => cell.number !== null && cell.row >= firstDataRow && yearOf(cell) === undefined);
  for (const cell of numbers) {
    const texts = header(cell.col);
    const year = texts.map(yearOf).find((value) => value !== undefined);
    const kindText = texts.map((item) => item.text).find((text) => /prelevat/i.test(text) || /immess/i.test(text));
    const band = region.find((other) => other.row === cell.row && /^F[123]$/.test(other.text.trim()))?.text.trim() as Table5Value["band"] | undefined;
    const block = blockStarts.filter((start) => start.row <= cell.row).at(-1);
    if (!year || !kindText || !band || !block) { warnings.push(`${sheet.name}!${cell.ref}: valore ${cell.number} senza anno, tipo, fascia o riga di tensione riconoscibili: ignorato`); continue; }
    if (/quota parte/i.test(block.text)) continue;
    const voltage = /bassa/i.test(block.text) ? "BT" : /media/i.test(block.text) ? "MT" : null;
    if (!voltage) continue;
    const decimal = publishedDecimal(cell, warnings);
    if (decimal === null || Number(decimal) < 0) { check("VALUE", false, `${sheet.name}!${cell.ref}: valore non valido ${cell.number}`); continue; }
    const kind = /immess/i.test(kindText) ? "INJECTED" : "WITHDRAWN";
    const percent = /(\d+(?:[.,]\d+)?)\s*%/.exec(kindText)?.[1]?.replace(",", ".");
    if (kind === "WITHDRAWN" && !percent) { check("THRESHOLD", false, `${sheet.name}!${cell.ref}: colonna prelevata senza soglia percentuale ("${kindText}")`); continue; }
    const thresholdRatio = kind === "INJECTED" ? "0" : String(Number(percent) / 100);
    values.push({ voltage, year: Number(year), kind, band, centsPerKvarh: decimal, thresholdRatio, sheet: sheet.name, cell: cell.ref });
  }
  const years = [...new Set(values.map((value) => value.year))].sort();
  check("VALUES", values.length > 0, `${values.length} valori riconosciuti (${years.join(", ") || "nessun anno"})`);
  const keys = values.map((value) => `${value.voltage}|${value.year}|${value.kind}|${value.band}`);
  check("UNIQUE", new Set(keys).size === keys.length, "un solo valore per tensione, anno, tipo e fascia");
  return { ok: checks.every((item) => item.ok), checks, values, warnings, structure: { sheet: sheet.name, titleCell: titleCell.ref, years } };
}

export interface Table5YearValidation { readonly ok: boolean; readonly checks: readonly Table5Check[]; readonly values: readonly Table5Value[] }

/** The year the alert asks for must be complete: BT and MT, withdrawn F1/F2 and injected F3 (TIT art. 32, delibera 232/2022). */
export function validateTable5Year(reading: Table5Reading, year: number): Table5YearValidation {
  const checks: Table5Check[] = [...reading.checks];
  const values = reading.values.filter((value) => value.year === year);
  for (const voltage of ["BT", "MT"] as const) {
    for (const [kind, band] of [["WITHDRAWN", "F1"], ["WITHDRAWN", "F2"], ["INJECTED", "F3"]] as const) {
      const value = values.find((item) => item.voltage === voltage && item.kind === kind && item.band === band);
      checks.push({ code: `PERIOD_${voltage}_${kind}_${band}`, ok: Boolean(value && Number(value.centsPerKvarh) > 0), detail: value ? `${voltage} ${year} ${kind === "INJECTED" ? "immessa" : "prelevata"} ${band} = ${value.centsPerKvarh} c€/kvarh (${value.sheet}!${value.cell})` : `${voltage} ${year} ${kind === "INJECTED" ? "immessa" : "prelevata"} ${band}: assente` });
    }
  }
  return { ok: checks.every((item) => item.ok), checks, values };
}

export function readTitTable5File(bytes: Uint8Array): Table5Reading { return readTitTable5(readXlsx(bytes)); }
