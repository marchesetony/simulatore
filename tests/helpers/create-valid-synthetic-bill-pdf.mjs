import { Buffer } from "node:buffer";

export const SYNTHETIC_BILL_TEXT = [
  "Documento sintetico di test",
  "Fornitura energia elettrica",
  "Periodo 01/07/2026 - 31/07/2026",
  "Tensione nominale 230 V",
  "Potenza impegnata 3 kW",
  "Consumo annuo 2700 kWh",
  "Consumo fatturato 220 kWh",
  "F1 80 kWh",
  "F2 70 kWh",
  "F3 70 kWh",
  "Pagamento: addebito diretto",
  "Scadenza pagamento: 20/08/2026",
  "PUN applicato: 0,15000 EUR/kWh",
  "Spread: 0,01000 EUR/kWh",
  "Dispacciamento: 0,00800 EUR/kWh",
];

function pdfText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function byteLength(value) {
  return Buffer.byteLength(value, "ascii");
}

export function createValidSyntheticBillPdf() {
  const content = [
    "BT",
    "/F1 10 Tf",
    "72 760 Td",
    ...SYNTHETIC_BILL_TEXT.flatMap((line) => [`(${pdfText(line)}) Tj`, "0 -18 Td"]),
    "ET",
    "",
  ].join("\n");
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  const parts = ["%PDF-1.4\n%synthetic-bill-test\n"];
  const offsets = [0];
  for (const [index, body] of bodies.entries()) {
    offsets.push(byteLength(parts.join("")));
    parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  }
  const xrefOffset = byteLength(parts.join(""));
  parts.push(`xref\n0 ${bodies.length + 1}\n`);
  parts.push("0000000000 65535 f \n");
  for (const offset of offsets.slice(1)) parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  parts.push(`trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(parts.join(""), "ascii");
}

export function validateSyntheticBillPdf(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error("PDF_BYTES_INVALID");
  const buffer = Buffer.from(bytes);
  if (buffer.length === 0) throw new Error("PDF_EMPTY");
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_MAGIC_INVALID");
  if (!/%%EOF\s*$/.test(buffer.toString("latin1"))) throw new Error("PDF_EOF_MISSING");
  const text = buffer.toString("latin1");
  const xrefOffset = text.lastIndexOf("\nxref\n") + 1;
  if (xrefOffset <= 0) throw new Error("PDF_XREF_MISSING");
  const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (!startxref || Number(startxref[1]) !== xrefOffset) throw new Error("PDF_STARTXREF_INVALID");
  const trailer = /trailer\s*<<(.*?)>>\s*startxref/s.exec(text);
  if (!trailer || !/\/Size\s+6\b/.test(trailer[1]) || !/\/Root\s+1\s+0\s+R\b/.test(trailer[1])) throw new Error("PDF_TRAILER_INVALID");
  const trailerOffset = text.indexOf("trailer", xrefOffset);
  if (trailerOffset <= xrefOffset) throw new Error("PDF_TRAILER_MISSING");
  const xref = text.slice(xrefOffset, trailerOffset);
  const xrefLines = xref.split(/\r?\n/);
  if (xrefLines[0] !== "xref" || xrefLines[1] !== "0 6" || xrefLines.length < 8) throw new Error("PDF_XREF_TABLE_INVALID");
  if (!/^0000000000 65535 f $/.test(xrefLines[2])) throw new Error("PDF_XREF_FREE_ENTRY_INVALID");
  for (let objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
    const entry = /^(\d{10}) 00000 n $/.exec(xrefLines[objectNumber + 2]);
    if (!entry || Number(entry[1]) >= buffer.length) throw new Error("PDF_XREF_ENTRY_INVALID");
    if (!text.startsWith(`${objectNumber} 0 obj`, Number(entry[1]))) throw new Error("PDF_OBJECT_OFFSET_INVALID");
  }
  const pageCount = (text.match(/\/Type \/Page\b/g) ?? []).length;
  if (pageCount < 1) throw new Error("PDF_PAGE_COUNT_INVALID");
  return { pageCount, sizeBytes: buffer.length };
}
