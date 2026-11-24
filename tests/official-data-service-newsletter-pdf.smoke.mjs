import assert from "node:assert/strict";
import fs from "node:fs";
import { readNewsletterPdf } from "../services/dati-ufficiali/src/gme/newsletter.ts";
import { publishedPdfText } from "../app/lib/market/gme-pun-source.ts";
import { officialPdfText } from "../services/dati-ufficiali/src/pdf-text.ts";

/**
 * Tony (24/11/2026, regola definitiva acquisizione GME): the PUN Index GME monthly value is read from the PDF as GME publishes it.
 * The real newsletters (n. 204 for May 2026 and the June–October ones) gave "testo del PDF non leggibile" with the minimal reader.
 * Fixtures: a newsletter-like page (gme-newsletter-libreoffice.html, synthetic text) exported by LibreOffice as a real-world PDF
 * (embedded subset TrueType fonts, compressed streams) and the same file encrypted (AES-256, empty user password), as many
 * published PDFs are. The minimal reader fails on both; pdf.js reads both; nothing is derived.
 */
const dir = new URL("./fixtures/official-data-service/", import.meta.url);
const plain = new Uint8Array(fs.readFileSync(new URL("gme-newsletter-libreoffice.pdf", dir)));
const encrypted = new Uint8Array(fs.readFileSync(new URL("gme-newsletter-libreoffice-aes256.pdf", dir)));

let minimal = ""; try { minimal = publishedPdfText(plain); } catch { minimal = ""; }
assert.ok(!/119,35/.test(minimal), "the minimal reader alone does not read a real-world PDF: the reason for pdf.js");

for (const [name, bytes] of [["plain", plain], ["aes-256", encrypted]]) {
  const before = bytes.slice();
  const reading = await readNewsletterPdf(bytes, "2026-05");
  assert.equal(reading.monthly, 119.35, name); assert.equal(reading.number, "204", name);
  assert.ok(reading.checks.every((check) => check.ok), `${name}: ${reading.checks.filter((check) => !check.ok).map((check) => check.detail).join("; ")}`);
  assert.match(reading.checks.find((check) => check.code === "TEXT").detail, /pdf\.js/);
  assert.deepEqual(bytes, before, `${name}: the downloaded bytes stay intact for SHA-256 and conservation`);
  assert.equal((await readNewsletterPdf(bytes, "2026-06")).monthly, null, `${name}: a report on May is not June`);
}
console.log("NEWSLETTER_REAL_WORLD_PDF_READ=PASS");

// Text that does not pass the checks gives no value, whatever the reader.
const altered = await officialPdfText(plain);
assert.match(altered, /Baseload\s+119,35/);
const broken = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF");
const unreadable = await readNewsletterPdf(broken, "2026-05");
assert.equal(unreadable.monthly, null);
assert.equal(unreadable.checks.find((check) => check.code === "TEXT").ok, false);
console.log("NEWSLETTER_UNREADABLE_GIVES_NO_VALUE=PASS");
console.log("official-data-service-newsletter-pdf smoke: OK");
