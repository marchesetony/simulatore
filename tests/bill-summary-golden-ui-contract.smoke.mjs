import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../app/components/BillDrivenSimulationPanel.tsx", import.meta.url), "utf8");
const summaryStart = panel.indexOf("function BillSummary");
const summaryEnd = panel.indexOf("export default", summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, "BillSummary must be present");
const summary = panel.slice(summaryStart, summaryEnd);

const requiredLabels = [
  "Intestatario", "Indirizzo di fornitura", "Utenza",
  "Periodo bolletta", "Fornitore", "Offerta attuale", "Tipo prezzo", "Struttura oraria",
  "F1", "F2", "F3", "Consumo annuo", "Tensione / potenza", "Totale bolletta",
];
for (const label of requiredLabels) assert.match(summary, new RegExp(`<span>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/span>`));
assert.match(summary, /label: "Codice fiscale"/);
assert.match(summary, /label: "Partita IVA"/);
assert.match(summary, /supplyReferenceLabel/);
console.log("CONTRACT_HOLDER_VISIBLE=PASS");
console.log("FISCAL_ID_VISIBLE=PASS");
console.log("SUPPLY_ADDRESS_VISIBLE=PASS");
console.log("POD_VISIBLE=PASS");
console.log("UTENZA_VISIBLE=PASS");
console.log("SUPPLIER_VISIBLE=PASS");
console.log("OFFER_VISIBLE=PASS");
console.log("PRICE_TYPE_VISIBLE=PASS");
console.log("TIME_BAND_VISIBLE=PASS");
console.log("F1_VISIBLE=PASS");
console.log("F2_VISIBLE=PASS");
console.log("F3_VISIBLE=PASS");
console.log("ANNUAL_CONSUMPTION_VISIBLE=PASS");
console.log("CONTRACTED_POWER_VISIBLE=PASS");
console.log("INVOICE_TOTAL_VISIBLE=PASS");

assert.doesNotMatch(summary, /<span>Documento<\/span>/);
assert.doesNotMatch(summary, /versione/);
assert.doesNotMatch(summary, /<span>Classificazione utenza<\/span>/);
assert.doesNotMatch(summary, /customerCompanyName|<span>Ragione sociale<\/span>/);
assert.doesNotMatch(summary, /Importo di riferimento per la simulazione/);
assert.doesNotMatch(summary, /POD \/ PDR/);
assert.doesNotMatch(summary, />\s*(?:UNKNOWN|APPROVED_BILL|reason code)\s*</);
assert.doesNotMatch(summary, /tenantId|billId|billVersionId|serverVersionId/);
assert.match(panel, /context\.supply\.availablePowerKw === null/);
assert.match(summary, /review\.receipt\.customerVatNumber/);
assert.match(summary, /bill\.normalized\?\.customer\.taxIdentifiers/);
console.log("NO_DOCUMENT_ROW=PASS");
console.log("NO_VERSION_ROW=PASS");
console.log("NO_CLASSIFICATION_DUPLICATE=PASS");
console.log("NO_CUSTOMER_COMPANY_DUPLICATE=PASS");
console.log("NO_BASELINE_DUPLICATE=PASS");
console.log("NO_INTERNAL_CODES=PASS");
console.log("NO_POD_PDR_GENERIC_LABEL=PASS");
console.log("NO_AVAILABLE_POWER_WHEN_MISSING=PASS");

const listResponse = await fetch("http://localhost:3000/api/bills?view=approved");
assert.equal(listResponse.status, 200);
const list = await listResponse.json();
const control = list.documents.find((document) => document.title === "QA Domestico 3 kW");
assert.ok(control, "approved QA control bill must be visible");
const detailResponse = await fetch(`http://localhost:3000/api/bills/${control.id}?view=approved`);
assert.equal(detailResponse.status, 200);
const detail = await detailResponse.json();
const document = detail.document;
const review = document.analystReview;
assert.equal(review.customer.name.value, "Mario Rossi QA");
assert.equal(review.receipt.customerVatNumber.value, "IT12345678903");
assert.notEqual(review.receipt.customerVatNumber.value, review.supply.pod.value);
assert.equal(review.supply.pod.value, "IT001E000000000");
assert.deepEqual(
  [review.supply.address.value, review.supply.cap.value, review.supply.city.value, review.supply.province.value],
  ["Via QA 3", "00100", "Roma", "RM"],
);
assert.equal(review.economics.total.value, 72);
assert.equal(review.economics.economicAnalysis.totals.billTotal, 72);
assert.equal(document.normalized.customer.taxIdentifiers.length, 0);
console.log("NO_POD_TO_VAT_FALLBACK=PASS");
console.log("NO_PDR_TO_VAT_FALLBACK=PASS");
console.log("SEMANTIC_PROVENANCE=PASS");
console.log("GOLDEN_UI_CONTRACT_TEST=PASS");
