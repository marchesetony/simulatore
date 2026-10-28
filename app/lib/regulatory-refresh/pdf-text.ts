import { createHash } from "node:crypto";
import { inflateSync } from "fflate";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { documentTextItems } from "../ingestion/document-numeric-evidence.ts";

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

/** Copies the objects packed in PDF object streams out as plain objects, so the text-layer reader finds pages and fonts. */
export function expandPdfObjectStreams(bytes: Uint8Array): Uint8Array {
  const pdf = latin1(bytes);
  const extra: string[] = [];
  for (const match of pdf.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)stream\r?\n/g)) {
    const dictionary = match[2];
    if (!/\/Type\s*\/ObjStm\b/.test(dictionary) || !/\/FlateDecode\b/.test(dictionary)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const length = Number(dictionary.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)?.[1] ?? NaN);
    const end = Number.isFinite(length) ? start + length : pdf.indexOf("endstream", start);
    if (end <= start) continue;
    let content: string;
    try { content = latin1(inflateSync(bytes.subarray(start + 2, end))); } catch { continue; }
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

/** The text of the PDF's text layer in stream order, with every whitespace removed (words can be split across items). */
export function pdfCompactText(bytes: Uint8Array): { readonly text: string; readonly sourceSha256: string } {
  const result = documentTextItems(expandPdfObjectStreams(bytes));
  return { text: result.items.map((item) => item.text).join("").replace(/\s+/g, ""), sourceSha256: createHash("sha256").update(bytes).digest("hex") };
}

