import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zlibSync } from "fflate";
import { ARERA_TIV_PAGE, createAreraCapacitySourceReader, parseAreraCapacityText, pdfCompactText } from "../app/lib/regulatory-refresh/arera-capacity.ts";
import { pdfTextLayer } from "../app/lib/regulatory-refresh/pdf-text.ts";
import { extractTernaTideTotal, importTernaTideQuarter } from "../app/lib/foundation/terna-electricity-regulatory.ts";
import { documentTextItems } from "../app/lib/ingestion/document-numeric-evidence.ts";

// Tony (30/10): "ancora errori" — 338/2026, 343/2026 and Terna TIDE Q4 gave empty text (len=0). The official PDFs come
// from modern exporters: indirect /Length (LibreOffice), Type0 Identity-H fonts with ToUnicode, object streams with an
// xref stream, encryption with an empty user password, incremental updates, ASCII85/LZW filters, inherited resources.
// The fixtures are synthetic (tests/fixtures/pdf/generate.py) and carry the published sentences of art. 4.1 and art. 1.1.
const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/pdf/${name}`, import.meta.url)));
const october = [{ month: "2026-10", centsPerKwh: 0.3423 }, { month: "2026-11", centsPerKwh: 0.3423 }, { month: "2026-12", centsPerKwh: 0.9243 }];

// 338/2026 art. 4.1: "a) 0,3423 c€/kWh per il mese di ottobre 2026; b) 0,3423 ... novembre 2026; c) 0,9243 ... dicembre 2026."
for (const name of ["arera-338-2026-libreoffice-tagged.pdf", "arera-338-2026-type0-objstm.pdf", "regulatory-features-handcrafted.pdf"]) {
  const read = pdfCompactText(fixture(name));
  assert.equal(read.status, "AVAILABLE", `${name}: ${read.reason}`);
  assert.ok(read.text.includes("a)0,3423c€/kWhperilmesediottobre2026;"), `${name}: ${read.text.slice(0, 200)}`);
  assert.deepEqual(parseAreraCapacityText(read.text).months, october, name);
}
assert.equal(parseAreraCapacityText(pdfCompactText(fixture("arera-338-2026-libreoffice-tagged.pdf")).text).publicationDate, "2026-09-29");
console.log("ARERA_338_2026_TEXT_LAYER=PASS");

// 343/2026 art. 1.1: "... di cui alla Tabella 1 allegata alla deliberazione 227/2026/R/com, sono confermati." (the check of decisionConfirms)
for (const name of ["arera-343-2026-libreoffice-incremental.pdf", "arera-343-2026-type0-objstm-aes256.pdf"]) {
  const { text, status, reason } = pdfCompactText(fixture(name));
  assert.equal(status, "AVAILABLE", `${name}: ${reason}`);
  assert.ok(/sonoconfermat/i.test(text) && text.includes("227/2026/R/com"), `${name}: ${text.slice(-200)}`);
  assert.ok(text.includes("dicuiallaTabella1allegataalladeliberazione227/2026/R/com,sonoconfermati."), name);
}
console.log("ARERA_343_2026_CONFIRMATION=PASS");

// Terna TIDE Q4 (invented values): the total is the largest seven-decimal value, read through the importer too.
for (const name of ["terna-tide-2026q4-reportlab-aes128.pdf", "terna-tide-2026q4-rc4.pdf"]) {
  const layer = pdfTextLayer(fixture(name));
  assert.equal(layer.status, "AVAILABLE", `${name}: ${layer.reason}`);
  assert.match(layer.text, /Unità essenziali in regime di reintegrazione/);
  assert.equal(extractTernaTideTotal(layer.text), 0.9876, name);
}
const quarter = { year: 2026, quarter: 4, effectiveFrom: "2026-10-01", effectiveTo: "2027-01-01" };
const discovery = { frontendScriptCount: 0, networkEndpointCandidates: [], dispatchingEndpoint: "https://dati.terna.it/api/sitecore/dati/corrispettivi/get", capacityEndpoint: "https://dati.terna.it/api/sitecore/dati/corrispettivi/get", dispatchingDatasource: "TIDE", capacityDatasource: "CM" };
const respond = (bytes, type) => ({ status: 200, headers: { get: (key) => key.toLowerCase() === "content-type" ? type : null }, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const ternaSite = (pdf) => async (url) => url.includes("/corrispettivi/get")
  ? respond(new TextEncoder().encode(JSON.stringify({ Results: [{ Title: "Corrispettivi di dispacciamento TIDE 4Q2026", Url: "/docs/tide-4q2026.pdf", PublicationDate: "25/09/2026" }] })), "application/json")
  : respond(pdf, "application/pdf");
const tide = await importTernaTideQuarter({ tenantId: "tenant_pdf-text-smoke", retrievedAt: "2026-10-30T03:15:00.000Z", quarter, discovery, fetcher: ternaSite(fixture("terna-tide-2026q4-reportlab-aes128.pdf")) });
assert.equal(tide.records[0].originalValue, 0.9876);
console.log("TERNA_TIDE_2026Q4_TEXT_LAYER=PASS");

// A document with no text says why, in the errors of the ARERA capacity reader and of the Terna importer.
const latin1 = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const content = zlibSync(latin1("q 100 0 0 100 0 0 cm /Im1 Do Q"));
const scanned = new Uint8Array([...latin1(`%PDF-1.7\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n3 0 obj\n<</Type/Page/Parent 2 0 R/Contents 4 0 R>>\nendobj\n4 0 obj\n<</Length ${content.length}/Filter/FlateDecode>>\nstream\n`), ...content, ...latin1("\nendstream\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n")]);
const empty = pdfCompactText(scanned);
assert.equal(empty.text, ""); assert.equal(empty.status, "NOT_AVAILABLE"); assert.match(empty.reason, /^TEXT_LAYER_EMPTY:pages=1,streams=1/);
const locked = pdfTextLayer(fixture("terna-tide-2026q4-user-password.pdf"));
assert.equal(locked.status, "FAIL_CLOSED"); assert.equal(locked.reason, "ENCRYPTED_PASSWORD_REQUIRED");
const areraSite = async (url) => url === ARERA_TIV_PAGE ? respond(new TextEncoder().encode("Versione modificata con la deliberazione 338/2026/R/eel"), "text/html") : url.endsWith("/338-2026-R-eel.pdf") ? respond(scanned, "application/pdf") : { status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
const loaded = await createAreraCapacitySourceReader({ fetcher: areraSite }).load({ retrievedAt: "2026-10-30T03:15:00.000Z" });
assert.equal(loaded.resolutions.length, 0); assert.match(loaded.unread[0], /^338\/2026\/R\/eel:len=0:NOT_AVAILABLE:TEXT_LAYER_EMPTY:pages=1/);
await assert.rejects(importTernaTideQuarter({ tenantId: "tenant_pdf-text-smoke", retrievedAt: "2026-10-30T03:15:00.000Z", quarter, discovery, fetcher: ternaSite(fixture("terna-tide-2026q4-user-password.pdf")) }), /TERNA_TIDE_VALUE_NOT_FOUND:len=\d+:.*FAIL_CLOSED:ENCRYPTED_PASSWORD_REQUIRED/);
console.log("PDF_TEXT_EMPTY_REASON=PASS");

// The bill reader stays fail-closed on what it does not read: the tolerant reader is used only for official documents.
assert.equal(documentTextItems(fixture("arera-343-2026-libreoffice-incremental.pdf")).reason, "PDF_OBJECTS_INVALID");
assert.equal(documentTextItems(fixture("arera-338-2026-libreoffice-tagged.pdf")).status, "FAIL_CLOSED");
console.log("BILL_READER_FAIL_CLOSED=PASS");
