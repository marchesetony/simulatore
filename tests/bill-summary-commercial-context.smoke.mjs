import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../app/components/BillDrivenSimulationPanel.tsx", import.meta.url), "utf8");
const summaryStart = panel.indexOf("function BillSummary");
const summaryEnd = panel.indexOf("export default", summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, "BillSummary must be present");
const summary = panel.slice(summaryStart, summaryEnd);

assert.match(summary, /<span>Intestatario<\/span>/);
assert.match(summary, /review\.customer\.name/);
assert.doesNotMatch(summary, /Ragione sociale/);
assert.match(summary, /Codice fiscale/);
assert.match(summary, /Partita IVA/);
console.log("CONTRACT_HOLDER_UI_TEST=PASS");
console.log("FISCAL_ID_UI_TEST=PASS");

assert.match(summary, /<span>Fornitore<\/span>/);
assert.match(summary, /<span>Offerta attuale<\/span>/);
assert.doesNotMatch(summary, /<span>Documento<\/span>|versione/);
assert.doesNotMatch(summary, /POD \/ PDR/);
assert.doesNotMatch(summary, /versione \{bill\.currentVersionNumber\}/);
console.log("SUPPLIER_OFFER_SEPARATION_TEST=PASS");
console.log("INTERNAL_BILL_VERSION_HIDDEN=PASS");

assert.match(summary, /pricingLabelFor\(review\.receipt\.priceMechanism\)/);
assert.match(summary, /<span>Tipo prezzo<\/span>/);
assert.match(summary, /timeBandLabelFor\(review\.receipt\.priceTimeStructure\)/);
assert.match(summary, /<span>Struttura oraria<\/span>/);
console.log("PRICING_TYPE_UI_TEST=PASS");
console.log("TIME_BAND_UI_TEST=PASS");

assert.match(summary, /<span>F1<\/span>/);
assert.match(summary, /<span>F2<\/span>/);
assert.match(summary, /<span>F3<\/span>/);
assert.match(summary, /<span>Consumo annuo<\/span>/);
console.log("CONSUMPTION_LABELS_TEST=PASS");

assert.match(summary, /<span>Totale bolletta<\/span>/);
assert.match(summary, /parseMoney\(reviewText\(review\.economics\.total\)\)/);
assert.doesNotMatch(summary, /Importo di riferimento per la simulazione/);
assert.doesNotMatch(summary, /economicBaseline/);
console.log("INVOICE_TOTAL_TEST=PASS");
console.log("BASELINE_SEMANTICS_TEST=PASS");

assert.match(summary, /extraordinaryItems/);
assert.match(summary, /Voci da verificare/);
assert.match(summary, /non devono essere considerate automaticamente/);
console.log("EXTRAORDINARY_ITEMS_TEST=PASS");

assert.match(panel, /bill\.analystReview/);
assert.match(panel, /context\.economicBaseline/);
assert.doesNotMatch(summary, /tenantId|billId|billVersionId|serverVersionId|offerCode|provenance|raw/);
console.log("SERVER_AUTHORITY_TEST=PASS");

const response = await fetch("http://localhost:3000/api/bills?view=approved");
assert.equal(response.status, 200);
const list = await response.json();
const control = list.documents.find((document) => document.title === "QA Domestico 3 kW");
assert.ok(control, "QA control bill must be visible");
const detailResponse = await fetch(`http://localhost:3000/api/bills/${control.id}?view=approved`);
assert.equal(detailResponse.status, 200);
const detail = await detailResponse.json();
const review = detail.document.analystReview;
assert.equal(review.customer.name.value, "Mario Rossi QA");
assert.equal(review.receipt.customerCompanyName.value, null);
assert.equal(review.receipt.customerVatNumber.value, "IT12345678903");
assert.equal(review.supply.pod.value, "IT001E000000000");
assert.equal(review.supply.address.value, "Via QA 3");
assert.equal(review.supply.supplier.value, "Fornitore QA");
assert.equal(review.receipt.offerName.value, "Offerta QA Indicizzata");
assert.equal(review.receipt.priceMechanism, "INDEXED_PUN_PLUS_SPREAD");
assert.equal(review.receipt.priceTimeStructure, "F1_F2_F3");
assert.equal(review.consumption.f1.value, 75);
assert.equal(review.consumption.f2.value, 65);
assert.equal(review.consumption.f3.value, 85);
assert.equal(review.economics.economicAnalysis.totals.billTotal, 72);
console.log("QA_FIXTURE_COMMERCIAL_CONTEXT=PASS");
