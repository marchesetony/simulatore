import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { ElectricityMonthlyPunRecord } from "../energy/market-data.ts";

export const GME_HISTORICAL_DISCOVERY_URL = "https://gme.mercatoelettrico.org/Home/Esiti/Elettricita/MGP/Statistiche/DatiStorici";
export const GME_HISTORICAL_ARCHIVE_URL = "https://gme.mercatoelettrico.org/Home/Esiti/Elettricita/MGP/Statistiche/DatiStorici/moduleId/10874/controller/GmeDatiStoriciItem/action/DownloadFile?fileName=Anno2026.zip";
export const GME_HISTORICAL_SOURCE_ID = "GME_MGP_ANNUAL_ARCHIVE";
export const GME_HISTORICAL_PARSER_VERSION = "A7.1";
export const GME_PUN_TIMEZONE = "Europe/Rome";

export const MAX_OUTER_ZIP_BYTES = 30 * 1024 * 1024;
export const MAX_OUTER_ENTRY_COUNT = 8;
export const MAX_OUTER_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
export const MAX_XLSX_BYTES = 25 * 1024 * 1024;
export const MAX_XLSX_ENTRY_COUNT = 80;
export const MAX_XLSX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
export const MAX_XML_BYTES = 30 * 1024 * 1024;
export const MAX_ROW_BYTES = 250 * 1024;

export interface GmeHistoricalFetcherResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export type GmeHistoricalFetcher = (input: string, init?: RequestInit) => Promise<GmeHistoricalFetcherResponse>;

export interface GmePt15Interval {
  readonly date: string;
  readonly hour: number;
  readonly period: number;
  readonly pun: number;
}

export interface GmeHistoricalArchiveResult {
  readonly records: readonly ElectricityMonthlyPunRecord[];
  readonly archiveUrl: string;
  readonly sourceSha256: string;
  readonly workbookName: string;
  readonly worksheetName: string;
  readonly intervalCount: number;
}

type ZipLimits = { readonly maxBytes: number; readonly maxEntryCount: number; readonly maxUncompressedBytes: number };
type ZipEntry = { readonly name: string; readonly compressedSize: number; readonly uncompressedSize: number; readonly crc32: number };
type XmlNode = Record<string, unknown>;

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  trimValues: false,
});

function fail(code: string): never { throw new Error(code); }
function xmlNode(value: unknown): XmlNode { return value && typeof value === "object" && !Array.isArray(value) ? value as XmlNode : {}; }
function asArray<T>(value: T | readonly T[] | undefined): readonly T[] { if (value === undefined) return []; return Array.isArray(value) ? value as readonly T[] : [value as T]; }
function uint16(bytes: Uint8Array, offset: number): number { return bytes[offset] | (bytes[offset + 1] << 8); }
function uint32(bytes: Uint8Array, offset: number): number { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) if (uint32(bytes, offset) === 0x06054b50) return offset;
  return fail("GME_ZIP_EOCD_MISSING");
}
function unsafeZipPath(name: string): boolean {
  return name.length === 0 || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(name) || name.split(/[\\/]/).includes("..") || name.includes("\\0");
}
function validateZip(bytes: Uint8Array, limits: ZipLimits): readonly ZipEntry[] {
  if (bytes.length < 22 || bytes.length > limits.maxBytes) fail("GME_ZIP_SIZE_INVALID");
  const eocd = findEndOfCentralDirectory(bytes);
  const entryCount = uint16(bytes, eocd + 10);
  const centralSize = uint32(bytes, eocd + 12);
  const centralOffset = uint32(bytes, eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail("GME_ZIP64_UNSUPPORTED");
  if (entryCount === 0 || entryCount > limits.maxEntryCount || centralOffset + centralSize > eocd) fail("GME_ZIP_DIRECTORY_INVALID");
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || uint32(bytes, offset) !== 0x02014b50) fail("GME_ZIP_ENTRY_INVALID");
    const compressedSize = uint32(bytes, offset + 20);
    const uncompressedSize = uint32(bytes, offset + 24);
    const nameLength = uint16(bytes, offset + 28);
    const extraLength = uint16(bytes, offset + 30);
    const commentLength = uint16(bytes, offset + 32);
    const localOffset = uint32(bytes, offset + 42);
    const nameEnd = offset + 46 + nameLength;
    const next = nameEnd + extraLength + commentLength;
    if (next > eocd || localOffset + 30 > bytes.length) fail("GME_ZIP_ENTRY_BOUNDS_INVALID");
    let name = "";
    try { name = textDecoder.decode(bytes.subarray(offset + 46, nameEnd)); } catch { fail("GME_ZIP_FILENAME_INVALID"); }
    if (unsafeZipPath(name) || names.has(name)) fail(names.has(name) ? "GME_ZIP_DUPLICATE_ENTRY" : "GME_ZIP_SLIP_BLOCKED");
    names.add(name);
    if (uncompressedSize > limits.maxUncompressedBytes || compressedSize > limits.maxBytes) fail("GME_ZIP_ENTRY_SIZE_INVALID");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxUncompressedBytes) fail("GME_ZIP_UNCOMPRESSED_LIMIT");
    entries.push({ name, compressedSize, uncompressedSize, crc32: uint32(bytes, offset + 16) });
    offset = next;
  }
  return entries;
}
function parseXml(text: string, code: string): XmlNode {
  if (text.length > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(text)) fail("GME_XML_EXTERNAL_ENTITY_BLOCKED");
  try { return xmlParser.parse(text) as XmlNode; } catch { fail(code); }
}
function xmlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const node = value as XmlNode;
    if (typeof node["#text"] === "string") return node["#text"];
    return Object.values(node).map(xmlText).join("");
  }
  return "";
}
function sharedStrings(xml: string): readonly string[] {
  const root = xmlNode(parseXml(xml, "GME_SHARED_STRINGS_INVALID")["sst"]);
  if (!root) fail("GME_SHARED_STRINGS_MISSING");
  return asArray(root["si"]).map((item) => {
    const node = item as XmlNode;
    if (node["t"] !== undefined) return xmlText(node["t"]);
    return asArray(node["r"]).map((run) => xmlText((run as XmlNode)["t"])).join("");
  });
}
function normalizedTarget(target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const part of raw.split("/")) { if (!part || part === ".") continue; if (part === "..") { if (!parts.length) fail("GME_RELATIONSHIP_PATH_INVALID"); parts.pop(); } else parts.push(part); }
  return parts.join("/");
}
function worksheetPath(workbookXml: string, relsXml: string): { readonly name: string; readonly path: string } {
  const workbook = xmlNode(parseXml(workbookXml, "GME_WORKBOOK_XML_INVALID")["workbook"]);
  const relationships = xmlNode(parseXml(relsXml, "GME_WORKBOOK_RELS_INVALID")["Relationships"]);
  const relById = new Map(asArray(relationships["Relationship"]).map((rel) => [String((rel as XmlNode)["@_Id"]), String((rel as XmlNode)["@_Target"])]));
  const sheets = asArray(xmlNode(workbook["sheets"])["sheet"]);
  const sheet = sheets.find((candidate) => String((candidate as XmlNode)["@_name"]) === "Prezzi-Prices");
  if (!sheet) fail("GME_PT15_WORKSHEET_MISSING");
  const target = relById.get(String((sheet as XmlNode)["@_id"]));
  if (!target) fail("GME_PT15_WORKSHEET_RELATIONSHIP_MISSING");
  return { name: "Prezzi-Prices", path: normalizedTarget(target) };
}
function columnName(reference: string): string { const match = /^([A-Z]+)\d+$/.exec(reference); return match?.[1] ?? fail("GME_CELL_REFERENCE_INVALID"); }
function parsedCell(cell: XmlNode, strings: readonly string[]): string {
  const raw = cell["v"];
  if (raw === undefined || raw === null) fail("GME_CELL_VALUE_MISSING");
  const value = xmlText(raw);
  if (cell["@_t"] === "s") { const index = Number(value); if (!Number.isInteger(index) || strings[index] === undefined) fail("GME_SHARED_STRING_INDEX_INVALID"); return strings[index]; }
  if (cell["@_t"] === "inlineStr") { const inline = xmlNode(cell["is"]); return xmlText(inline["t"] ?? cell["is"]); }
  return value;
}
function rowCells(rowXml: string, strings: readonly string[]): Map<string, string> {
  if (rowXml.length > MAX_ROW_BYTES) fail("GME_ROW_SIZE_INVALID");
  const row = parseXml(rowXml, "GME_WORKSHEET_ROW_INVALID").row;
  const cells = new Map<string, string>();
  for (const item of asArray(xmlNode(row)["c"])) {
    const cell = item as XmlNode;
    const reference = String(cell["@_r"] ?? "");
    const column = columnName(reference);
    if (cells.has(column)) fail("GME_DUPLICATE_CELL");
    cells.set(column, parsedCell(cell, strings));
  }
  return cells;
}
function dateOnly(raw: string): string {
  if (!/^\d{8}$/.test(raw)) fail("GME_DATE_INVALID");
  const result = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = Date.parse(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== result) fail("GME_DATE_INVALID");
  return result;
}
function finiteInteger(raw: string, code: string): number { const value = Number(raw); return Number.isInteger(value) && Number.isFinite(value) ? value : fail(code); }
function finiteNumber(raw: string, code: string): number { const value = Number(raw); return Number.isFinite(value) ? value : fail(code); }
function easterSunday(year: number): Date {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100; const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451); const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1; return new Date(Date.UTC(year, month - 1, day));
}
function italyHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const fixed = new Set([`${year}-01-01`, `${year}-01-06`, `${year}-04-25`, `${year}-05-01`, `${year}-06-02`, `${year}-08-15`, `${year}-11-01`, `${year}-12-08`, `${year}-12-25`, `${year}-12-26`]);
  const easter = easterSunday(year); const easterMonday = new Date(easter.getTime() + 86_400_000).toISOString().slice(0, 10);
  return fixed.has(date) || easterMonday === date;
}
function romeOffsetMinutes(date: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: GME_PUN_TIMEZONE, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(`${date}T00:00:00.000Z`));
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  if (value === "GMT") return 0;
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value);
  if (!match) fail("GME_TIMEZONE_OFFSET_INVALID");
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}
function nextDate(date: string): string { return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10); }
function expectedPt15Count(date: string): 92 | 96 | 100 {
  const count = 96 + (romeOffsetMinutes(date) - romeOffsetMinutes(nextDate(date))) / 15;
  if (count !== 92 && count !== 96 && count !== 100) fail(`GME_PT15_DST_COUNT_INVALID:${date}`);
  return count;
}
function expectedGmeHourForPeriod(period: number): number { return Math.floor((period - 1) / 4) + 1; }
export function classifyGmePt15Band(interval: Pick<GmePt15Interval, "date" | "hour">): "F1" | "F2" | "F3" {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: GME_PUN_TIMEZONE, weekday: "short" }).format(new Date(`${interval.date}T12:00:00.000Z`));
  const day = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[weekday] ?? fail("GME_TIMEZONE_DATE_INVALID");
  if (italyHoliday(interval.date) || day === 0) return "F3";
  if (day === 6) return interval.hour >= 8 && interval.hour <= 23 ? "F2" : "F3";
  if (interval.hour >= 9 && interval.hour <= 19) return "F1";
  if (interval.hour === 8 || (interval.hour >= 20 && interval.hour <= 23)) return "F2";
  return "F3";
}
function nextMonth(month: string): string { return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10); }
function mean(values: readonly number[]): number { if (!values.length) fail("GME_BAND_VALUES_MISSING"); return values.reduce((sum, value) => sum + value, 0) / values.length; }
function rate(value: number) { return { value, currency: "EUR" as const, unit: "EUR_PER_MWH" as const }; }

export function aggregateGmePt15Intervals(input: { readonly tenantId: string; readonly intervals: readonly GmePt15Interval[]; readonly referenceMonth: string; readonly retrievedAt: string; readonly sourceUrl?: string; readonly sourceSha256?: string; readonly requireCompleteMonth?: boolean; }): ElectricityMonthlyPunRecord {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(input.referenceMonth)) fail("GME_REFERENCE_MONTH_INVALID");
  const unique = new Map<string, GmePt15Interval>();
  for (const interval of input.intervals) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(interval.date) || interval.date.slice(0, 7) !== input.referenceMonth) fail("GME_INTERVAL_MONTH_MISMATCH");
    if (!Number.isInteger(interval.hour) || interval.hour < 1 || interval.hour > 25) fail("GME_HOUR_INVALID");
    if (!Number.isInteger(interval.period) || interval.period < 1 || interval.period > 100) fail("GME_PERIOD_INVALID");
    if (!Number.isFinite(interval.pun)) fail("GME_PUN_VALUE_INVALID");
    const key = `${interval.date}|${interval.period}`; const previous = unique.get(key);
    if (previous && previous.pun !== interval.pun) fail("GME_DUPLICATE_INTERVAL_CONFLICT");
    if (!previous) unique.set(key, interval);
  }
  const byDate = new Map<string, GmePt15Interval[]>();
  for (const interval of unique.values()) byDate.set(interval.date, [...(byDate.get(interval.date) ?? []), interval]);
  for (const [date, intervals] of byDate) {
    const count = intervals.length; if (count !== expectedPt15Count(date)) fail(`GME_PT15_DAY_COUNT_INVALID:${date}`);
    const periods = new Set(intervals.map((interval) => interval.period));
    if (periods.size !== count || [...Array(count)].some((_, index) => !periods.has(index + 1))) fail(`GME_PT15_PERIOD_SEQUENCE_INVALID:${date}`);
    if ([...intervals].sort((left, right) => left.period - right.period).some((interval) => interval.hour !== expectedGmeHourForPeriod(interval.period))) fail(`GME_PT15_PERIOD_HOUR_MISMATCH:${date}`);
    const hours = new Map<number, number>();
    for (const interval of intervals) hours.set(interval.hour, (hours.get(interval.hour) ?? 0) + 1);
    const hourCounts = [...hours.values()];
    const hourShapeValid = count === 96
      ? hours.size === 24 && hourCounts.every((value) => value === 4)
      : count === 92
        ? hours.size === 23 && hourCounts.every((value) => value === 4)
        : hours.size === 25 && hourCounts.every((value) => value === 4);
    if (!hourShapeValid) fail(`GME_PT15_HOUR_STRUCTURE_INVALID:${date}`);
  }
  if (input.requireCompleteMonth !== false) {
    const year = Number(input.referenceMonth.slice(0, 4)); const monthNumber = Number(input.referenceMonth.slice(5, 7)); const expectedDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    if (byDate.size !== expectedDays || [...Array(expectedDays)].some((_, index) => !byDate.has(`${input.referenceMonth}-${String(index + 1).padStart(2, "0")}`))) fail("GME_PT15_MONTH_INCOMPLETE");
  }
  const ordered = [...unique.values()];
  const bands = new Map<"F1" | "F2" | "F3", number[]>();
  for (const interval of ordered) { const band = classifyGmePt15Band(interval); bands.set(band, [...(bands.get(band) ?? []), interval.pun]); }
  const sourceUrl = input.sourceUrl ?? GME_HISTORICAL_ARCHIVE_URL;
  return {
    schemaVersion: 1, recordId: `gme-pun-${input.referenceMonth}`, version: "1", parentVersionId: null, tenantId: input.tenantId,
    recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month: input.referenceMonth,
    monthly: rate(mean(ordered.map((item) => item.pun))), f1: rate(mean(bands.get("F1") ?? [])), f2: rate(mean(bands.get("F2") ?? [])), f3: rate(mean(bands.get("F3") ?? [])),
    source: { sourceId: GME_HISTORICAL_SOURCE_ID, name: "GME MGP PUN Index GME PT15", url: sourceUrl, authority: "GME", sourceType: "OFFICIAL", ...(input.sourceSha256 ? { sourceSha256: input.sourceSha256 } : {}), relatedUrls: [GME_HISTORICAL_DISCOVERY_URL, sourceUrl] },
    approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" }, publicationDate: null, effectiveFrom: `${input.referenceMonth}-01`, effectiveTo: nextMonth(input.referenceMonth),
  };
}

function parseWorkbook(input: { readonly xlsxBytes: Uint8Array; readonly tenantId: string; readonly referenceMonths?: readonly string[]; readonly retrievedAt: string; readonly sourceUrl: string; readonly sourceSha256: string }): { readonly records: readonly ElectricityMonthlyPunRecord[]; readonly intervalCount: number } {
  if (input.xlsxBytes.length > MAX_XLSX_BYTES) fail("GME_XLSX_SIZE_INVALID");
  validateZip(input.xlsxBytes, { maxBytes: MAX_XLSX_BYTES, maxEntryCount: MAX_XLSX_ENTRY_COUNT, maxUncompressedBytes: MAX_XLSX_UNCOMPRESSED_BYTES });
  const files = unzipSync(input.xlsxBytes);
  const get = (name: string): string => { const bytes = files[name]; if (!bytes) fail(`GME_XLSX_ENTRY_MISSING:${name}`); return textDecoder.decode(bytes); };
  const workbookXml = get("xl/workbook.xml");
  parseXml(workbookXml, "GME_WORKBOOK_XML_INVALID");
  const sheet = worksheetPath(workbookXml, get("xl/_rels/workbook.xml.rels"));
  const strings = sharedStrings(get("xl/sharedStrings.xml"));
  const worksheet = get(sheet.path);
  const wanted = input.referenceMonths ? new Set(input.referenceMonths) : null;
  const intervalsByMonth = new Map<string, GmePt15Interval[]>();
  let headerChecked = false; let match: RegExpExecArray | null; const rowPattern = /<row\b[^>]*>[\s\S]*?<\/row>/g;
  while ((match = rowPattern.exec(worksheet)) !== null) {
    const cells = rowCells(match[0], strings);
    if (!headerChecked) {
      const header = (column: string): string => (cells.get(column) ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!header("A").includes("data/date") || !header("B").includes("ora") || !header("B").includes("hour") || !header("C").includes("period") || header("D") !== "pun index gme") fail("GME_PT15_HEADER_INVALID");
      headerChecked = true; continue;
    }
    if (!cells.has("A") || !cells.has("B") || !cells.has("C") || !cells.has("D")) fail("GME_PT15_REQUIRED_COLUMN_MISSING");
    const date = dateOnly(cells.get("A")!); const month = date.slice(0, 7); if (wanted && !wanted.has(month)) continue;
    const interval: GmePt15Interval = { date, hour: finiteInteger(cells.get("B")!, "GME_HOUR_INVALID"), period: finiteInteger(cells.get("C")!, "GME_PERIOD_INVALID"), pun: finiteNumber(cells.get("D")!, "GME_PUN_VALUE_INVALID") };
    intervalsByMonth.set(month, [...(intervalsByMonth.get(month) ?? []), interval]);
  }
  if (!headerChecked || !intervalsByMonth.size) fail("GME_PT15_DATA_MISSING");
  const months = wanted ? [...wanted] : [...intervalsByMonth.keys()].sort();
  const records = months.map((referenceMonth) => {
    const intervals = intervalsByMonth.get(referenceMonth); if (!intervals) fail(`GME_PT15_MONTH_MISSING:${referenceMonth}`);
    return aggregateGmePt15Intervals({ tenantId: input.tenantId, intervals, referenceMonth, retrievedAt: input.retrievedAt, sourceUrl: input.sourceUrl, sourceSha256: input.sourceSha256 });
  });
  return { records, intervalCount: [...intervalsByMonth.values()].reduce((sum, intervals) => sum + intervals.length, 0) };
}

export async function loadGmeHistoricalPunRecords(input: { readonly tenantId: string; readonly referenceMonths?: readonly string[]; readonly retrievedAt: string; readonly fetcher?: GmeHistoricalFetcher; readonly archiveUrl?: string }): Promise<GmeHistoricalArchiveResult> {
  const archiveUrl = input.archiveUrl ?? GME_HISTORICAL_ARCHIVE_URL;
  let response: GmeHistoricalFetcherResponse;
  try { response = await (input.fetcher ?? (fetch as unknown as GmeHistoricalFetcher))(archiveUrl, { redirect: "manual", headers: { Accept: "application/zip,application/octet-stream", "User-Agent": "SimulatoreMarketRefresh/1.0 (official-source-import)" } }); } catch { fail("GME_HISTORICAL_DOWNLOAD_FAILED"); }
  if (response.status < 200 || response.status >= 300) fail(`GME_HISTORICAL_HTTP_${response.status}`);
  const archiveBytes = new Uint8Array(await response.arrayBuffer());
  const sourceSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const outerEntries = validateZip(archiveBytes, { maxBytes: MAX_OUTER_ZIP_BYTES, maxEntryCount: MAX_OUTER_ENTRY_COUNT, maxUncompressedBytes: MAX_OUTER_UNCOMPRESSED_BYTES });
  const outer = unzipSync(archiveBytes);
  const workbookEntries = outerEntries.filter((entry) => /\.xlsx$/i.test(entry.name));
  const candidates: { readonly name: string; readonly parsed: { readonly records: readonly ElectricityMonthlyPunRecord[]; readonly intervalCount: number } }[] = [];
  for (const workbookEntry of workbookEntries) {
    try {
      const parsed = parseWorkbook({ xlsxBytes: outer[workbookEntry.name], tenantId: input.tenantId, referenceMonths: input.referenceMonths, retrievedAt: input.retrievedAt, sourceUrl: archiveUrl, sourceSha256 });
      candidates.push({ name: workbookEntry.name, parsed });
    } catch (error) {
      if (error instanceof Error && /GME_(?:XML_EXTERNAL_ENTITY_BLOCKED|ZIP_)/.test(error.message)) throw error;
    }
  }
  if (candidates.length !== 1) fail(candidates.length === 0 ? "GME_PT15_WORKBOOK_MISSING" : "GME_PT15_WORKBOOK_AMBIGUOUS");
  const selected = candidates[0];
  return { records: selected.parsed.records, archiveUrl, sourceSha256, workbookName: selected.name, worksheetName: "Prezzi-Prices", intervalCount: selected.parsed.intervalCount };
}

export function createGmeHistoricalArchiveReader(input: { readonly fetcher?: GmeHistoricalFetcher; readonly archiveUrl?: string } = {}): { load(input: { readonly tenantId: string; readonly referenceMonth: string; readonly retrievedAt: string }): Promise<ElectricityMonthlyPunRecord> } {
  const cache = new Map<string, Promise<GmeHistoricalArchiveResult>>();
  return { async load({ tenantId, referenceMonth, retrievedAt }) {
    let result = cache.get(tenantId);
    if (!result) { result = loadGmeHistoricalPunRecords({ tenantId, retrievedAt, fetcher: input.fetcher, archiveUrl: input.archiveUrl }); cache.set(tenantId, result); }
    const found = (await result).records.find((record) => record.month === referenceMonth); if (!found) fail(`GME_PT15_MONTH_MISSING:${referenceMonth}`); return found;
  } };
}
