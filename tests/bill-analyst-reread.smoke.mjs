import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBillOperation, storedBillContentType } from "../app/lib/foundation/real-bill.ts";

// Tony (1/11, "non funziona, le bollette non riesci a leggerle"): a bill whose charge lines were not read (second reading
// failed) can be read again from its stored file, without uploading it again, and every user sees why and the button.
assert.deepEqual(parseBillOperation({ operation: "reread-analyst", versionId: "v1" }), { operation: "reread-analyst", versionId: "v1" });
assert.equal(parseBillOperation({ operation: "reread-analyst" }), null);
assert.equal(parseBillOperation({ operation: "reread-analyst", versionId: "v1", extra: 1 }), null);
assert.equal(storedBillContentType(new Uint8Array(Buffer.from("%PDF-1.7"))), "application/pdf");
assert.equal(storedBillContentType(new Uint8Array([0xff, 0xd8, 0xff, 0])), "image/jpeg");
assert.equal(storedBillContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "image/png");
assert.equal(storedBillContentType(new Uint8Array([1, 2, 3, 4])), null);
const route = readFileSync(new URL("../app/api/bills/[id]/route.ts", import.meta.url), "utf8");
assert.match(route, /operation === "reread-analyst"[\s\S]*extractAnalystOnly[\s\S]*createAnalystRefreshVersion/);
assert.match(route, /export const maxDuration = 300;/);
const bill = readFileSync(new URL("../app/lib/foundation/real-bill.ts", import.meta.url), "utf8");
// Tony (1/11, "leggere lo scontrino della bolletta"): a failed second reading completed by the printed scontrino is not unread.
assert.match(bill, /\(working\.structuredBill\.analystExtractionStatus === "FAILED" && !readingHasScontrino\(working\.structuredBill\)\) \|\| \(working\.structuredBill\.economicChargeLines\?\.length \?\? 0\) === 0/);
// Tony (1/11, "anche quella letta da immagine"): an image bill's transcript is refined the same way.
// Tony (2/11, J Fuel 20.000 V and bimonthly Enel bill): the reread also takes the printed voltage and period from the PDF text.
assert.match(route, /const scontrino = transcript \? withScontrinoTranscript\(extraction, transcript\) : withPrintedScontrino\(extraction, text\); return withTextVoltage\(withTextBillingPeriod\(scontrino, pdfText\), pdfText\);/);
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /Rileggi le voci della bolletta/);
assert.match(flow, /\{analystRetry\(draft\)\}/);
assert.match(flow, /\{analystRetry\(quote\.bill, quote\.offers\.length > 0 && quote\.offers\.every\(\(item\) => item\.receipt\.status !== "COMPLETE"\)\)\}/);
console.log("BILL_ANALYST_REREAD=PASS");
