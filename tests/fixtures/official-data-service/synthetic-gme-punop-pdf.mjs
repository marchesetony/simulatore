// Synthetic one-page GME PDF with the wording of "Prezzo medio delibera ARERA 300/05" (uncompressed text stream). Values are
// passed in; nothing here is a real GME file. Wording as on the GME PDF for May 2026 (read 22/11/2026).
export function syntheticGmePunopPdf({ month = "Maggio 2026", label = "PUNopMag2026", value = "122,83", article = true } = {}) {
  const lines = [
    "Per il mese il valore del parametro di",
    article ? "cui all'articolo 5.2 della Delibera dell'Autorità di Regolazione per Energia," : "cui alla Delibera dell'Autorità di Regolazione per Energia,",
    article ? "Reti e Ambiente n. 300/05 è pari a:" : "Reti e Ambiente è pari a:",
    `${month} ${label}`,
    `${value} EUR/MWh`,
  ];
  const content = `BT /F1 10 Tf ${lines.map((line, index) => `1 0 0 1 50 ${760 - index * 18} Tm (${line.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n"; const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body, "latin1")); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
