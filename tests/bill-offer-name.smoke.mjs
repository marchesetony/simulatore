import assert from "node:assert/strict";

import { extractDocumentOfferName } from "../app/lib/ingestion/document-numeric-evidence.ts";

// The current offer's name is shown in the quote when the uploaded bill prints it (Tony, 26/10).
// HERA prints "Offerta commerciale in vigore:" with the name as the next text item.
const pdfOf = (lines) => {
  const text = ["BT /F1 8 Tf", ...lines.map((line, index) => `1 0 0 1 60 ${700 - index * 15} Tm (${line}) Tj`), "ET"].join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>", `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  return new Uint8Array(Buffer.from(`%PDF-1.4\n${objects.map((body, index) => `${index + 1} 0 obj\n${body}\nendobj\n`).join("")}trailer\n<< /Root 1 0 R >>\n%%EOF`, "latin1"));
};
assert.equal(extractDocumentOfferName(pdfOf(["Servizio fatturato:", "Offerta commerciale in vigore: ", "PiuContr Actv Lav Luce - V16", "Scadenza delle condizioni economiche: "])), "PiuContr Actv Lav Luce - V16");
assert.equal(extractDocumentOfferName(pdfOf(["Nome offerta: Luce Business Flex"])), "Luce Business Flex");
assert.equal(extractDocumentOfferName(pdfOf(["Box dell'offerta", "Spesa per la vendita di energia elettrica"])), null, "no label, no name");
console.log("BILL_OFFER_NAME=PASS");
