import assert from "node:assert/strict";
import { deriveInvoiceReferenceMonths } from "../app/lib/market/pun-reference.ts";
import { extractExplicitPublicationDate, findPublicationLink } from "../app/lib/market/gme-publication.ts";
import { isAllowedGmeUrl, marketRateToEurPerKwh, parseGmeOfficialPublication } from "../app/lib/market/gme-pun-source.ts";

assert.deepEqual(deriveInvoiceReferenceMonths({ periodStart: "2026-06-15", periodEnd: "2026-07-15" }), ["2026-06", "2026-07"]);
assert.deepEqual(deriveInvoiceReferenceMonths({ periodStart: "2026-08-01", periodEnd: "2026-09-01" }), ["2026-08"]);
console.log("REFERENCE_MONTH_DERIVATION=OK");

assert.equal(isAllowedGmeUrl("https://gme.mercatoelettrico.org/pubblicazioni/luglio-2026"), true);
assert.equal(isAllowedGmeUrl("https://www.gme.it/pubblicazioni/luglio-2026"), false);
assert.equal(isAllowedGmeUrl("https://example.test/redirect"), false);
console.log("GME_DOMAIN_ALLOWLIST=OK");

const discovery = "<a href=\"/pubblicazioni/luglio-2026.pdf\">Prezzo medio per fasce luglio 2026</a><a href=\"/pubblicazioni/luglio-2025.pdf\">Prezzo medio per fasce luglio 2025</a>";
assert.equal(findPublicationLink(discovery, "https://gme.mercatoelettrico.org/archivio", "2026-07"), "https://gme.mercatoelettrico.org/pubblicazioni/luglio-2026.pdf");
assert.equal(findPublicationLink(discovery, "https://gme.mercatoelettrico.org/archivio", "2025-07"), "https://gme.mercatoelettrico.org/pubblicazioni/luglio-2025.pdf");
console.log("DISCOVERY_MONTH_YEAR_DYNAMIC=OK");
assert.equal(extractExplicitPublicationDate("Pubblicato il 03/08/2026"), "2026-08-03");
assert.equal(extractExplicitPublicationDate("nessuna data semantica"), null);
console.log("PUBLICATION_DATE_EXPLICIT_ONLY=OK");

const parsed = parseGmeOfficialPublication({
  tenantId: "tenant_test",
  referenceMonth: "2026-07",
  publicationText: "Pubblicazioni Prezzo medio per fasce luglio 2026\nF1 101,10 EUR/MWh\nF2 99,20 EUR/MWh\nF3 97,30 EUR/MWh",
  sourceReference: "https://gme.mercatoelettrico.org/pubblicazioni/luglio-2026",
  publishedAt: "2026-08-05",
  retrievedAt: "2026-08-17T00:00:00.000Z",
});
assert.equal(parsed.month, "2026-07");
assert.equal(parsed.f1?.unit, "EUR_PER_MWH");
assert.equal(parsed.f2?.value, 99.2);
assert.equal(parsed.f3?.value, 97.3);
console.log("GME_LABEL_BAND_PARSER=OK");

assert.deepEqual(marketRateToEurPerKwh(101.1, "EUR_PER_MWH"), { value: 0.1011, sourceValue: 101.1, sourceUnit: "EUR_PER_MWH", targetUnit: "EUR_PER_KWH" });
console.log("EUR_MWH_TO_KWH=OK");
console.log("bill GME invoice-period offline smoke: ok");
