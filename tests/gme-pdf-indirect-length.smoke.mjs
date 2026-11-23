import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { publishedPdfText } from "../app/lib/market/gme-pun-source.ts";

/**
 * GME newsletter n.204 (15/06/2026) came out as "testo del PDF non leggibile": its content streams declare "/Length 12 0 R"
 * (length held in another object), which the reader took as 12 bytes. Synthetic PDF only; the text is a placeholder, not data.
 */
function pdf({ indirect, compressed = true, wrongDirect = false }) {
  const content = Buffer.from("BT /F1 10 Tf (Riga di prova 1,23 4,56) Tj ET");
  const data = compressed ? deflateSync(content) : content;
  const parts = [];
  parts.push("%PDF-1.7\n");
  parts.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  parts.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  parts.push("3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n");
  const lengthEntry = indirect ? "/Length 5 0 R" : `/Length ${wrongDirect ? data.length - 7 : data.length}`;
  const filter = compressed ? " /Filter /FlateDecode" : "";
  const head = Buffer.from(`4 0 obj\n<< ${lengthEntry}${filter} >>\nstream\n`, "latin1");
  const tail = `\nendstream\nendobj\n5 0 obj\n${data.length}\nendobj\n6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([Buffer.from(parts.join(""), "latin1"), head, data, Buffer.from(tail, "latin1")]));
}

for (const [name, options] of [["indiretta compressa", { indirect: true }], ["indiretta non compressa", { indirect: true, compressed: false }], ["diretta", { indirect: false }], ["diretta errata", { indirect: false, wrongDirect: true }]]) {
  const text = publishedPdfText(pdf(options));
  assert.match(text, /Riga di prova 1,23 4,56/, `lunghezza ${name}: testo non letto (${JSON.stringify(text.slice(0, 80))})`);
}
console.log("gme-pdf-indirect-length: 4/4 OK");
