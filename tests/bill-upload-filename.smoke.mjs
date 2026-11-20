import assert from "node:assert/strict";
import { validateBillDocument, validatePdf } from "../app/lib/foundation/real-bill.ts";

// Tony (29/10): "Caricamento bolletta non disponibile". A PDF named with accents, parentheses or "n°" is still uploaded;
// only a path is refused.
const pdf = new TextEncoder().encode("%PDF-1.7 test");
assert.equal(validatePdf("Bolletta n° 12 (dettaglio) già pagata.pdf", "application/pdf", pdf, 1000), "Bolletta n_ 12 _dettaglio_ gia pagata.pdf");
assert.equal(validateBillDocument("Fattura Settembre.PDF", "application/pdf", pdf, 1000), "Fattura Settembre.pdf");
assert.equal(validatePdf(`${"a".repeat(200)}.pdf`, "application/pdf", pdf, 1000).length, 124);
assert.throws(() => validatePdf("../bill.pdf", "application/pdf", pdf, 1000), /PDF_FILENAME_INVALID/);
assert.throws(() => validatePdf("bill.txt", "application/pdf", pdf, 1000), /PDF_FILENAME_INVALID/);
console.log("bill upload filename ok");
