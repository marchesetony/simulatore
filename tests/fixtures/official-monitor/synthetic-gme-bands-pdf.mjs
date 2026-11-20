// Synthetic GME "Prezzo medio per fasce" PDF (one uncompressed text stream), same wording and layout order as GME's monthly PDF.
// Values are passed in; nothing here is a real GME file.
export function syntheticGmeBandsPdf({ month = "Maggio 2026", f1 = "107,17", f2 = "131,44", f3 = "120,81", hours = [220, 180, 344], note = "" } = {}) {
  const lines = ["Prezzo medio di acquisto per fasce orarie*", month, "EUR/MWh", `F1: ore di punta (peak) (${hours[0]} ore) ${f1}`, `F2: ore intermedie (mid-level) (${hours[1]} ore) ${f2}`, `F3: ore fuori punta (off-peak) (${hours[2]} ore) ${f3}`, "*come definite dalla delibera dell'ARERA n 181 del 2006", ...(note ? [note] : [])];
  const content = `BT /F1 10 Tf ${lines.map((line, index) => `1 0 0 1 50 ${700 - index * 20} Tm (${line.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n"; const offsets = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
