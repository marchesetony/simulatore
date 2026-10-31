import assert from "node:assert/strict";
import { documentNumbers, printedInDocument } from "../app/lib/ingestion/document-numeric-evidence.ts";
import { betterBillCheck, billReadingReviewPrompt, billUnprintedValues, needsBillVerification } from "../app/lib/ingestion/bill-reading-review.ts";
import { getConfiguredCteOcrProvider } from "../app/lib/cte/ingestion.ts";
import { ANTHROPIC_TOOL_NAME } from "../app/lib/cte/anthropic.ts";

// Tony (31/10): "voglio che un agente legga dettagliatamente la bolletta e un'altro agente legga dettagliatamente le cte
// quando si caricano e poi simula correttamente secondo le regole arera". Each reading is now checked by a verifier against
// the numbers printed in the PDF: values the document does not print send it back to the AI, and the corrected reading is
// kept only if it checks out better.
const pdfWith = (lines) => {
  const stream = `BT /F1 10 Tf ${lines.map((text, index) => `1 0 0 1 50 ${700 - index * 14} Tm (${text}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  return new Uint8Array(Buffer.from(`%PDF-1.4\n${objects.map((body, index) => `${index + 1} 0 obj\n${body}\nendobj`).join("\n")}\ntrailer << /Root 1 0 R >>\n%%EOF`, "latin1"));
};

const bill = pdfWith(["Spesa per la vendita 390 kWh 0,276410 107,80", "Spesa per la rete 1 mese 1,92", "Totale bolletta 109,72"]);
const numbers = documentNumbers(bill);
assert.ok(numbers, "the synthetic PDF has a text layer");
assert.ok(printedInDocument(numbers, "107,80 €") && printedInDocument(numbers, "0,276410") && !printedInDocument(numbers, "170,80"));

const reading = (amount) => ({ economicChargeLines: [
  { code: "SELLER_ENERGY_FEE", description: "Spesa per la vendita", quantity: "390", unit: "kWh", unitPrice: "0,276410", amount, periodRaw: null },
  { code: "NETWORK_FIXED", description: "Spesa per la rete", quantity: "1", unit: "mese", unitPrice: null, amount: "1,92", periodRaw: null },
] });
const misread = billUnprintedValues(reading("170,80"), numbers);
assert.deepEqual(misread, ["Spesa per la vendita: importo 170,80 non stampato nel documento"], "the swapped digits are caught");
assert.equal(billUnprintedValues(reading("107,80"), numbers).length, 0, "a faithful reading has nothing to correct");
assert.ok(needsBillVerification({ gap: null, unprinted: misread }), "misread values send the bill to the verifier even when no total is read");
assert.ok(betterBillCheck({ gap: null, unprinted: misread }, { gap: null, unprinted: [] }), "the corrected reading is kept");
assert.ok(!betterBillCheck({ gap: null, unprinted: misread }, { gap: null, unprinted: misread }), "a reading no better is not kept");
assert.match(billReadingReviewPrompt(reading("170,80"), null, misread), /<valori_non_trovati>\nSpesa per la vendita: importo 170,80/);
assert.equal(billUnprintedValues(reading("170,80"), null).length, 0, "without a text layer nothing is flagged");

// The CTE verifier: the first reading returns a spread the CTE does not print, the second reads it right.
const cte = pdfWith(["Totale corrispettivi a consumo del venditore PUN Index GME + 0,03 EUR/kWh", "Totale corrispettivi fissi del venditore 156 EUR/POD/anno"]);
const field = (path, value) => ({ path, value, confidence: 0.9, sourcePage: 1, sourceText: `evidence:${path}`, status: "CONFIRMED" });
const extraction = (spread) => ({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("supplier.name", "Fornitore"), field("pricing.spread.amount", spread), field("commercialTerms.fixedFees", [{ feeId: "f1", label: "Quota fissa", amount: 156, currency: "EUR", unit: "EUR_PER_POD_YEAR" }])], extractionNotes: [] });
const sent = [];
const fetcher = async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: extraction(sent.length === 1 ? 0.04 : 0.03) }] }); };
const env = { CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "unit-test-key-only", ANTHROPIC_MODEL: "unit-test-model", ANTHROPIC_BASE_URL: "https://api.anthropic.com" };
const result = await getConfiguredCteOcrProvider(env, fetcher).extract({ bytes: cte, contentType: "application/pdf", fileName: "cte.pdf" });
assert.equal(sent.length, 2, "the CTE was read a second time");
assert.match(sent[1].messages[0].content[1].text, /pricing\.spread\.amount = 0\.04 non stampato/);
assert.equal(result.fields.find((item) => item.path === "pricing.spread.amount").value, 0.03, "the corrected spread is kept");

const faithful = [];
await getConfiguredCteOcrProvider(env, async (_url, init) => { faithful.push(init); return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: extraction(0.03) }] }); }).extract({ bytes: cte, contentType: "application/pdf", fileName: "cte.pdf" });
assert.equal(faithful.length, 1, "a CTE whose numbers the PDF confirms is not read again");

// A CTE whose text layer cannot be decoded (embedded fonts, as BPower's) is always checked by the verifier.
const opaque = [];
const opaqueResult = await getConfiguredCteOcrProvider(env, async (_url, init) => { opaque.push(JSON.parse(init.body)); return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: extraction(opaque.length === 1 ? 0.04 : 0.03) }] }); }).extract({ bytes: new Uint8Array(Buffer.from("%PDF-1.7 no text layer")), contentType: "application/pdf", fileName: "cte.pdf" });
assert.equal(opaque.length, 2, "the verifier read the CTE");
assert.match(opaque[1].messages[0].content[1].text, /Sei il verificatore/);
assert.equal(opaqueResult.fields.find((item) => item.path === "pricing.spread.amount").value, 0.03, "the verifier's reading is kept");
console.log("READING_VERIFIER_AGENTS=PASS");
