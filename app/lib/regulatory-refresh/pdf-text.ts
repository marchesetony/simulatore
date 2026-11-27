import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { constants as zlibConstants, inflateRawSync, inflateSync } from "node:zlib";
import { inflateSync as fflateInflate } from "fflate";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { documentTextItems, type DocumentEvidenceStatus } from "../ingestion/document-numeric-evidence.ts";

// Tony (30/10): "ancora errori". 338/2026, 343/2026 and Terna's TIDE Q4 gave an empty text: the bill reader
// (documentTextItems) is strict on purpose and reads only the plain PDFs our bills use. Official documents come from
// LibreOffice/Word/Acrobat with indirect /Length, object streams, xref streams with predictors, Type0 fonts,
// incremental updates and encryption with an empty user password, so they are read here, with wider but bounded budgets.

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

/** Copies the objects packed in PDF object streams out as plain objects, so the text-layer reader finds pages and fonts. */
export function expandPdfObjectStreams(bytes: Uint8Array): Uint8Array {
  const pdf = latin1(bytes);
  const extra: string[] = [];
  for (const match of pdf.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)stream\r?\n/g)) {
    const dictionary = match[2];
    if (!/\/Type\s*\/ObjStm\b/.test(dictionary) || !/\/FlateDecode\b/.test(dictionary)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const length = Number(dictionary.match(/\/Length\s+(\d+)(?![\d\s]*R)/)?.[1] ?? NaN);
    const end = Number.isFinite(length) ? start + length : pdf.indexOf("endstream", start);
    if (end <= start) continue;
    let content: string;
    try { content = latin1(fflateInflate(bytes.subarray(start + 2, end))); } catch { continue; }
    const count = Number(dictionary.match(/\/N\s+(\d+)/)?.[1] ?? 0); const first = Number(dictionary.match(/\/First\s+(\d+)/)?.[1] ?? 0);
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count && index * 2 + 1 < header.length; index += 1) {
      const id = header[index * 2]; const offset = header[index * 2 + 1];
      const next = index + 1 < count ? header[(index + 1) * 2 + 1] : content.length - first;
      extra.push(`\n${id} 0 obj\n${content.slice(first + offset, first + next)}\nendobj\n`);
    }
  }
  if (extra.length === 0) return bytes;
  return new Uint8Array([...bytes, ...Buffer.from(extra.join(""), "latin1")]);
}

const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_DECODED_BYTES = 256 * 1024 * 1024;
const MAX_PAGES = 2_000;
const MAX_TEXT_CHARS = 4_000_000;
const MAX_FORM_DEPTH = 8;
const MAX_FORM_RUNS = 20_000;
const MAX_FONT_MAPPINGS = 200_000;

class PdfName { name: string; constructor(name: string) { this.name = name; } }
class PdfRef { id: number; constructor(id: number) { this.id = id; } }
class PdfString { bytes: string; constructor(bytes: string) { this.bytes = bytes; } }
type PdfDict = Map<string, PdfValue>;
/** A plain string is a keyword (content operator, "endobj", or a closing ">>" / "]"). */
type PdfValue = number | boolean | null | string | PdfName | PdfRef | PdfString | PdfValue[] | PdfDict;

const CHAR = new Uint8Array(256);
for (const code of [0, 9, 10, 12, 13, 32]) CHAR[code] = 1;
for (const char of "()<>[]{}/%") CHAR[char.charCodeAt(0)] = 2;
const regular = (s: string, index: number): boolean => index < s.length && CHAR[s.charCodeAt(index) & 255] === 0;
const hexBytes = (hex: string): string => { let out = ""; const even = hex.length % 2 ? `${hex}0` : hex; for (let index = 0; index < even.length; index += 2) out += String.fromCharCode(Number.parseInt(even.slice(index, index + 2), 16)); return out; };

/** PDF tokens and objects of a latin1 string: dictionaries, arrays, names, strings, numbers, references (when `refs`). */
class Lexer {
  s: string; pos: number; refs: boolean;
  constructor(s: string, refs: boolean, pos = 0) { this.s = s; this.refs = refs; this.pos = pos; }
  skip(): void {
    const s = this.s;
    while (this.pos < s.length) {
      const code = s.charCodeAt(this.pos);
      if (CHAR[code & 255] === 1) this.pos += 1;
      else if (code === 37) { while (this.pos < s.length && s[this.pos] !== "\n" && s[this.pos] !== "\r") this.pos += 1; }
      else break;
    }
  }
  value(depth = 0): PdfValue | undefined {
    this.skip();
    const s = this.s;
    if (this.pos >= s.length) return undefined;
    const char = s[this.pos];
    if (char === "/") { let end = this.pos + 1; while (regular(s, end)) end += 1; const raw = s.slice(this.pos + 1, end); this.pos = end; return new PdfName(raw.includes("#") ? raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))) : raw); }
    if (char === "(") return this.literal();
    if (char === "<" && s[this.pos + 1] === "<") {
      this.pos += 2; const dict: PdfDict = new Map();
      while (depth < 64) {
        const key = this.value(depth + 1);
        if (key === undefined || key === ">>") break;
        if (!(key instanceof PdfName)) continue;
        const item = this.value(depth + 1);
        if (item === undefined || item === ">>") break;
        dict.set(key.name, item);
      }
      return dict;
    }
    if (char === "<") { const end = s.indexOf(">", this.pos); const stop = end < 0 ? s.length : end; const hex = s.slice(this.pos + 1, stop).replace(/[^0-9A-Fa-f]/g, ""); this.pos = stop + 1; return new PdfString(hexBytes(hex)); }
    if (char === ">") { const double = s[this.pos + 1] === ">"; this.pos += double ? 2 : 1; return double ? ">>" : ">"; }
    if (char === "[") { this.pos += 1; const items: PdfValue[] = []; while (depth < 64) { const item = this.value(depth + 1); if (item === undefined || item === "]") break; items.push(item); } return items; }
    if (CHAR[s.charCodeAt(this.pos) & 255] === 2) { this.pos += 1; return char; }
    let end = this.pos; while (regular(s, end)) end += 1;
    const token = s.slice(this.pos, end); this.pos = end;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      if (this.refs && /^\d+$/.test(token)) { const ref = /^\s+\d+\s+R(?![^\s()<>[\]{}/%])/.exec(s.slice(end, end + 24)); if (ref) { this.pos = end + ref[0].length; return new PdfRef(Number(token)); } }
      return Number(token);
    }
    return token === "true" ? true : token === "false" ? false : token === "null" ? null : token;
  }
  literal(): PdfString {
    const s = this.s; let index = this.pos + 1; let depth = 1; const out: string[] = [];
    while (index < s.length) {
      const char = s[index];
      if (char === "\\") {
        const next = s[index + 1]; index += 2;
        if (next === undefined) break;
        const escape = "nrtbf".indexOf(next);
        if (escape >= 0) out.push("\n\r\t\b\f"[escape]);
        else if (next >= "0" && next <= "7") { let octal = next; while (octal.length < 3 && s[index] >= "0" && s[index] <= "7") { octal += s[index]; index += 1; } out.push(String.fromCharCode(Number.parseInt(octal, 8) & 255)); }
        else if (next === "\r") { if (s[index] === "\n") index += 1; }
        else if (next !== "\n") out.push(next);
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")" && (depth -= 1) === 0) { index += 1; break; }
      out.push(char); index += 1;
    }
    this.pos = index;
    return new PdfString(out.join(""));
  }
}

interface PdfDef { readonly id: number; readonly gen: number; readonly pos: number; readonly value: PdfValue; readonly streamStart?: number; readonly streamEnd?: number }
interface Crypt { decrypt(data: Buffer, def: PdfDef): Buffer }
interface Context { readonly s: string; readonly objects: Map<number, PdfDef>; crypt?: Crypt; decoded: number; readonly issues: Map<string, number>; readonly fonts: Map<PdfValue, FontDecoder>; readonly forms: Map<number, string | null>; formRuns: number }

const issue = (ctx: Context, reason: string): void => { ctx.issues.set(reason, (ctx.issues.get(reason) ?? 0) + 1); };
const resolve = (ctx: Context, value: PdfValue | undefined, depth = 0): PdfValue | undefined => value instanceof PdfRef ? (depth > 16 ? undefined : resolve(ctx, ctx.objects.get(value.id)?.value, depth + 1)) : value;
const dictOf = (ctx: Context, value: PdfValue | undefined): PdfDict | undefined => { const resolved = resolve(ctx, value); return resolved instanceof Map ? resolved : undefined; };
const nameOf = (ctx: Context, value: PdfValue | undefined): string | undefined => { const resolved = resolve(ctx, value); return resolved instanceof PdfName ? resolved.name : undefined; };
const numberOf = (ctx: Context, value: PdfValue | undefined): number | undefined => { const resolved = resolve(ctx, value); return typeof resolved === "number" ? resolved : undefined; };
const arrayOf = (ctx: Context, value: PdfValue | undefined): PdfValue[] => { const resolved = resolve(ctx, value); return Array.isArray(resolved) ? resolved : resolved === undefined || resolved === null ? [] : [resolved]; };
const bytesOf = (ctx: Context, value: PdfValue | undefined): Buffer => { const resolved = resolve(ctx, value); return Buffer.from(resolved instanceof PdfString ? resolved.bytes : "", "latin1"); };

/** Every "N G obj" of the file in order; stream data is skipped by its direct /Length or up to "endstream". */
function scanObjects(s: string): PdfDef[] {
  const defs: PdfDef[] = [];
  const header = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(s)) !== null) {
    const lexer = new Lexer(s, true, header.lastIndex);
    const value = lexer.value() ?? null;
    lexer.skip();
    const base = { id: Number(match[1]), gen: Number(match[2]), pos: match.index, value };
    if (!s.startsWith("stream", lexer.pos) || regular(s, lexer.pos + 6)) { defs.push(base); header.lastIndex = Math.max(lexer.pos, header.lastIndex); continue; }
    let start = lexer.pos + 6;
    if (s[start] === "\r") start += 1;
    if (s[start] === "\n") start += 1;
    const length = value instanceof Map ? value.get("Length") : undefined;
    const declared = typeof length === "number" && length >= 0 && /^\s*endstream/.test(s.slice(start + length, start + length + 64)) ? start + length : -1;
    const found = s.indexOf("endstream", start);
    const end = declared >= 0 ? declared : found < 0 ? s.length : found;
    defs.push({ ...base, streamStart: start, streamEnd: end });
    header.lastIndex = end;
  }
  return defs;
}

/** The raw (still encoded) bytes of a stream, with an indirect /Length checked against "endstream". */
function rawStream(ctx: Context, def: PdfDef): Buffer {
  const start = def.streamStart ?? 0; let end = def.streamEnd ?? start;
  const length = numberOf(ctx, def.value instanceof Map ? def.value.get("Length") : undefined);
  if (length !== undefined && length >= 0 && start + length <= end && /^\s*$/.test(ctx.s.slice(start + length, end))) end = start + length;
  else if (ctx.s[end - 1] === "\n") end -= ctx.s[end - 2] === "\r" ? 2 : 1;
  else if (ctx.s[end - 1] === "\r") end -= 1;
  return Buffer.from(ctx.s.slice(start, end), "latin1");
}

function inflate(data: Buffer): Buffer {
  const options = { maxOutputLength: MAX_STREAM_BYTES };
  const attempts = [() => inflateSync(data, options), () => inflateSync(data, { ...options, finishFlush: zlibConstants.Z_SYNC_FLUSH }), () => inflateRawSync(data, options), () => inflateRawSync(data, { ...options, finishFlush: zlibConstants.Z_SYNC_FLUSH })];
  for (const attempt of attempts) { try { const out = attempt(); if (out.length > 0) return out; } catch { /* the next zlib representation */ } }
  throw new Error("FLATE_INVALID");
}

function lzwDecode(data: Buffer, earlyChange: number): Buffer {
  const out: number[] = []; let table: number[][] = []; let width = 9; let previous: number[] | null = null; let bit = 0;
  const reset = () => { table = Array.from({ length: 258 }, (_, code) => [code]); width = 9; previous = null; };
  reset();
  while (bit + width <= data.length * 8) {
    let code = 0;
    for (let index = 0; index < width; index += 1, bit += 1) code = (code << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
    if (code === 256) { reset(); continue; }
    if (code === 257) break;
    const prior: number[] | null = previous;
    const entry: number[] | undefined = code < table.length && code > 257 || code < 256 ? table[code] : prior && code === table.length ? [...prior, prior[0]] : undefined;
    if (!entry) throw new Error("LZW_INVALID");
    for (const byte of entry) out.push(byte);
    if (out.length > MAX_STREAM_BYTES) throw new Error("STREAM_TOO_LARGE");
    if (prior && table.length < 4096) table.push([...prior, entry[0]]);
    previous = entry;
    if (table.length + earlyChange >= 1 << width && width < 12) width += 1;
  }
  return Buffer.from(out);
}

function ascii85(data: Buffer): Buffer {
  let body = data.toString("latin1").replace(/\s+/g, "");
  if (body.startsWith("<~")) body = body.slice(2);
  const stop = body.indexOf("~>"); if (stop >= 0) body = body.slice(0, stop);
  const out: number[] = []; const group: number[] = [];
  const flush = (count: number) => { let value = 0; for (const digit of group) value = value * 85 + digit; for (let index = 0; index < count - 1; index += 1) out.push(Math.floor(value / 256 ** (3 - index)) % 256); group.length = 0; };
  for (const char of body) {
    if (char === "z" && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    const digit = char.charCodeAt(0) - 33;
    if (digit < 0 || digit > 84) throw new Error("ASCII85_INVALID");
    group.push(digit); if (group.length === 5) flush(5);
  }
  if (group.length > 0) { const count = group.length; while (group.length < 5) group.push(84); flush(count); }
  return Buffer.from(out);
}

function runLength(data: Buffer): Buffer {
  const out: number[] = [];
  for (let index = 0; index < data.length;) {
    const length = data[index];
    if (length === 128) break;
    if (length < 128) { for (let copy = 0; copy <= length; copy += 1) out.push(data[index + 1 + copy]); index += length + 2; }
    else { for (let copy = 0; copy < 257 - length; copy += 1) out.push(data[index + 1]); index += 2; }
  }
  return Buffer.from(out);
}

/** PNG (10-15) and TIFF (2) predictors of /DecodeParms, as xref and object streams of modern exporters use. */
function predict(ctx: Context, data: Buffer, parms: PdfDict | undefined): Buffer {
  const predictor = numberOf(ctx, parms?.get("Predictor")) ?? 1;
  if (predictor <= 1) return data;
  const colors = numberOf(ctx, parms?.get("Colors")) ?? 1; const bits = numberOf(ctx, parms?.get("BitsPerComponent")) ?? 8; const columns = numberOf(ctx, parms?.get("Columns")) ?? 1;
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8)); const rowLength = Math.ceil((colors * bits * columns) / 8);
  if (predictor === 2) {
    if (bits !== 8) return data;
    const out = Buffer.from(data);
    for (let row = 0; row < out.length; row += rowLength) for (let index = bpp; index < rowLength && row + index < out.length; index += 1) out[row + index] = (out[row + index] + out[row + index - bpp]) & 255;
    return out;
  }
  const out = Buffer.alloc(Math.floor(data.length / (rowLength + 1)) * rowLength); let previous = Buffer.alloc(rowLength);
  for (let row = 0; (row + 1) * (rowLength + 1) <= data.length; row += 1) {
    const type = data[row * (rowLength + 1)]; const line = Buffer.from(data.subarray(row * (rowLength + 1) + 1, (row + 1) * (rowLength + 1)));
    for (let index = 0; index < rowLength; index += 1) {
      const left = index >= bpp ? line[index - bpp] : 0; const up = previous[index]; const upLeft = index >= bpp ? previous[index - bpp] : 0;
      const paeth = () => { const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft); return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; };
      line[index] = (line[index] + (type === 1 ? left : type === 2 ? up : type === 3 ? Math.floor((left + up) / 2) : type === 4 ? paeth() : 0)) & 255;
    }
    line.copy(out, row * rowLength); previous = line;
  }
  return out;
}

/** The decoded bytes of a stream object (decrypted, then every filter in order); null with the reason counted. */
function streamData(ctx: Context, def: PdfDef): Buffer | null {
  const dict = def.value instanceof Map ? def.value : new Map<string, PdfValue>();
  try {
    let data = rawStream(ctx, def);
    if (ctx.crypt && nameOf(ctx, dict.get("Type")) !== "XRef") data = ctx.crypt.decrypt(data, def);
    const filters = arrayOf(ctx, dict.get("Filter")); const parms = arrayOf(ctx, dict.get("DecodeParms") ?? dict.get("DP"));
    for (const [index, filter] of filters.entries()) {
      const name = nameOf(ctx, filter) ?? ""; const parm = dictOf(ctx, parms[index]);
      if (name === "FlateDecode" || name === "Fl") data = predict(ctx, inflate(data), parm);
      else if (name === "LZWDecode" || name === "LZW") data = predict(ctx, lzwDecode(data, numberOf(ctx, parm?.get("EarlyChange")) ?? 1), parm);
      else if (name === "ASCII85Decode" || name === "A85") data = ascii85(data);
      else if (name === "ASCIIHexDecode" || name === "AHx") data = Buffer.from(hexBytes(data.toString("latin1").split(">")[0].replace(/[^0-9A-Fa-f]/g, "")), "latin1");
      else if (name === "RunLengthDecode" || name === "RL") data = runLength(data);
      else if (name !== "Crypt") throw new Error(`FILTER_UNSUPPORTED_${name}`);
    }
    if (data.length > MAX_STREAM_BYTES || (ctx.decoded += data.length) > MAX_TOTAL_DECODED_BYTES) throw new Error("STREAM_BUDGET");
    return data;
  } catch (error) { issue(ctx, error instanceof Error ? error.message : "STREAM_INVALID"); return null; }
}

// Standard security handler with the empty user password: what a reader does to open a PDF protected only against
// copying or editing (RC4 40-128, AES-128, AES-256 R5/R6).
const PASSWORD_PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = (...parts: Buffer[]): Buffer => createHash("md5").update(Buffer.concat(parts)).digest();
function rc4(key: Buffer, data: Buffer): Buffer {
  const box = Uint8Array.from({ length: 256 }, (_, index) => index); let j = 0;
  for (let index = 0; index < 256; index += 1) { j = (j + box[index] + key[index % key.length]) & 255; [box[index], box[j]] = [box[j], box[index]]; }
  const out = Buffer.alloc(data.length); let i = 0; j = 0;
  for (let index = 0; index < data.length; index += 1) { i = (i + 1) & 255; j = (j + box[i]) & 255; [box[i], box[j]] = [box[j], box[i]]; out[index] = data[index] ^ box[(box[i] + box[j]) & 255]; }
  return out;
}
function aesDecrypt(bits: 128 | 256, key: Buffer, data: Buffer): Buffer {
  if (data.length < 32) return Buffer.alloc(0);
  const body = data.subarray(16, 16 + Math.floor((data.length - 16) / 16) * 16);
  const decipher = createDecipheriv(`aes-${bits}-cbc`, key, data.subarray(0, 16)); decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(body), decipher.final()]); const pad = out[out.length - 1];
  return pad >= 1 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
}
function hash2B(password: Buffer, salt: Buffer, userKey: Buffer): Buffer {
  let key = createHash("sha256").update(Buffer.concat([password, salt, userKey])).digest(); let block = Buffer.alloc(0);
  for (let round = 0; round < 64 || block[block.length - 1] > round - 32; round += 1) {
    const cipher = createCipheriv("aes-128-cbc", key.subarray(0, 16), key.subarray(16, 32)); cipher.setAutoPadding(false);
    block = Buffer.concat([cipher.update(Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([password, key, userKey])))), cipher.final()]);
    let sum = 0; for (let index = 0; index < 16; index += 1) sum += block[index];
    key = createHash(["sha256", "sha384", "sha512"][sum % 3]).update(block).digest();
  }
  return key.subarray(0, 32);
}

function securityHandler(ctx: Context, encrypt: PdfDict, id0: Buffer): Crypt | string {
  if (nameOf(ctx, encrypt.get("Filter")) !== "Standard") return `ENCRYPTION_UNSUPPORTED:${nameOf(ctx, encrypt.get("Filter")) ?? "?"}`;
  const version = numberOf(ctx, encrypt.get("V")) ?? 0; const revision = numberOf(ctx, encrypt.get("R")) ?? 2;
  const owner = bytesOf(ctx, encrypt.get("O")); const user = bytesOf(ctx, encrypt.get("U"));
  const filter = version >= 4 ? (nameOf(ctx, encrypt.get("StmF")) ?? "Identity") : "";
  const method = version < 4 ? "V2" : filter === "Identity" ? "None" : nameOf(ctx, dictOf(ctx, dictOf(ctx, encrypt.get("CF"))?.get(filter))?.get("CFM")) ?? "None";
  if (method === "None") return { decrypt: (data) => data };
  if (revision >= 5) {
    const empty = Buffer.alloc(0); const digest = (salt: Buffer) => revision >= 6 ? hash2B(empty, salt, empty) : createHash("sha256").update(salt).digest();
    if (user.length < 48 || !digest(user.subarray(32, 40)).equals(user.subarray(0, 32))) return "ENCRYPTED_PASSWORD_REQUIRED";
    const decipher = createDecipheriv("aes-256-cbc", digest(user.subarray(40, 48)), Buffer.alloc(16)); decipher.setAutoPadding(false);
    const fileKey = Buffer.concat([decipher.update(bytesOf(ctx, encrypt.get("UE")).subarray(0, 32)), decipher.final()]);
    return { decrypt: (data) => aesDecrypt(256, fileKey, data) };
  }
  const aes = method === "AESV2"; if (!aes && method !== "V2") return `ENCRYPTION_UNSUPPORTED:${method}`;
  const keyLength = revision === 2 ? 5 : aes ? 16 : Math.min(16, Math.max(5, (numberOf(ctx, encrypt.get("Length")) ?? 40) / 8));
  const permissions = Buffer.alloc(4); permissions.writeInt32LE((numberOf(ctx, encrypt.get("P")) ?? 0) | 0);
  let key = md5(PASSWORD_PAD, owner.subarray(0, 32), permissions, id0, revision >= 4 && resolve(ctx, encrypt.get("EncryptMetadata")) === false ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0)).subarray(0, keyLength);
  if (revision >= 3) for (let round = 0; round < 50; round += 1) key = md5(key).subarray(0, keyLength);
  let check = revision === 2 ? rc4(key, PASSWORD_PAD) : rc4(key, md5(PASSWORD_PAD, id0));
  if (revision >= 3) for (let round = 1; round <= 19; round += 1) check = rc4(Buffer.from(key.map((byte) => byte ^ round)), check);
  if (!check.subarray(0, revision === 2 ? 32 : 16).equals(user.subarray(0, revision === 2 ? 32 : 16))) return "ENCRYPTED_PASSWORD_REQUIRED";
  return {
    decrypt: (data, def) => {
      const objectKey = md5(key, Buffer.from([def.id & 255, (def.id >> 8) & 255, (def.id >> 16) & 255, def.gen & 255, (def.gen >> 8) & 255]), aes ? Buffer.from("sAlT", "latin1") : Buffer.alloc(0)).subarray(0, Math.min(keyLength + 5, 16));
      return aes ? aesDecrypt(128, objectKey, data) : rc4(objectKey, data);
    },
  };
}

// Glyph names of the WinAnsi positions 0x20-0xFF ("-" where none), for fonts that remap codes with /Differences.
const WIN_ANSI_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const WIN_ANSI = Array.from({ length: 256 }, (_, code) => code < 32 || code === 127 ? "" : code >= 128 && code < 160 ? WIN_ANSI_HIGH[code - 128] : String.fromCharCode(code));
const MAC_ROMAN_HIGH = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
const MAC_ROMAN = WIN_ANSI.map((char, code) => code >= 128 ? MAC_ROMAN_HIGH[code - 128] ?? "" : char);
const letters = (first: string) => Array.from({ length: 26 }, (_, index) => String.fromCharCode(first.charCodeAt(0) + index)).join(" ");
const GLYPH_NAMES = `space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at ${letters("A")} bracketleft backslash bracketright asciicircum underscore grave ${letters("a")} braceleft bar braceright asciitilde - Euro - quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE - Zcaron - - quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe - zcaron Ydieresis nbspace exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot sfthyphen registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis`.split(" ");
const GLYPHS = new Map<string, string>([["fi", "fi"], ["fl", "fl"], ["ff", "ff"], ["ffi", "ffi"], ["ffl", "ffl"], ["minus", "−"], ["euro", "€"], ["dotlessi", "ı"], ["lslash", "ł"], ["Lslash", "Ł"], ["apostrophe", "'"], ["middot", "·"]]);
GLYPH_NAMES.forEach((name, index) => { if (name !== "-" && !GLYPHS.has(name)) GLYPHS.set(name, WIN_ANSI[index + 32]); });
function glyphText(name: string): string {
  const known = GLYPHS.get(name); if (known !== undefined) return known;
  const uni = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(name); if (uni) return uni[1].match(/.{4}/g)?.map((hex) => String.fromCharCode(Number.parseInt(hex, 16))).join("") ?? "";
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(name); if (u) { const code = Number.parseInt(u[1], 16); return code <= 0x10ffff ? String.fromCodePoint(code) : ""; }
  if (name.includes(".")) return glyphText(name.split(".")[0]);
  return name.includes("_") ? name.split("_").map(glyphText).join("") : "";
}

interface FontDecoder { readonly simple: boolean; readonly table: readonly string[]; readonly map: Map<number, string>; readonly ranges: readonly { readonly bytes: number; readonly low: number; readonly high: number }[] }
const codeKey = (bytes: number, code: number): number => bytes * 0x100000000 + code;
const codeOf = (text: string, start: number, bytes: number): number => { let code = 0; for (let index = 0; index < bytes; index += 1) code = code * 256 + (text.charCodeAt(start + index) & 255); return code; };
const utf16 = (bytes: string): string => { if (bytes.length % 2) return bytes; let out = ""; for (let index = 0; index < bytes.length; index += 2) out += String.fromCharCode(bytes.charCodeAt(index) * 256 + bytes.charCodeAt(index + 1)); return out; };

/** The codespace ranges and bfchar/bfrange mappings of a CMap (ToUnicode or an embedded /Encoding). */
function parseCMap(text: string, map: Map<number, string>, ranges: { bytes: number; low: number; high: number }[]): void {
  const lexer = new Lexer(text, false); const tokens: PdfValue[] = [];
  for (let token = lexer.value(); token !== undefined && tokens.length < 2 * MAX_FONT_MAPPINGS; token = lexer.value()) tokens.push(token);
  const str = (index: number): string | null => { const token = tokens[index]; return token instanceof PdfString ? token.bytes : null; };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "begincodespacerange") for (index += 1; str(index) !== null && str(index + 1) !== null; index += 2) { const low = str(index) ?? ""; ranges.push({ bytes: low.length, low: codeOf(low, 0, low.length), high: codeOf(str(index + 1) ?? "", 0, low.length) }); }
    else if (token === "beginbfchar") for (index += 1; str(index) !== null && tokens[index + 1] !== undefined && tokens[index] !== "endbfchar"; index += 2) {
      const source = str(index) ?? ""; const target = tokens[index + 1];
      if (map.size < MAX_FONT_MAPPINGS) map.set(codeKey(source.length, codeOf(source, 0, source.length)), target instanceof PdfString ? utf16(target.bytes) : target instanceof PdfName ? glyphText(target.name) : "");
    }
    else if (token === "beginbfrange") for (index += 1; str(index) !== null && str(index + 1) !== null && tokens[index + 2] !== undefined; index += 3) {
      const source = str(index) ?? ""; const low = codeOf(source, 0, source.length); const high = codeOf(str(index + 1) ?? "", 0, source.length); const target = tokens[index + 2];
      if (high < low || high - low > 0xffff) continue;
      for (let code = low; code <= high && map.size < MAX_FONT_MAPPINGS; code += 1) {
        if (Array.isArray(target)) { const item = target[code - low]; if (item instanceof PdfString) map.set(codeKey(source.length, code), utf16(item.bytes)); continue; }
        if (!(target instanceof PdfString)) break;
        const base = utf16(target.bytes); map.set(codeKey(source.length, code), base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - low));
      }
    }
  }
}

function fontDecoder(ctx: Context, value: PdfValue | undefined): FontDecoder | null {
  const font = dictOf(ctx, value); if (!font) return null;
  const cached = ctx.fonts.get(font); if (cached) return cached;
  const map = new Map<number, string>(); const ranges: { bytes: number; low: number; high: number }[] = []; const toUnicodeRanges: { bytes: number; low: number; high: number }[] = [];
  const toUnicode = resolveStream(ctx, font.get("ToUnicode"));
  const toUnicodeData = toUnicode ? streamData(ctx, toUnicode) : null;
  if (toUnicodeData) parseCMap(toUnicodeData.toString("latin1"), map, toUnicodeRanges);
  const simple = nameOf(ctx, font.get("Subtype")) !== "Type0";
  let table = WIN_ANSI;
  if (simple) {
    const encoding = resolve(ctx, font.get("Encoding"));
    const base = encoding instanceof PdfName ? encoding.name : encoding instanceof Map ? nameOf(ctx, encoding.get("BaseEncoding")) : undefined;
    table = base === "MacRomanEncoding" ? [...MAC_ROMAN] : [...WIN_ANSI];
    if (encoding instanceof Map) { let code = 0; for (const item of arrayOf(ctx, encoding.get("Differences"))) { if (typeof item === "number") code = item; else if (item instanceof PdfName && code < 256) { table[code] = glyphText(item.name) || table[code]; code += 1; } } }
  } else {
    const encoding = font.get("Encoding"); const embedded = resolveStream(ctx, encoding); const data = embedded ? streamData(ctx, embedded) : null;
    if (data) parseCMap(data.toString("latin1"), new Map(), ranges);
    if (ranges.length === 0 && !/^Identity-[HV]$/.test(nameOf(ctx, encoding) ?? "") && toUnicodeRanges.length) ranges.push(...toUnicodeRanges);
    if (ranges.length === 0) ranges.push({ bytes: 2, low: 0, high: 0xffff });
    if (map.size === 0) issue(ctx, "TYPE0_FONT_WITHOUT_TOUNICODE");
  }
  const decoder: FontDecoder = { simple, table, map, ranges: ranges.sort((left, right) => left.bytes - right.bytes) };
  ctx.fonts.set(font, decoder);
  return decoder;
}

function decodeText(bytes: string, font: FontDecoder | null): string {
  if (!font) return [...bytes].map((char) => WIN_ANSI[char.charCodeAt(0) & 255]).join("");
  let out = "";
  for (let index = 0; index < bytes.length;) {
    if (font.simple) { const code = bytes.charCodeAt(index) & 255; out += font.map.get(codeKey(1, code)) ?? font.table[code]; index += 1; continue; }
    const remaining = bytes.length - index;
    const range = font.ranges.find((item) => item.bytes <= remaining && (() => { const code = codeOf(bytes, index, item.bytes); return code >= item.low && code <= item.high; })()) ?? font.ranges[font.ranges.length - 1];
    const size = Math.min(range.bytes, remaining);
    out += font.map.get(codeKey(size, codeOf(bytes, index, size))) ?? "";
    index += size;
  }
  return out;
}

function resolveStream(ctx: Context, value: PdfValue | undefined): PdfDef | undefined {
  const def = value instanceof PdfRef ? ctx.objects.get(value.id) : undefined;
  return def?.streamStart !== undefined ? def : undefined;
}

interface TextSink { readonly parts: string[]; chars: number; pending: "" | " " | "\n" }
const gap = (sink: TextSink, kind: " " | "\n"): void => { if (sink.parts.length && (sink.pending === "" || kind === "\n")) sink.pending = kind; };

/** Runs a content stream's text operators (Tf, Tj, TJ, ', ", Td, TD, Tm, T*, Do of form XObjects) into `sink`. */
function runContent(ctx: Context, content: string, resources: PdfDict | undefined, sink: TextSink, depth: number, active: Set<number>): void {
  const fonts = dictOf(ctx, resources?.get("Font")); const xobjects = dictOf(ctx, resources?.get("XObject"));
  const lexer = new Lexer(content, false); const stack: PdfValue[] = [];
  let font: FontDecoder | null = null; let lineY: number | null = null;
  const show = (value: PdfValue | undefined) => {
    if (!(value instanceof PdfString) || sink.chars > MAX_TEXT_CHARS) return;
    const text = decodeText(value.bytes, font); if (!text) return;
    sink.parts.push(sink.pending + text); sink.chars += text.length + 1; sink.pending = "";
  };
  for (let token = lexer.value(); token !== undefined; token = lexer.value()) {
    if (typeof token !== "string" || token === ">>" || token === ">" || token === "]" || token === ")" || token === "{" || token === "}") { if (stack.length < 64) stack.push(token); continue; }
    const last = stack[stack.length - 1];
    if (token === "Tf") font = fontDecoder(ctx, stack[stack.length - 2] instanceof PdfName ? fonts?.get((stack[stack.length - 2] as PdfName).name) : undefined);
    else if (token === "Td" || token === "TD") gap(sink, typeof last === "number" && Math.abs(last) > 0.01 ? "\n" : " ");
    else if (token === "Tm") { const y = typeof last === "number" ? last : null; gap(sink, lineY === null || y === null || Math.abs(y - lineY) > 0.5 ? "\n" : " "); lineY = y; }
    else if (token === "T*" || token === "BT") gap(sink, "\n");
    else if (token === "Tj") show(last);
    else if (token === "'" || token === "\"") { gap(sink, "\n"); show(last); }
    else if (token === "TJ" && Array.isArray(last)) for (const item of last) { if (typeof item === "number") { if (item < -180) gap(sink, " "); } else show(item); }
    else if (token === "Do" && last instanceof PdfName) {
      const ref = xobjects?.get(last.name); const def = resolveStream(ctx, ref);
      if (!def || active.has(def.id) || depth >= MAX_FORM_DEPTH || (ctx.formRuns += 1) > MAX_FORM_RUNS || !(def.value instanceof Map) || nameOf(ctx, def.value.get("Subtype")) !== "Form") { stack.length = 0; continue; }
      // A form repeated on every page (letterhead, footer) is decoded once.
      if (!ctx.forms.has(def.id)) ctx.forms.set(def.id, streamData(ctx, def)?.toString("latin1") ?? null);
      const data = ctx.forms.get(def.id);
      if (data) { active.add(def.id); runContent(ctx, data, dictOf(ctx, def.value.get("Resources")) ?? resources, sink, depth + 1, active); active.delete(def.id); }
    } else if (token === "BI") {
      for (let item = lexer.value(); item !== undefined && item !== "ID"; item = lexer.value()) { /* the inline image dictionary */ }
      const end = /\sEI(?=[\s]|$)/g; end.lastIndex = lexer.pos + 1;
      lexer.pos = end.exec(content) ? end.lastIndex : content.length;
    }
    stack.length = 0;
  }
}

export interface PdfTextLayer { readonly status: DocumentEvidenceStatus; readonly text: string; readonly pages: number; readonly sourceSha256: string; readonly reason?: string }

/** The text of a regulatory PDF's text layer in reading (stream) order, lines separated by "\n" and runs by " ". */
export function pdfTextLayer(bytes: Uint8Array): PdfTextLayer {
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const result = (status: DocumentEvidenceStatus, reason: string, text = "", pages = 0): PdfTextLayer => ({ status, text, pages, sourceSha256, ...(reason ? { reason } : {}) });
  if (bytes.length > MAX_PDF_BYTES) return result("FAIL_CLOSED", "PDF_TOO_LARGE");
  const s = latin1(bytes);
  if (!s.slice(0, 1024).includes("%PDF-")) return result("NOT_AVAILABLE", "NOT_A_PDF");
  try {
    const direct = scanObjects(s);
    if (direct.length === 0) return result("NOT_AVAILABLE", "PDF_OBJECTS_NOT_FOUND");
    const ctx: Context = { s, objects: new Map(direct.map((def) => [def.id, def])), decoded: 0, issues: new Map(), fonts: new Map(), forms: new Map(), formRuns: 0 };
    // Trailers ("trailer <<...>>" or xref stream dictionaries); an incremental update's newest one wins.
    const trailers: { pos: number; dict: PdfDict }[] = direct.filter((def) => def.value instanceof Map && nameOf(ctx, def.value.get("Type")) === "XRef").map((def) => ({ pos: def.pos, dict: def.value as PdfDict }));
    for (const match of s.matchAll(/trailer\s*<</g)) { const value = new Lexer(s, true, (match.index ?? 0) + 7).value(); if (value instanceof Map) trailers.push({ pos: match.index ?? 0, dict: value }); }
    trailers.sort((left, right) => right.pos - left.pos);
    const trailerValue = (key: string): PdfValue | undefined => trailers.find((item) => item.dict.has(key))?.dict.get(key);
    const encrypt = dictOf(ctx, trailerValue("Encrypt"));
    if (encrypt) {
      const handler = securityHandler(ctx, encrypt, bytesOf(ctx, arrayOf(ctx, trailerValue("ID"))[0]));
      if (typeof handler === "string") return result("FAIL_CLOSED", handler);
      ctx.crypt = handler;
    }
    // Objects packed in object streams, placed at their stream's position so a later update still overrides them.
    const defs: PdfDef[] = [...direct];
    for (const def of direct) {
      if (!(def.value instanceof Map) || nameOf(ctx, def.value.get("Type")) !== "ObjStm") continue;
      const data = streamData(ctx, def); if (!data) continue;
      const content = data.toString("latin1"); const first = numberOf(ctx, def.value.get("First")) ?? 0; const count = numberOf(ctx, def.value.get("N")) ?? 0;
      const header = content.slice(0, first).trim().split(/\s+/).map(Number);
      for (let index = 0; index < count && index * 2 + 1 < header.length; index += 1) defs.push({ id: header[index * 2], gen: 0, pos: def.pos + 0.5, value: new Lexer(content, true, first + header[index * 2 + 1]).value() ?? null });
    }
    defs.sort((left, right) => left.pos - right.pos);
    ctx.objects.clear(); for (const def of defs) ctx.objects.set(def.id, def);
    // The page tree from /Root, resources inherited from the /Pages nodes; otherwise every /Type /Page object.
    const pages: { readonly page: PdfDict; readonly resources?: PdfDict }[] = []; const seen = new Set<PdfDict>();
    const visit = (node: PdfValue | undefined, inherited: PdfDict | undefined, depth: number): void => {
      const dict = dictOf(ctx, node); if (!dict || seen.has(dict) || depth > 64 || pages.length >= MAX_PAGES) return;
      seen.add(dict);
      const resources = dictOf(ctx, dict.get("Resources")) ?? inherited; const kids = resolve(ctx, dict.get("Kids"));
      if (Array.isArray(kids) && nameOf(ctx, dict.get("Type")) !== "Page") for (const kid of kids) visit(kid, resources, depth + 1);
      else pages.push({ page: dict, resources });
    };
    visit(dictOf(ctx, trailerValue("Root"))?.get("Pages"), undefined, 0);
    if (pages.length === 0) for (const def of ctx.objects.values()) {
      if (!(def.value instanceof Map) || nameOf(ctx, def.value.get("Type")) !== "Page" || pages.length >= MAX_PAGES) continue;
      let resources = dictOf(ctx, def.value.get("Resources"));
      for (let parent = dictOf(ctx, def.value.get("Parent")), depth = 0; !resources && parent && depth < 64; parent = dictOf(ctx, parent.get("Parent")), depth += 1) resources = dictOf(ctx, parent.get("Resources"));
      pages.push({ page: def.value, resources });
    }
    if (pages.length === 0) return result("NOT_AVAILABLE", "PAGES_NOT_FOUND");
    const sink: TextSink = { parts: [], chars: 0, pending: "" }; let streams = 0;
    for (const { page, resources } of pages) {
      const single = resolveStream(ctx, page.get("Contents"));
      const contents = (single ? [single] : arrayOf(ctx, page.get("Contents")).map((item) => resolveStream(ctx, item))).filter((def): def is PdfDef => def !== undefined);
      // A page's content streams are one stream cut anywhere, even inside a token.
      const content = contents.map((def) => { streams += 1; return streamData(ctx, def)?.toString("latin1") ?? ""; }).join("\n");
      runContent(ctx, content, resources, sink, 0, new Set());
      gap(sink, "\n");
    }
    const text = sink.parts.join("");
    const issues = [...ctx.issues].map(([reason, count]) => `${reason}x${count}`).join(",");
    return text.trim() ? result("AVAILABLE", "", text, pages.length) : result("NOT_AVAILABLE", `TEXT_LAYER_EMPTY:pages=${pages.length},streams=${streams}${issues ? `,${issues}` : ""}`, "", pages.length);
  } catch (error) { return result("FAIL_CLOSED", `PDF_PARSE_ERROR:${error instanceof Error ? error.message : "ERROR"}`); }
}

/** The text of the PDF's text layer in stream order, with every whitespace removed (words can be split across items);
 *  status and reason say why it is empty, for the refresh errors. */
export function pdfCompactText(bytes: Uint8Array): { readonly text: string; readonly sourceSha256: string; readonly status: DocumentEvidenceStatus; readonly reason?: string } {
  const layer = pdfTextLayer(bytes);
  const text = layer.text.replace(/\s+/g, "");
  if (text) return { text, sourceSha256: layer.sourceSha256, status: layer.status };
  // The bill reader as a second opinion, for a layout the tolerant reader does not know.
  // It throws a RangeError on a ToUnicode with ligatures ("ff" as <00660066>): that is a reason too.
  let strict: { readonly status: string; readonly items: readonly { readonly text: string }[]; readonly reason?: string };
  try { strict = documentTextItems(expandPdfObjectStreams(bytes)); } catch (error) { strict = { status: "FAIL_CLOSED", items: [], reason: error instanceof Error ? error.name : "ERROR" }; }
  const fallback = strict.items.map((item: { readonly text: string }) => item.text).join("").replace(/[\s\u0000-\u001f]+/g, "");
  return fallback ? { text: fallback, sourceSha256: layer.sourceSha256, status: "AVAILABLE" } : { text: "", sourceSha256: layer.sourceSha256, status: layer.status, reason: `${layer.reason ?? "TEXT_LAYER_EMPTY"};strict=${strict.reason ?? strict.status}` };
}
