import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { ElectricityMonthlyPunRecord, MarketRate } from "../energy/market-data";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createMarketArchive } from "./service.ts";
import type { MarketArchiveRecord, MarketArchiveRepository } from "./types";

export const GME_OFFICIAL_ORIGIN = "https://gme.mercatoelettrico.org/";
export const GME_PUNOP_300_PUBLICATIONS_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioDel300";
export const GME_PUN_BANDS_PUBLICATIONS_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce";
export type GmePunSourceMode = "GME_API" | "GME_OFFICIAL_PUBLICATION";
export type GmePunImportStatus = "IMPORTED" | "SOURCE_BLOCKED";
export type GmeRecordAction = "CREATED" | "REUSED" | "UPDATED";

export interface GmePunImportResult {
  readonly status: GmePunImportStatus;
  readonly mode: GmePunSourceMode;
  readonly reason: string | null;
  readonly action: GmeRecordAction | null;
  readonly record: MarketArchiveRecord | null;
}

export interface GmeOfficialPublicationInput {
  readonly tenantId: string;
  readonly referenceMonth: string;
  readonly publicationText: string;
  readonly sourceReference: string;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly actor?: string;
}

export interface GmeCompletePublicationInput extends GmeOfficialPublicationInput {
  readonly monthlyPublicationText: string;
  readonly bandsPublicationText: string;
  readonly monthlySourceReference?: string;
  readonly bandsSourceReference?: string;
}

export interface GmeFetcherResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export type GmeFetcher = (input: string, init?: RequestInit) => Promise<GmeFetcherResponse>;

export interface GmePunSourceEnvironment {
  readonly GME_PUN_API_URL?: string;
  readonly GME_PUN_API_KEY?: string;
  readonly GME_PUN_SOURCE_MODE?: string;
}

const monthNames: Readonly<Record<string, number>> = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
const rate = (value: number): MarketRate => ({ value, currency: "EUR", unit: "EUR_PER_MWH" });

export function isAllowedGmeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "gme.mercatoelettrico.org";
  } catch {
    return false;
  }
}

export function assertAllowedGmeUrl(value: string): void {
  if (!isAllowedGmeUrl(value)) throw new Error("GME_SOURCE_DOMAIN_BLOCKED");
}

function parseRate(value: string): number | null {
  const raw = value.trim().replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function referenceMonthMatch(text: string, referenceMonth: string): RegExpExecArray | null {
  const [year, month] = referenceMonth.split("-").map(Number);
  const numeric = new RegExp(`\\b${year}[-/.]0?${month}\\b`, "i").exec(text);
  if (numeric) return numeric;
  const monthName = Object.entries(monthNames).find(([, number]) => number === month)?.[0];
  return monthName ? new RegExp(`\\b${monthName}(?:\\s*|[-/.])${year}\\b`, "i").exec(text) : null;
}

function hasReferenceMonth(text: string, referenceMonth: string): boolean {
  return referenceMonthMatch(text, referenceMonth) !== null;
}

function extractRate(text: string, label: string): number | null {
  const expression = new RegExp(`\\b${label}(?:\\b|(?=[0-9]))\\s*[:=]?\\s*([0-9]{1,4}(?:[.,][0-9]{2,6})?)`, "i");
  const match = expression.exec(text);
  return match ? parseRate(match[1]) : null;
}

function extractExplicitBands(text: string): readonly [number, number, number] | null {
  const values = [extractRate(text, "F\\s*1"), extractRate(text, "F\\s*2"), extractRate(text, "F\\s*3")];
  return values.every((value): value is number => value !== null) ? [values[0], values[1], values[2]] : null;
}

function extractBoundedBandRows(text: string, referenceMonth: string): readonly [number, number, number] | null {
  const monthMatch = referenceMonthMatch(text, referenceMonth);
  if (!monthMatch || monthMatch.index === undefined) return null;
  const windowStart = Math.max(0, monthMatch.index - 4000);
  const window = text.slice(windowStart, monthMatch.index + monthMatch[0].length + 1200);
  const pairPattern = /\(\s*\d{1,4}\s+ore?s?\s*\)\s*([0-9]{1,4}(?:[.,][0-9]{2,6})?)/gi;
  const pairs = [...window.matchAll(pairPattern)];
  if (pairs.length !== 3 || !/F\s*1[\s\S]*F\s*2[\s\S]*F\s*3/i.test(window.slice(0, pairs[0].index ?? 0))) return null;
  const values = pairs.map((pair) => parseRate(pair[1]));
  return values.every((value): value is number => value !== null) ? [values[0], values[1], values[2]] : null;
}

function hasMwhUnit(text: string): boolean {
  return /(?:EUR|€|â‚¬|euro|Ã¢â€šÂ¬)\s*(?:\/|\s)\s*M(?:Wh|@h)|\/M(?:Wh|@h)|M(?:Wh|@h)\s*(?:\/|,)?\s*(?:EUR|€|â‚¬|euro|Ã¢â€šÂ¬)/i.test(text);
}

function extractLabelledBandRows(text: string, referenceMonth: string): readonly [number, number, number] | null {
  const monthMatch = referenceMonthMatch(text, referenceMonth);
  if (!monthMatch || monthMatch.index === undefined) return null;
  const window = text.slice(monthMatch.index, monthMatch.index + 1800);
  const values: number[] = [];
  for (const label of ["F\\s*1", "F\\s*2", "F\\s*3"]) {
    const next = new RegExp(`\\b${label}\\b(?:\\s*[:=]\\s*([0-9]{1,4}(?:[.,][0-9]{2,6})?)|[\\s\\S]{0,160}?ore?s?[^0-9]{0,30}([0-9]{1,4}(?:[.,][0-9]{2,6})?))`, "i").exec(window);
    if (!next) return null;
    const value = parseRate(next[1] ?? next[2] ?? "");
    if (value === null) return null;
    values.push(value);
  }
  return [values[0], values[1], values[2]];
}

type PdfObject = { readonly dictionary: string; readonly stream: Uint8Array | null };
type PdfStringToken = { readonly kind: "literal" | "hex"; readonly value: string };
type PdfArrayItem = PdfStringToken | { readonly kind: "word"; readonly value: string };
type PdfToken = { readonly kind: "word"; readonly value: string } | { readonly kind: "string"; readonly value: PdfStringToken } | { readonly kind: "array"; readonly value: readonly PdfArrayItem[] };
type PdfFontMap = { readonly values: ReadonlyMap<number, string>; readonly codeWidth: number };

function pdfBytesFromLatin1(value: string): Uint8Array { return new Uint8Array([...value].map((character) => character.charCodeAt(0) & 255)); }

function pdfFilterNames(dictionary: string): readonly string[] {
  const filter = /\/Filter\s+(\[[\s\S]*?\]|\/\w+)/.exec(dictionary)?.[1] ?? "";
  return [...filter.matchAll(/\/(FlateDecode|Fl|ASCIIHexDecode|AHx|ASCII85Decode|A85)\b/g)].map((match) => match[1]);
}

function decodeAsciiHex(value: Uint8Array): Uint8Array {
  const text = Buffer.from(value).toString("latin1").replace(/\s/g, "").replace(/>.*$/, "");
  const padded = text.length % 2 === 0 ? text : `${text}0`;
  const bytes: number[] = [];
  for (let index = 0; index < padded.length; index += 2) {
    const byte = Number.parseInt(padded.slice(index, index + 2), 16);
    if (!Number.isNaN(byte)) bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

function decodeAscii85(value: Uint8Array): Uint8Array {
  const text = Buffer.from(value).toString("latin1").replace(/^\s*<~/, "").replace(/~>\s*$/, "").replace(/\s/g, "");
  const output: number[] = [];
  for (let index = 0; index < text.length;) {
    if (text[index] === "z") { output.push(0, 0, 0, 0); index += 1; continue; }
    const group = text.slice(index, index + 5); index += group.length;
    if (group.length < 2) break;
    const padded = group.padEnd(5, "u");
    let valueNumber = 0;
    for (const character of padded) valueNumber = valueNumber * 85 + character.charCodeAt(0) - 33;
    const bytes = [(valueNumber >>> 24) & 255, (valueNumber >>> 16) & 255, (valueNumber >>> 8) & 255, valueNumber & 255];
    output.push(...bytes.slice(0, group.length === 5 ? 4 : group.length - 1));
  }
  return new Uint8Array(output);
}

function decodePdfStream(dictionary: string, value: Uint8Array): Uint8Array | null {
  let decoded = value;
  try {
    for (const filter of pdfFilterNames(dictionary)) {
      if (filter === "FlateDecode" || filter === "Fl") decoded = new Uint8Array(inflateSync(decoded));
      else if (filter === "ASCIIHexDecode" || filter === "AHx") decoded = decodeAsciiHex(decoded);
      else if (filter === "ASCII85Decode" || filter === "A85") decoded = decodeAscii85(decoded);
      else return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function pdfObjects(body: Uint8Array): Map<number, PdfObject> {
  const source = Buffer.from(body);
  const text = source.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const markers = [...text.matchAll(/(?:^|[\r\n])(\d+)\s+\d+\s+obj\b/g)];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const objectStart = (marker.index ?? 0) + marker[0].length;
    const nextObject = index + 1 < markers.length ? markers[index + 1].index ?? text.length : text.length;
    const objectEnd = text.indexOf("endobj", objectStart);
    const boundary = objectEnd >= 0 && objectEnd < nextObject ? objectEnd : nextObject;
    const streamMarker = text.indexOf("stream", objectStart);
    const objectId = Number(marker[1]);
    if (streamMarker < 0 || streamMarker >= boundary) {
      objects.set(objectId, { dictionary: text.slice(objectStart, boundary), stream: null });
      continue;
    }
    const dictionary = text.slice(objectStart, streamMarker);
    let dataStart = streamMarker + "stream".length;
    if (source[dataStart] === 13 && source[dataStart + 1] === 10) dataStart += 2;
    else if (source[dataStart] === 10 || source[dataStart] === 13) dataStart += 1;
    const declaredLength = /\/Length\s+(\d+)\b/.exec(dictionary)?.[1];
    const dataEnd = declaredLength
      ? Math.min(source.length, dataStart + Number(declaredLength))
      : Math.max(dataStart, text.indexOf("endstream", dataStart));
    const stream = decodePdfStream(dictionary, source.subarray(dataStart, dataEnd));
    objects.set(objectId, { dictionary, stream });
  }
  return objects;
}

function expandObjectStreams(objects: Map<number, PdfObject>): void {
  for (const object of [...objects.values()]) {
    if (!object.stream || !/\/Type\s*\/ObjStm\b/.test(object.dictionary)) continue;
    const count = Number(/\/N\s+(\d+)\b/.exec(object.dictionary)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)\b/.exec(object.dictionary)?.[1] ?? 0);
    const header = Buffer.from(object.stream.subarray(0, first)).toString("latin1");
    const entries = [...header.matchAll(/(\d+)\s+(\d+)/g)].slice(0, count).map((match) => ({ id: Number(match[1]), offset: Number(match[2]) }));
    for (let index = 0; index < entries.length; index += 1) {
      const start = first + entries[index].offset;
      const end = index + 1 < entries.length ? first + entries[index + 1].offset : object.stream.length;
      objects.set(entries[index].id, { dictionary: Buffer.from(object.stream.subarray(start, end)).toString("latin1").trim(), stream: null });
    }
  }
}

function unicodeFromHex(value: string): string {
  const clean = value.replace(/\s/g, "");
  const bytes = pdfBytesFromLatin1(clean).length % 2 === 0 ? Buffer.from(clean, "hex") : Buffer.from(`${clean}0`, "hex");
  let result = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) result += String.fromCharCode(bytes.readUInt16BE(index));
  return result;
}

function cmapMap(stream: Uint8Array): PdfFontMap {
  const source = Buffer.from(stream).toString("latin1");
  const values = new Map<number, string>();
  const widths = [...source.matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)].map((match) => match[1].length / 2);
  for (const block of source.matchAll(/\d+\s+beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) { widths.push(match[1].length / 2); values.set(Number.parseInt(match[1], 16), unicodeFromHex(match[2])); }
  }
  for (const block of source.matchAll(/\d+\s+beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+(\[[^\]]+\]|<[^>]+>)/g)) {
      const start = Number.parseInt(match[1], 16); const end = Number.parseInt(match[2], 16);
      widths.push(match[1].length / 2);
      const destinations = [...match[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => unicodeFromHex(item[1]));
      if (destinations.length > 1) for (let code = start; code <= end; code += 1) values.set(code, destinations[code - start] ?? "�");
      else {
        const destination = destinations[0] ?? "�"; const base = destination.codePointAt(0) ?? 0;
        for (let code = start; code <= end; code += 1) values.set(code, String.fromCodePoint(base + code - start));
      }
    }
  }
  const codeWidth = Math.max(1, ...widths, ...[...values.keys()].map((value) => Math.ceil(value.toString(16).length / 2)));
  return { values, codeWidth };
}

function fontMaps(objects: Map<number, PdfObject>): Map<string, PdfFontMap> {
  const result = new Map<string, PdfFontMap>();
  for (const object of objects.values()) {
    const fontBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(object.dictionary)?.[1] ?? "";
    for (const match of fontBlock.matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g)) {
      const font = objects.get(Number(match[2])); const reference = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(font?.dictionary ?? "");
      const cmap = reference ? objects.get(Number(reference[1]))?.stream : null;
      if (cmap) result.set(match[1], cmapMap(cmap));
    }
  }
  return result;
}

function pdfTokens(source: string, start = 0, stopAtArrayEnd = false): { readonly tokens: PdfToken[]; readonly next: number } {
  const tokens: PdfToken[] = []; let index = start;
  const skip = (): void => { while (index < source.length) { if (/\s/.test(source[index])) { index += 1; continue; } if (source[index] === "%") { while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1; continue; } break; } };
  while (index < source.length) {
    skip(); if (index >= source.length) break;
    if (stopAtArrayEnd && source[index] === "]") return { tokens, next: index + 1 };
    if (source[index] === "[") {
      const nested = pdfTokens(source, index + 1, true); const items: PdfArrayItem[] = [];
      for (const token of nested.tokens) {
        if (token.kind === "string") items.push(token.value);
        else if (token.kind === "word") items.push({ kind: "word", value: token.value });
        else items.push(...token.value);
      }
      tokens.push({ kind: "array", value: items }); index = nested.next; continue;
    }
    if (source[index] === "(") {
      const begin = ++index; let depth = 1; let value = "";
      while (index < source.length && depth > 0) { const character = source[index++]; if (character === "\\") { value += character + (source[index++] ?? ""); continue; } if (character === "(") depth += 1; if (character === ")") { depth -= 1; if (depth === 0) break; } value += character; }
      tokens.push({ kind: "string", value: { kind: "literal", value } }); void begin; continue;
    }
    if (source[index] === "<" && source[index + 1] !== "<") { index += 1; const begin = index; while (index < source.length && source[index] !== ">") index += 1; tokens.push({ kind: "string", value: { kind: "hex", value: source.slice(begin, index) } }); index += 1; continue; }
    if (source[index] === "]") { index += 1; continue; }
    const begin = index; while (index < source.length && !/[\s()<>\[\]{}/%]/.test(source[index])) index += 1;
    if (index > begin) tokens.push({ kind: "word", value: source.slice(begin, index) }); else index += 1;
  }
  return { tokens, next: index };
}

function literalBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\") { bytes.push(value.charCodeAt(index) & 255); continue; }
    const next = value[++index]; if (next === undefined) break;
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
    if (escapes[next] !== undefined) { bytes.push(escapes[next]); continue; }
    if (next === "\r" && value[index + 1] === "\n") { index += 1; continue; }
    if (next === "\n" || next === "\r") continue;
    if (/[0-7]/.test(next)) { const octal = next + (value.slice(index + 1).match(/^[0-7]{0,2}/)?.[0] ?? ""); bytes.push(Number.parseInt(octal, 8) & 255); index += octal.length - 1; continue; }
    bytes.push(next.charCodeAt(0) & 255);
  }
  return new Uint8Array(bytes);
}

function tokenBytes(token: PdfStringToken): Uint8Array { return token.kind === "literal" ? literalBytes(token.value) : decodeAsciiHex(pdfBytesFromLatin1(token.value)); }

function decodeToken(token: PdfStringToken, map: PdfFontMap | undefined): string {
  const bytes = tokenBytes(token); if (!map || map.values.size === 0) return Buffer.from(bytes).toString("latin1");
  let result = ""; for (let index = 0; index < bytes.length; index += map.codeWidth) { let code = 0; for (let offset = 0; offset < map.codeWidth && index + offset < bytes.length; offset += 1) code = (code << 8) | bytes[index + offset]; result += map.values.get(code) ?? "�"; } return result;
}

function streamText(object: PdfObject, maps: Map<string, PdfFontMap>): string {
  if (!object.stream || /\/Subtype\s*\/Image\b/.test(object.dictionary) || /\/Length1\s+\d+/.test(object.dictionary)) return "";
  const tokens = pdfTokens(Buffer.from(object.stream).toString("latin1")).tokens; let font = ""; const pieces: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; const previous = tokens[index - 1]; if (token.kind !== "word") continue;
    if (token.value === "Tf" && index >= 2 && tokens[index - 2].kind === "word") font = String(tokens[index - 2].value);
    if (token.value === "Tj" && previous?.kind === "string") pieces.push(decodeToken(previous.value, maps.get(font)));
    if (token.value === "TJ" && previous?.kind === "array") for (const item of previous.value) if (item.kind === "literal" || item.kind === "hex") pieces.push(decodeToken(item, maps.get(font)));
  }
  return pieces.join("");
}

function pdfText(body: Uint8Array): string {
  const objects = pdfObjects(body); expandObjectStreams(objects); const maps = fontMaps(objects);
  return [...objects.values()].map((object) => streamText(object, maps)).filter(Boolean).join(" ")
    .replace(/(\d{4})(?=[A-Za-z])/g, "$1 ");
}

function sourceHash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

function publishedPdfText(body: Uint8Array): string {
  const text = pdfText(body);
  if (!text.trim()) throw new Error("GME_PUBLICATION_TEXT_UNAVAILABLE");
  return text;
}

async function fetchOfficialGme(url: string, fetcher: GmeFetcher): Promise<{ readonly url: string; readonly bytes: Uint8Array; readonly contentType: string }> {
  assertAllowedGmeUrl(url);
  const response = await fetcher(url, { redirect: "manual", headers: { Accept: "text/html,application/pdf", "User-Agent": "SimulatoreMarketRefresh/1.0 (official-source-import)" } });
  if (response.status < 200 || response.status >= 300) throw new Error(`GME_HTTP_${response.status}`);
  return { url, bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
}

export async function fetchGmePublicationText(url: string, fetcher: GmeFetcher = fetch as unknown as GmeFetcher): Promise<{ readonly url: string; readonly text: string; readonly sourceSha256: string; readonly contentType: string }> {
  const response = await fetchOfficialGme(url, fetcher);
  return { url: response.url, text: /pdf/i.test(response.contentType) || /\.pdf(?:$|\?)/i.test(response.url) ? publishedPdfText(response.bytes) : new TextDecoder().decode(response.bytes), sourceSha256: sourceHash(response.bytes), contentType: response.contentType };
}

function nextMonth(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
}

export function parseGmeOfficialPublication(input: GmeOfficialPublicationInput): ElectricityMonthlyPunRecord {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(input.referenceMonth)) throw new Error("GME_REFERENCE_MONTH_INVALID");
  assertAllowedGmeUrl(input.sourceReference);
  if (!hasReferenceMonth(input.publicationText, input.referenceMonth)) throw new Error("GME_PUBLICATION_MONTH_MISMATCH");
  if (!hasMwhUnit(input.publicationText)) throw new Error("GME_PUBLICATION_UNIT_MISSING");
  const explicitBands = extractExplicitBands(input.publicationText);
  const boundedBands = explicitBands ?? extractBoundedBandRows(input.publicationText, input.referenceMonth) ?? extractLabelledBandRows(input.publicationText, input.referenceMonth);
  const monthly = extractRate(input.publicationText, "(?:PUN\\s*Index(?:\\s*GME)?|PUN\\s*mensile|Prezzo\\s*unico|PUN\\s*medio)");
  const hasBandEvidence = /\bF\s*[123]\b|\(\s*\d{1,4}\s+ore?s?\s*\)/i.test(input.publicationText);
  if (!boundedBands && (hasBandEvidence || monthly === null)) throw new Error("GME_PUBLICATION_VALUES_MISSING");
  const [f1, f2, f3] = boundedBands ?? [null, null, null];
  return {
    schemaVersion: 1,
    recordId: `gme-pun-${input.referenceMonth}`,
    version: "1",
    parentVersionId: null,
    tenantId: input.tenantId,
    recordType: "MONTHLY_MARKET_DATA",
    vector: "EE",
    index: "PUN",
    month: input.referenceMonth,
    ...(f1 === null ? {} : { f1: rate(f1) }),
    ...(f2 === null ? {} : { f2: rate(f2) }),
    ...(f3 === null ? {} : { f3: rate(f3) }),
    ...(monthly === null ? {} : { monthly: rate(monthly) }),
    source: { sourceId: "GME", name: "GME", url: input.sourceReference, authority: "GME", sourceType: "OFFICIAL" },
    approval: { status: "APPROVED", reviewer: input.actor ?? "GME_OFFICIAL_IMPORT", reviewedAt: input.retrievedAt, decisionId: `gme-official-${input.referenceMonth}` },
    publicationDate: input.publishedAt ?? null,
    effectiveFrom: `${input.referenceMonth}-01`,
    effectiveTo: nextMonth(input.referenceMonth),
  };
}

/** Combines the two official GME publications only after parsing every required value. */
export function parseGmeCompletePublication(input: GmeCompletePublicationInput): ElectricityMonthlyPunRecord {
  const monthlyRecord = parseGmeOfficialPublication({ ...input, publicationText: input.monthlyPublicationText, sourceReference: input.monthlySourceReference ?? input.sourceReference });
  const bandsRecord = parseGmeOfficialPublication({ ...input, publicationText: input.bandsPublicationText, sourceReference: input.bandsSourceReference ?? input.sourceReference });
  if (!monthlyRecord.monthly || !bandsRecord.f1 || !bandsRecord.f2 || !bandsRecord.f3) throw new Error("GME_PUBLICATION_VALUES_MISSING");
  const combinedSha256 = createHash("sha256").update(`${input.monthlyPublicationText}\n---GME-BANDS---\n${input.bandsPublicationText}`, "utf8").digest("hex");
  return { ...monthlyRecord, f1: bandsRecord.f1, f2: bandsRecord.f2, f3: bandsRecord.f3, source: { ...monthlyRecord.source, url: input.sourceReference, sourceSha256: combinedSha256, relatedUrls: [input.monthlySourceReference ?? input.sourceReference, input.bandsSourceReference ?? input.sourceReference] }, approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" } };
}

export function marketRateToEurPerKwh(sourceValue: number, sourceUnit: MarketRate["unit"]): { readonly value: number; readonly sourceValue: number; readonly sourceUnit: MarketRate["unit"]; readonly targetUnit: "EUR_PER_KWH" } {
  if (!Number.isFinite(sourceValue)) throw new Error("MARKET_RATE_INVALID");
  if (sourceUnit !== "EUR_PER_MWH") throw new Error("MARKET_RATE_UNIT_UNSUPPORTED");
  return { value: sourceValue / 1000, sourceValue, sourceUnit, targetUnit: "EUR_PER_KWH" };
}

function rateSignature(value: MarketRate | undefined): readonly [number, string, string] | null {
  return value ? [value.value, value.currency, value.unit] : null;
}

export function sameGmeOfficialRecord(left: MarketArchiveRecord["record"], right: MarketArchiveRecord["record"]): boolean {
  const comparable = (value: MarketArchiveRecord["record"]) => {
    const electricity = value.vector === "EE" ? value : null;
    return {
    recordType: value.recordType,
    vector: value.vector,
    index: value.index,
    month: value.month,
    monthly: rateSignature(electricity?.monthly),
    f1: rateSignature(electricity?.f1),
    f2: rateSignature(electricity?.f2),
    f3: rateSignature(electricity?.f3),
    source: { authority: value.source.authority ?? null, sourceType: value.source.sourceType ?? null, url: value.source.url, sourceId: value.source.sourceId, name: value.source.name },
    publicationDate: value.publicationDate,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export class GmePunSourceAdapter {
  readonly mode: GmePunSourceMode;
  private readonly repository: MarketArchiveRepository;
  private readonly environment: GmePunSourceEnvironment;

  constructor(repository: MarketArchiveRepository, environment: GmePunSourceEnvironment = process.env as GmePunSourceEnvironment) {
    this.repository = repository;
    this.environment = environment;
    this.mode = environment.GME_PUN_API_URL && environment.GME_PUN_API_KEY ? "GME_API" : "GME_OFFICIAL_PUBLICATION";
  }

  async importOfficialPublication(input: GmeOfficialPublicationInput): Promise<GmePunImportResult> {
    if (this.mode === "GME_API") return { status: "SOURCE_BLOCKED", mode: this.mode, reason: "GME_API_ADAPTER_REQUIRES_EXPLICIT_RESPONSE_MAPPING", action: null, record: null };
    if (this.environment.GME_PUN_SOURCE_MODE === "GME_API") return { status: "SOURCE_BLOCKED", mode: "GME_API", reason: "GME_API_CREDENTIALS_NOT_CONFIGURED", action: null, record: null };
    try {
      const parsed = parseGmeOfficialPublication(input);
      const existing = await this.repository.get(input.tenantId, parsed.recordId);
      if (existing) {
        if (existing.status === "APPROVED" && sameGmeOfficialRecord(existing.record, parsed)) return { status: "IMPORTED", mode: "GME_OFFICIAL_PUBLICATION", reason: null, action: "REUSED", record: existing };
        throw new Error("GME_RECORD_CONFLICT");
      }
      const record = await createMarketArchive(this.repository, { tenantId: input.tenantId, record: parsed, archiveId: parsed.recordId, now: input.retrievedAt, actor: input.actor ?? "GME_OFFICIAL_IMPORT" });
      return { status: "IMPORTED", mode: "GME_OFFICIAL_PUBLICATION", reason: null, action: "CREATED", record };
    } catch (error) {
      return { status: "SOURCE_BLOCKED", mode: "GME_OFFICIAL_PUBLICATION", reason: error instanceof Error ? error.message : "GME_PUBLICATION_IMPORT_FAILED", action: null, record: null };
    }
  }
}
