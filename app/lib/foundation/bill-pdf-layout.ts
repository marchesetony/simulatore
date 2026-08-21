import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

type PdfObject = { readonly dictionary: string; readonly stream: Uint8Array | null };
type PdfTextItem = { readonly page: number; readonly x: number; readonly y: number; readonly text: string };
type PdfLine = { readonly page: number; readonly x: number; readonly y: number; readonly text: string };

export type BillingAddressPdfEvidence = {
  readonly page: number | null;
  readonly rawLines: readonly string[];
  readonly normalized: string | null;
  readonly nearCustomerName: boolean;
  readonly nearTaxCode: boolean;
  readonly sectionContext: string | null;
  readonly supplyAddressRawLines: readonly string[];
  readonly supplySectionContext: string | null;
  readonly addressesDistinct: boolean;
  readonly documentEvidence: "PASS" | "FAIL";
};

type BillingAddressOptions = { readonly customerName?: string | null; readonly taxCode?: string | null; readonly supplyAddress?: string | null };

const pdfCache = new Map<string, BillingAddressPdfEvidence>();

function parseObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const source = Buffer.from(bytes);
  const objects = new Map<number, PdfObject>();
  const objectPattern = /(^|\n)(\d+)\s+\d+\s+obj\s*/g;
  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(source.toString("latin1"))) !== null) {
    const objectStart = match.index + match[0].length;
    const objectEnd = source.indexOf(Buffer.from("endobj"), objectStart);
    if (objectEnd < 0) continue;
    const raw = source.subarray(objectStart, objectEnd);
    const streamMarker = raw.indexOf(Buffer.from("stream"));
    if (streamMarker < 0) {
      objects.set(Number(match[2]), { dictionary: raw.toString("latin1"), stream: null });
      continue;
    }
    const dictionary = raw.subarray(0, streamMarker).toString("latin1");
    let stream = raw.subarray(streamMarker + 6);
    if (stream[0] === 13 && stream[1] === 10) stream = stream.subarray(2);
    else if (stream[0] === 10) stream = stream.subarray(1);
    const streamEnd = stream.indexOf(Buffer.from("endstream"));
    if (streamEnd >= 0) stream = stream.subarray(0, streamEnd);
    if (dictionary.includes("/FlateDecode")) {
      try { stream = inflateSync(stream); } catch { /* malformed/non-flate streams are ignored */ }
    }
    objects.set(Number(match[2]), { dictionary, stream });
  }
  return objects;
}

function references(value: string): number[] {
  return [...value.matchAll(/(\d+)\s+\d+\s+R/g)].map((item) => Number(item[1]));
}

function pageOrder(objects: Map<number, PdfObject>): number[] {
  const root = [...objects.entries()].find(([, object]) => /\/Type\s*\/Pages\b/.test(object.dictionary));
  if (!root) return [...objects.entries()].filter(([, object]) => /\/Type\s*\/Page\b/.test(object.dictionary) && !/\/Type\s*\/Pages\b/.test(object.dictionary)).map(([id]) => id).sort((left, right) => left - right);
  const pages: number[] = [];
  const visit = (id: number): void => {
    const object = objects.get(id);
    if (!object) return;
    if (/\/Type\s*\/Page\b/.test(object.dictionary) && !/\/Type\s*\/Pages\b/.test(object.dictionary)) { pages.push(id); return; }
    const kids = object.dictionary.match(/\/Kids\s*\[([^\]]*)\]/);
    if (kids) for (const child of references(kids[1])) visit(child);
  };
  visit(root[0]);
  return pages.length ? pages : [...objects.entries()].filter(([, object]) => /\/Type\s*\/Page\b/.test(object.dictionary) && !/\/Type\s*\/Pages\b/.test(object.dictionary)).map(([id]) => id).sort((left, right) => left - right);
}

function toUnicodeMap(objects: Map<number, PdfObject>, fontObject: number): Map<number, string> {
  const font = objects.get(fontObject)?.dictionary ?? "";
  const toUnicode = font.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
  const stream = toUnicode ? objects.get(Number(toUnicode[1]))?.stream : null;
  if (!stream) return new Map();
  const source = Buffer.from(stream).toString("latin1");
  const result = new Map<number, string>();
  for (const block of source.matchAll(/\d+\s+beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const item of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) result.set(Number.parseInt(item[1], 16), String.fromCodePoint(Number.parseInt(item[2], 16)));
  }
  for (const block of source.matchAll(/\d+\s+beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const item of block[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) {
      const start = Number.parseInt(item[1], 16); const end = Number.parseInt(item[2], 16); const destination = Number.parseInt(item[3], 16);
      for (let code = start; code <= end; code += 1) result.set(code, String.fromCodePoint(destination + code - start));
    }
  }
  return result;
}

function pageFonts(objects: Map<number, PdfObject>, page: string): Map<string, Map<number, string>> {
  const result = new Map<string, Map<number, string>>();
  const fontBlock = page.match(/\/Font\s*<<([^>]*)>>/)?.[1] ?? "";
  for (const item of fontBlock.matchAll(/\/(F\w+)\s+(\d+)\s+\d+\s+R/g)) result.set(item[1], toUnicodeMap(objects, Number(item[2])));
  return result;
}

function decodePdfString(value: string, map: Map<number, string>): string {
  const bytes = Buffer.from(value.replace(/\s+/g, ""), "hex");
  let text = "";
  for (let index = 0; index < bytes.length; index += 2) text += map.get(bytes.readUInt16BE(index)) ?? "�";
  return text;
}

function textItems(objects: Map<number, PdfObject>): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const operator = /\/(F\w+)\s+[-+\d.]+\s+Tf|([-+\d.]+)\s+([-+\d.]+)\s+Tm|([-+\d.]+)\s+([-+\d.]+)\s+Td|<([0-9A-Fa-f\s]+)>\s*Tj/g;
  for (const [pageIndex, pageObject] of pageOrder(objects).entries()) {
    const page = objects.get(pageObject)?.dictionary ?? "";
    const contents = page.match(/\/Contents\s*(?:\[([^\]]+)\]|(\d+)\s+\d+\s+R)/);
    if (!contents) continue;
    const streams = contents[1] ? references(contents[1]) : [Number(contents[2])];
    const fonts = pageFonts(objects, page);
    let font = ""; let x = 0; let y = 0;
    for (const content of streams) {
      const stream = objects.get(content)?.stream; if (!stream) continue;
      const source = Buffer.from(stream).toString("latin1");
      operator.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = operator.exec(source)) !== null) {
        if (match[1]) font = match[1];
        else if (match[2]) { x = Number(match[2]); y = Number(match[3]); }
        else if (match[4]) { x += Number(match[4]); y += Number(match[5]); }
        else if (match[6]) {
          const text = decodePdfString(match[6], fonts.get(font) ?? new Map());
          if (text.trim()) items.push({ page: pageIndex + 1, x, y, text });
        }
      }
    }
  }
  return items;
}

function normalizedLine(value: string): string { return value.replace(/[\u0000-\u001f�]+/g, " ").replace(/\s+/g, " ").trim(); }
function compact(value: string): string { return normalizedLine(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function linesFromItems(items: readonly PdfTextItem[]): PdfLine[] {
  const lines: { page: number; x: number; y: number; items: PdfTextItem[] }[] = [];
  for (const item of [...items].sort((left, right) => left.page - right.page || left.y - right.y || left.x - right.x)) {
    const line = lines.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) <= 1.8);
    if (line) { line.items.push(item); line.items.sort((left, right) => left.x - right.x); line.x = Math.min(line.x, item.x); }
    else lines.push({ page: item.page, x: item.x, y: item.y, items: [item] });
  }
  return lines.map((line) => ({ page: line.page, x: line.x, y: line.y, text: normalizedLine(line.items.map((item) => item.text).join(" ")) }));
}

function addressLine(value: string): boolean { return /\b(?:VIA|VIALE|PIAZZA|PIAZZALE|CORSO|CONTRADA|LOC\.?|LOCALIT[AÀ]|FRAZIONE|STRADA|VICO|VICOLO|LARGO)\b/i.test(value) && /\d/.test(value); }
function capLine(value: string): boolean { return /\b\d{5}\b/.test(value); }
function normalizeAddress(lines: readonly string[]): string | null {
  if (!lines.length) return null;
  const street = normalizedLine(lines[0]).replace(/\s+(\d+[A-Z]?)$/, ", $1").replace(/,\s*,/g, ",");
  const rest = lines.slice(1).map(normalizedLine).filter(Boolean);
  return [street, ...rest].join(", ") || null;
}

export function inspectBillingAddressFromPdf(pdfPath: string, options: BillingAddressOptions = {}): BillingAddressPdfEvidence {
  const cached = pdfCache.get(pdfPath); if (cached) return cached;
  let evidence: BillingAddressPdfEvidence = { page: null, rawLines: [], normalized: null, nearCustomerName: false, nearTaxCode: false, sectionContext: null, supplyAddressRawLines: [], supplySectionContext: null, addressesDistinct: false, documentEvidence: "FAIL" };
  try {
    const lines = linesFromItems(textItems(parseObjects(new Uint8Array(readFileSync(pdfPath)))));
    const customerNeedle = compact(options.customerName ?? ""); const taxNeedle = compact(options.taxCode ?? "");
    const customerIndex = lines.findIndex((line) => customerNeedle.length >= 8 && compact(line.text).includes(customerNeedle.slice(0, Math.min(customerNeedle.length, 12))));
    const taxIndex = lines.findIndex((line) => taxNeedle.length >= 8 && compact(line.text).includes(taxNeedle.slice(0, Math.min(taxNeedle.length, 10))));
    const anchorIndex = customerIndex >= 0 ? customerIndex : taxIndex;
    if (anchorIndex >= 0) {
      const anchor = lines[anchorIndex];
      const candidates = lines.filter((line, index) => line.page === anchor.page && index > anchorIndex && index <= anchorIndex + 6 && line.x >= anchor.x - 8 && line.y > anchor.y && line.y <= anchor.y + 65);
      const start = candidates.findIndex((line) => addressLine(line.text));
      if (start >= 0) {
        const rawLines = [candidates[start].text];
        for (const line of candidates.slice(start + 1, start + 3)) { if (capLine(line.text)) rawLines.push(line.text); else break; }
        const taxInBlock = lines.some((line, index) => index >= anchorIndex && index <= anchorIndex + 6 && line.page === anchor.page && /CODICE\s+FISCALE/i.test(line.text));
        const addressIndex = lines.indexOf(candidates[start]);
        const contextLines = lines.slice(Math.max(0, anchorIndex - 1), Math.min(lines.length, addressIndex + rawLines.length + 2)).slice(0, 5).map((line) => line.text);
        evidence = { ...evidence, page: anchor.page, rawLines, normalized: normalizeAddress(rawLines), nearCustomerName: customerIndex >= 0, nearTaxCode: taxIndex >= 0 || taxInBlock, sectionContext: contextLines.join(" | ") || null };
      }
    }
    const supplyLine = lines.find((line) => /\bPOD\s*:/i.test(line.text) && addressLine(line.text));
    if (supplyLine) {
      const contextLine = lines.filter((line) => line.page === supplyLine.page && line.y < supplyLine.y).reverse().find((line) => /DATI\s+IDENTIFICATIVI\s+DELLA\s+FORNITURA/i.test(line.text) || /DATI\s+DI\s+FORNITURA\s+E\s+FATTURAZIONE/i.test(line.text));
      const supplySectionContext = contextLine && /DATI\s+IDENTIFICATIVI\s+DELLA\s+FORNITURA/i.test(contextLine.text) ? "Dati identificativi della fornitura" : contextLine?.text ?? "POD / dati identificativi della fornitura";
      evidence = { ...evidence, supplyAddressRawLines: [supplyLine.text], supplySectionContext };
    }
    const distinct = evidence.page !== null && Boolean(supplyLine) && (supplyLine?.page !== evidence.page || Math.abs((supplyLine?.y ?? 0) - (lines.find((line) => line.page === evidence.page && line.text === evidence.rawLines[0])?.y ?? 0)) > 20);
    evidence = { ...evidence, addressesDistinct: distinct, documentEvidence: evidence.normalized && evidence.nearCustomerName && distinct ? "PASS" : "FAIL" };
  } catch { /* a missing/unreadable PDF must not create a value */ }
  pdfCache.set(pdfPath, evidence);
  return evidence;
}

export function resolveBillingAddressFromPdf(pdfPath: string, options: BillingAddressOptions = {}): string | null { return inspectBillingAddressFromPdf(pdfPath, options).documentEvidence === "PASS" ? inspectBillingAddressFromPdf(pdfPath, options).normalized : null; }
