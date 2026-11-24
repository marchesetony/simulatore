// Synthetic GME newsletter PDF (one uncompressed text stream) with the same wording as the monthly newsletter's report on the
// electricity market: header, commentary and Tabella 1 "MGP, dati di sintesi" with the PUN INDEX GME Baseload row.
// Values are passed in; nothing here is a real GME file.
export function syntheticGmeNewsletterPdf({ number = "204", issueMonth = "GIUGNO 2026", reportMonth = "Maggio 2026", baseload = "119,35", previousYear = "93,58", prose = "119,35", withTable = true, extraReport = null, chartLines = [] } = {}) {
  const lines = [
    `n.${number} ${issueMonth}`, `NEWSLETTER DEL GME | 2026 | NUMERO ${number}`, `REPORT | ${reportMonth}`,
    ...(prose ? [`Il Pun Index GME si mantiene pressoché invariato rispetto al mese precedente a ${prose} EUR/MWh`] : ["Il Pun Index GME si mantiene stabile"]),
    ...(withTable ? ["Tabella 1: MGP, dati di sintesi Fonte: GME", "PUN INDEX GME", `Baseload ${baseload} ${previousYear} +25,78 +27,5% 19.420 +7,5%`, "Picco 120,10 99,01", "Fuori picco 118,90 90,12"] : []),
    "Grafico 1: MGP, Pun Index GME Fonte: GME",
    ...chartLines,
    ...(extraReport ? [`REPORT | ${extraReport}`] : []),
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
