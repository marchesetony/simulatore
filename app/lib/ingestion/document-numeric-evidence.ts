import { createHash } from "node:crypto";
import { inflateRawSync, inflateSync } from "node:zlib";
import type { StructuredBillMonthlyBand } from "./monthly-bands.ts";

export const DOCUMENT_EVIDENCE_SOURCE = "DOCUMENT_TEXT_LAYER" as const;
export const MAX_DOCUMENT_PDF_BYTES = 12 * 1024 * 1024;
export const MAX_DOCUMENT_PDF_OBJECTS = 2_000;
export const MAX_DOCUMENT_PDF_STREAMS = 256;
export const MAX_DOCUMENT_DECOMPRESSED_STREAM_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT_ITEMS = 20_000;
export const MAX_DOCUMENT_LEXEME_LENGTH = 64;
export const MAX_DOCUMENT_PDF_OBJECT_BODY_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENT_FONT_MAPPINGS = 4_096;
export const MAX_DOCUMENT_XOBJECT_REFERENCES = 256;
export const MAX_DOCUMENT_TOTAL_DECOMPRESSED_BYTES = 8 * 1024 * 1024;

export interface DocumentEvidenceLocator {
  readonly section: "CONSUMI";
  readonly table: "MONTHLY_BANDS";
  readonly row: string;
  readonly column: "F1" | "F2" | "F3";
}

export interface DocumentNumericEvidence {
  readonly rawLexeme: string;
  readonly normalizedValue: number;
  readonly sourcePage: number;
  readonly locator: DocumentEvidenceLocator;
  readonly provenance: typeof DOCUMENT_EVIDENCE_SOURCE;
  readonly sourceSha256: string;
}

export interface DocumentMonthlyBandEvidence {
  readonly month: string;
  readonly f1: DocumentNumericEvidence;
  readonly f2: DocumentNumericEvidence;
  readonly f3: DocumentNumericEvidence;
}

export type DocumentEvidenceStatus = "AVAILABLE" | "NOT_AVAILABLE" | "FAIL_CLOSED";

export interface DocumentMonthlyEvidenceResult {
  readonly status: DocumentEvidenceStatus;
  readonly bands: readonly DocumentMonthlyBandEvidence[];
  readonly sourceSha256: string;
  readonly reason?: string;
}

interface PdfTextItem {
  readonly text: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

interface PdfObject {
  readonly id: number;
  readonly body: string;
}

const MONTH_PATTERN = /^(?:0[1-9]|1[0-2])\/(\d{4})$/;
const ISO_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const SIMPLE_DECIMAL_PATTERN = /^\d+(?:[,.]\d+)?$/;
const BAND_NAMES = ["F1", "F2", "F3"] as const;

function boundedText(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function bytesToLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function objectBytes(source: string): Uint8Array {
  const output = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) output[index] = source.charCodeAt(index) & 0xff;
  return output;
}

function sourceHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Strictly accepts a single, unambiguous decimal separator. */
export function normalizeDocumentNumericLexeme(rawLexeme: string): number | null {
  const value = rawLexeme.trim();
  if (value.length === 0 || value.length > MAX_DOCUMENT_LEXEME_LENGTH || !SIMPLE_DECIMAL_PATTERN.test(value)) return null;
  const separator = value.includes(",") ? "," : value.includes(".") ? "." : null;
  if (separator === "." && value.split(".")[1]?.length === 3) return null;
  const normalized = value.replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function parsePdfObjects(pdf: string): readonly PdfObject[] | null {
  const objects: PdfObject[] = [];
  const expression = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(pdf)) !== null) {
    const id = Number(match[1]);
    const body = match[2];
    if (objects.length >= MAX_DOCUMENT_PDF_OBJECTS || body.length > MAX_DOCUMENT_PDF_OBJECT_BODY_BYTES || objects.some((object) => object.id === id)) return null;
    objects.push({ id, body });
  }
  return objects.length > 0 ? objects : null;
}

function referencedContents(body: string): number[] {
  const contents = body.match(/\/Contents\s+(?:\[([^\]]*)\]|(\d+)\s+0\s+R)/);
  if (!contents) return [];
  if (contents[2]) return [Number(contents[2])];
  return [...(contents[1] ?? "").matchAll(/(\d+)\s+0\s+R/g)].map((item) => Number(item[1]));
}

interface ParseBudget { decompressedBytes: number; streamCount: number; }

function extractStream(body: string, budget: ParseBudget): Uint8Array | null {
  budget.streamCount += 1;
  if (budget.streamCount > MAX_DOCUMENT_PDF_STREAMS) return null;
  const start = body.match(/\bstream\r?\n/);
  if (!start) return new Uint8Array(0);
  const contentStart = (start.index ?? 0) + start[0].length;
  const declaredLength = body.match(/\/Length\s+(\d+)/);
  const declaredEnd = declaredLength ? contentStart + Number(declaredLength[1]) : -1;
  const contentEnd = declaredEnd >= contentStart && declaredEnd <= body.length ? declaredEnd : body.indexOf("endstream", contentStart);
  if (contentEnd < contentStart) return null;
  const streamText = declaredLength ? body.slice(contentStart, contentEnd) : body.slice(contentStart, contentEnd).replace(/\r?\n$/, "");
  const compressed = objectBytes(streamText);
  if (compressed.length > MAX_DOCUMENT_DECOMPRESSED_STREAM_BYTES * 2) return null;
  const filters = [...body.matchAll(/\/(FlateDecode|ASCII85Decode|ASCIIHexDecode|LZWDecode|DCTDecode)\b/g)].map((match) => match[1]);
  if (filters.some((filter) => filter !== "FlateDecode")) return null;
  if (filters.length === 0) {
    if (compressed.length > MAX_DOCUMENT_DECOMPRESSED_STREAM_BYTES || budget.decompressedBytes + compressed.length > MAX_DOCUMENT_TOTAL_DECOMPRESSED_BYTES) return null;
    budget.decompressedBytes += compressed.length;
    return compressed;
  }
  for (const inflate of [inflateSync, inflateRawSync]) {
    try {
      const inflated = inflate(compressed, { maxOutputLength: MAX_DOCUMENT_DECOMPRESSED_STREAM_BYTES });
      if (inflated.length > MAX_DOCUMENT_DECOMPRESSED_STREAM_BYTES || budget.decompressedBytes + inflated.length > MAX_DOCUMENT_TOTAL_DECOMPRESSED_BYTES) return null;
      budget.decompressedBytes += inflated.length;
      return inflated;
    } catch { /* try the other bounded zlib representation */ }
  }
  return null;
}

function parseLiteral(raw: string): string | null {
  if (!raw.startsWith("(") || !raw.endsWith(")")) return null;
  let value = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") { value += character; continue; }
    index += 1;
    if (index >= raw.length - 1) return null;
    const escaped = raw[index];
    value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
    if (value.length > MAX_DOCUMENT_LEXEME_LENGTH) return null;
  }
  return value;
}

function unicodeMap(objects: ReadonlyMap<number, PdfObject>, fontId: number, budget: ParseBudget): Map<number, string> {
  const font = objects.get(fontId)?.body ?? "";
  const reference = font.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
  const source = reference ? objects.get(Number(reference[1])) : undefined;
  const stream = source ? extractStream(source.body, budget) : null;
  if (!stream) return new Map();
  const value = bytesToLatin1(stream);
  const result = new Map<number, string>();
  for (const block of value.matchAll(/\d+\s+beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const item of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) result.set(Number.parseInt(item[1], 16), String.fromCodePoint(Number.parseInt(item[2], 16)));
  }
  for (const block of value.matchAll(/\d+\s+beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const item of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) {
      const start = Number.parseInt(item[1], 16); const end = Number.parseInt(item[2], 16); const destination = Number.parseInt(item[3], 16);
      for (let code = start; code <= end; code += 1) {
        if (result.size >= MAX_DOCUMENT_FONT_MAPPINGS) return result;
        result.set(code, String.fromCodePoint(destination + code - start));
      }
    }
  }
  return result;
}

function pageFonts(objects: ReadonlyMap<number, PdfObject>, pageBody: string, budget: ParseBudget): Map<string, Map<number, string>> {
  const result = new Map<string, Map<number, string>>();
  const block = pageBody.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? "";
  for (const match of block.matchAll(/\/(F\w+)\s+(\d+)\s+0\s+R/g)) {
    if (result.size >= 64) break;
    result.set(match[1], unicodeMap(objects, Number(match[2]), budget));
  }
  return result;
}

function referencedXObjects(body: string): number[] {
  const block = body.match(/\/XObject\s*<<([\s\S]*?)>>/)?.[1] ?? "";
  const references = [...block.matchAll(/\/(?:\w+)\s+(\d+)\s+0\s+R/g)];
  return references.length > MAX_DOCUMENT_XOBJECT_REFERENCES ? [] : references.map((item) => Number(item[1]));
}

function pageStreamIds(pageBody: string, objects: ReadonlyMap<number, PdfObject>): readonly number[] {
  const found = new Set<number>();
  const visit = (id: number, depth: number): void => {
    if (found.has(id) || depth > 4) return;
    const object = objects.get(id);
    if (!object) return;
    found.add(id);
    for (const child of referencedXObjects(object.body)) visit(child, depth + 1);
  };
  for (const id of referencedContents(pageBody)) visit(id, 0);
  for (const id of referencedXObjects(pageBody)) visit(id, 0);
  return [...found];
}

function decodeHex(value: string, font: ReadonlyMap<number, string>): string {
  const compact = value.replace(/\s+/g, "");
  let result = "";
  for (let index = 0; index + 3 < compact.length; index += 4) {
    const code = Number.parseInt(compact.slice(index, index + 4), 16);
    result += font.get(code) ?? String.fromCodePoint(code);
    if (result.length > MAX_DOCUMENT_LEXEME_LENGTH) return "";
  }
  return result;
}

function decodeArray(value: string, font: ReadonlyMap<number, string>): string {
  let result = "";
  for (const item of value.matchAll(/<([0-9A-Fa-f\s]+)>|\((?:\\.|[^\\)])*\)/g)) {
    const decoded = item[1] ? decodeHex(item[1], font) : parseLiteral(item[0]);
    if (decoded !== null) result += decoded;
    if (result.length > MAX_DOCUMENT_LEXEME_LENGTH) return "";
  }
  return result;
}

function parseTextItems(stream: Uint8Array, page: number, fonts: ReadonlyMap<string, Map<number, string>>): readonly PdfTextItem[] | null {
  const content = bytesToLatin1(stream);
  const items: PdfTextItem[] = [];
  const expression = /\/(F\w+)\s+[-+\d.]+\s+Tf|(?:[-+\d.]+\s+){4}([-+\d.]+)\s+([-+\d.]+)\s+Tm|([-+\d.]+)\s+([-+\d.]+)\s+Td|<([0-9A-Fa-f\s]+)>\s*Tj|\((?:\\.|[^\\)])*\)\s*Tj|\[([^\]]*)\]\s*TJ/g;
  let font = "";
  let x = 0;
  let y = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(content)) !== null) {
    if (items.length >= MAX_DOCUMENT_TEXT_ITEMS) return null;
    if (match[1]) { font = match[1]; continue; }
    if (match[2]) { x = Number(match[2]); y = Number(match[3]); continue; }
    if (match[4]) { x += Number(match[4]); y += Number(match[5]); continue; }
    const text = match[6] ? decodeHex(match[6], fonts.get(font) ?? new Map()) : match[7] !== undefined ? decodeArray(match[7], fonts.get(font) ?? new Map()) : parseLiteral(match[0].replace(/\s*Tj$/, ""));
    if (text !== null && text.trim()) items.push({ text, page, x, y });
  }
  return items;
}

function monthKey(value: string): string | null {
  const italian = value.match(MONTH_PATTERN);
  if (italian) return `${italian[1]}-${value.slice(0, 2)}`;
  const iso = value.match(ISO_MONTH_PATTERN);
  return iso ? value : null;
}

interface NumericItem extends PdfTextItem {
  readonly value: number;
}

function numericItem(item: PdfTextItem): NumericItem | null {
  const value = normalizeDocumentNumericLexeme(item.text);
  return value === null ? null : { ...item, value };
}

function extractMonthlyRows(items: readonly PdfTextItem[], hash: string): { readonly bands: readonly DocumentMonthlyBandEvidence[]; readonly reason?: string } {
  const rows = new Map<string, { readonly month: string; readonly monthItem: PdfTextItem }>();
  for (const item of items) {
    const month = monthKey(item.text.trim());
    if (!month) continue;
    if (rows.has(month)) return { bands: [], reason: "DUPLICATE_MONTH_ROW" };
    rows.set(month, { month, monthItem: item });
  }
  if (rows.size === 0) return { bands: [] };
  const bands: DocumentMonthlyBandEvidence[] = [];
  for (const row of rows.values()) {
    const candidates = items
      .filter((item) => item.page === row.monthItem.page && Math.abs(item.y - row.monthItem.y) <= 0.5 && item.x > row.monthItem.x)
      .map(numericItem)
      .filter((item): item is NumericItem => item !== null)
      .sort((left, right) => left.x - right.x);
    let selected: readonly NumericItem[] = candidates;
    const headers = BAND_NAMES.map((name) => items.filter((item) => item.page === row.monthItem.page && item.text.trim().toUpperCase() === name));
    if (!headers.every((itemsForBand) => itemsForBand.length > 0)) return { bands: [], reason: `MISSING_BAND_HEADERS:${row.month}` };
    if (candidates.length > 3) {
      // Prefer a complete F1/F2/F3 header cluster. This binds the row to
      // semantic columns instead of selecting an arbitrary nearby number.
      const options: { readonly values: readonly NumericItem[]; readonly score: number }[] = [];
      for (let start = 0; start <= candidates.length - 3; start += 1) {
        const values = candidates.slice(start, start + 3);
        const score = values.reduce((total, value, index) => total + Math.min(...headers[index].map((header) => Math.abs(header.x - value.x))), 0);
        options.push({ values, score });
      }
      // Some compatible tables omit visible headers but have a single
      // auxiliary column and a trailing total. That exact bounded shape is
      // accepted; any other extra-column shape remains ambiguous.
      if (options.length === 0 && candidates.length === 5) options.push({ values: candidates.slice(1, 4), score: 0 });
      options.sort((left, right) => left.score - right.score);
      if (options.length === 0 || options[1] && Math.abs(options[1].score - options[0].score) < 0.001) return { bands: [], reason: `AMBIGUOUS_MONTH_ROW:${row.month}` };
      selected = options[0].values;
    }
    if (selected.length !== 3) return { bands: [], reason: `AMBIGUOUS_MONTH_ROW:${row.month}` };
    const evidence = {} as Record<"f1" | "f2" | "f3", DocumentNumericEvidence>;
    for (const [index, name] of BAND_NAMES.entries()) {
      const candidate = selected[index];
      evidence[name.toLowerCase() as "f1" | "f2" | "f3"] = {
        rawLexeme: boundedText(candidate.text.trim(), MAX_DOCUMENT_LEXEME_LENGTH),
        normalizedValue: candidate.value,
        sourcePage: candidate.page,
        locator: { section: "CONSUMI", table: "MONTHLY_BANDS", row: row.month, column: name },
        provenance: DOCUMENT_EVIDENCE_SOURCE,
        sourceSha256: hash,
      };
    }
    bands.push({ month: row.month, f1: evidence.f1, f2: evidence.f2, f3: evidence.f3 });
  }
  return { bands };
}

/**
 * Reads only bounded PDF text streams in memory. It never extracts files to disk
 * and never returns document text; callers receive only table-shaped numeric evidence.
 */
export function extractDocumentMonthlyBandEvidence(bytes: Uint8Array): DocumentMonthlyEvidenceResult {
  const hash = sourceHash(bytes);
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_PDF_BYTES || !bytesToLatin1(bytes.slice(0, 8)).startsWith("%PDF-")) return { status: "NOT_AVAILABLE", bands: [], sourceSha256: hash, reason: "TEXT_LAYER_UNAVAILABLE" };
  const pdf = bytesToLatin1(bytes);
  const objects = parsePdfObjects(pdf);
  if (!objects) return { status: "FAIL_CLOSED", bands: [], sourceSha256: hash, reason: "PDF_OBJECTS_INVALID" };
  const byId = new Map(objects.map((object) => [object.id, object]));
  const pages = objects.filter((object) => /\/Type\s*\/Page(?:\s|\/|$)/.test(object.body) && !/\/Type\s*\/Pages(?:\s|\/|$)/.test(object.body));
  if (pages.length === 0 || pages.length > 200) return { status: "NOT_AVAILABLE", bands: [], sourceSha256: hash, reason: "TEXT_LAYER_UNAVAILABLE" };
  const items: PdfTextItem[] = [];
  const budget: ParseBudget = { decompressedBytes: 0, streamCount: 0 };
  for (const [pageIndex, page] of pages.entries()) {
    for (const contentId of pageStreamIds(page.body, byId)) {
      const contentObject = byId.get(contentId);
      if (!contentObject) return { status: "FAIL_CLOSED", bands: [], sourceSha256: hash, reason: "CONTENTS_REFERENCE_INVALID" };
      if (/\/Subtype\s*\/Image\b/.test(contentObject.body)) continue;
      const stream = extractStream(contentObject.body, budget);
      if (stream === null) return { status: "FAIL_CLOSED", bands: [], sourceSha256: hash, reason: "STREAM_INVALID" };
      if (stream.length === 0) continue;
      const fonts = pageFonts(byId, page.body, budget);
      for (const [name, map] of pageFonts(byId, contentObject.body, budget)) fonts.set(name, map);
      const parsed = parseTextItems(stream, pageIndex + 1, fonts);
      if (parsed === null) return { status: "FAIL_CLOSED", bands: [], sourceSha256: hash, reason: "TEXT_ITEM_LIMIT" };
      items.push(...parsed);
      if (items.length > MAX_DOCUMENT_TEXT_ITEMS) return { status: "FAIL_CLOSED", bands: [], sourceSha256: hash, reason: "TEXT_ITEM_LIMIT" };
    }
  }
  if (items.length === 0) return { status: "NOT_AVAILABLE", bands: [], sourceSha256: hash, reason: "TEXT_LAYER_UNAVAILABLE" };
  const extracted = extractMonthlyRows(items, hash);
  if (extracted.reason) return { status: "FAIL_CLOSED", bands: [], sourceSha256: hash, reason: extracted.reason };
  return extracted.bands.length === 0
    ? { status: "NOT_AVAILABLE", bands: [], sourceSha256: hash, reason: "MONTHLY_TABLE_NOT_FOUND" }
    : { status: "AVAILABLE", bands: extracted.bands, sourceSha256: hash };
}

export type MonthlyBandDocumentReconciliationStatus = "DOCUMENT_GROUNDED" | "NOT_AVAILABLE" | "FAIL_CLOSED";

export interface MonthlyBandDocumentReconciliation {
  readonly status: MonthlyBandDocumentReconciliationStatus;
  readonly monthlyBands: readonly StructuredBillMonthlyBand[] | undefined;
  readonly evidence: readonly DocumentMonthlyBandEvidence[];
  readonly precisionMismatch: boolean;
}

/** The document value wins only after exact month/band key reconciliation. */
export function reconcileMonthlyBandsWithDocumentEvidence(providerBands: readonly StructuredBillMonthlyBand[] | undefined, evidence: readonly DocumentMonthlyBandEvidence[]): MonthlyBandDocumentReconciliation {
  if (!providerBands || providerBands.length === 0 || evidence.length === 0) return { status: "NOT_AVAILABLE", monthlyBands: undefined, evidence: [], precisionMismatch: false };
  const providers = new Map(providerBands.map((band) => [band.month, band]));
  const documents = new Map(evidence.map((band) => [band.month, band]));
  if (providers.size !== providerBands.length || documents.size !== evidence.length || [...providers.keys()].some((month) => !documents.has(month))) return { status: "FAIL_CLOSED", monthlyBands: undefined, evidence: [], precisionMismatch: false };
  let precisionMismatch = false;
  const monthlyBands: StructuredBillMonthlyBand[] = [];
  for (const provider of providerBands) {
    const document = documents.get(provider.month);
    if (!document) return { status: "FAIL_CLOSED", monthlyBands: undefined, evidence: [], precisionMismatch: false };
    const documentValues = [document.f1, document.f2, document.f3];
    const providerValues = [provider.f1, provider.f2, provider.f3];
    const seenKeys = new Set<string>();
    const values = documentValues.map((value, index) => {
      const key = `${document.month}:${BAND_NAMES[index]}`;
      if (seenKeys.has(key) || value.locator.row !== document.month || value.locator.column !== BAND_NAMES[index] || value.provenance !== DOCUMENT_EVIDENCE_SOURCE) return null;
      seenKeys.add(key);
      return value.normalizedValue;
    });
    if (document.month !== provider.month || values.some((value) => value === null || !Number.isFinite(value) || value < 0) || providerValues.some((value) => !Number.isFinite(value) || value < 0)) return { status: "FAIL_CLOSED", monthlyBands: undefined, evidence: [], precisionMismatch: false };
    if (values.some((value, index) => value !== providerValues[index])) precisionMismatch = true;
    monthlyBands.push({ month: document.month, f1: values[0] as number, f2: values[1] as number, f3: values[2] as number });
  }
  return { status: "DOCUMENT_GROUNDED", monthlyBands, evidence: providerBands.map((provider) => documents.get(provider.month) as DocumentMonthlyBandEvidence), precisionMismatch };
}
