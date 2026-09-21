import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../app/components/BillDrivenSimulationPanel.tsx", import.meta.url), "utf8");
const summaryStart = panel.indexOf("function BillSummary");
const summaryEnd = panel.indexOf("export default", summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, "BillSummary must be present");
const summary = panel.slice(summaryStart, summaryEnd);

assert.match(summary, /review\.customer\.name/);
assert.doesNotMatch(summary, /customerCompanyName|Ragione sociale|customer\.name\) \?\? company/);
assert.match(summary, /review\.receipt\.customerVatNumber/);
assert.doesNotMatch(summary, /supply\.(pod|pdr).*customer|customer.*supply\.(pod|pdr)/);
console.log("NO_POD_TO_VAT_FALLBACK=PASS");
console.log("NO_PDR_TO_VAT_FALLBACK=PASS");
console.log("NO_FALSE_CUSTOMER_COMPANY_DUPLICATION=PASS");

assert.match(summary, /review\.supply\.address/);
assert.match(summary, /review\.supply\.cap/);
assert.match(summary, /review\.supply\.city/);
assert.match(summary, /review\.supply\.province/);
assert.match(summary, /Indirizzo di fornitura/);
console.log("SUPPLY_ADDRESS_SOURCE_TEST=PASS");
console.log("FISCAL_IDENTIFIER_SOURCE_TEST=PASS");

assert.match(summary, /review\.supply\.supplier/);
assert.doesNotMatch(summary, /reviewText\(review\.supply\.supplier\) \?\?/);
assert.match(summary, /review\.receipt\.offerName/);
assert.doesNotMatch(summary, /reviewText\(review\.receipt\.offerName\) \?\?/);
console.log("SUPPLIER_SOURCE_TEST=PASS");
console.log("OFFER_SOURCE_TEST=PASS");

assert.match(summary, /<span>F1<\/span>/);
assert.match(summary, /<span>F2<\/span>/);
assert.match(summary, /<span>F3<\/span>/);
assert.match(summary, /context\.consumption\.period\.f1/);
assert.match(summary, /context\.consumption\.period\.f2/);
assert.match(summary, /context\.consumption\.period\.f3/);
console.log("CONSUMPTION_SOURCE_TEST=PASS");

assert.match(summary, /parseMoney\(reviewText\(review\.economics\.total\)\)/);
assert.doesNotMatch(summary, /economicAnalysis\.totals\.billTotal/);
assert.match(panel, /baseline: context\.economicBaseline/);
assert.doesNotMatch(summary, /economicBaseline|Importo di riferimento per la simulazione/);
console.log("INVOICE_TOTAL_SOURCE_TEST=PASS");
console.log("BASELINE_SOURCE_TEST=PASS");

assert.match(summary, /economicAnalysis\.components/);
assert.match(summary, /item\.status === "FOUND"/);
assert.match(summary, /CMOR/);
assert.match(summary, /INTERESSI_MORA/);
console.log("EXTRAORDINARY_ITEMS_SOURCE_TEST=PASS");

assert.match(summary, /review\.supply\.pod/);
assert.match(summary, /review\.supply\.pdr/);
assert.doesNotMatch(summary, /POD \/ PDR/);
assert.doesNotMatch(summary, /<span>Documento<\/span>|versione/);
assert.doesNotMatch(summary, /<span>Classificazione utenza<\/span>/);
assert.match(summary, /<span>Utenza<\/span>/);
assert.doesNotMatch(summary, /tenantId|billId|billVersionId|serverVersionId|offerCode|provenance|raw/);
console.log("SERVER_AUTHORITY_TEST=PASS");

const listResponse = await fetch("http://localhost:3000/api/bills?view=approved");
assert.equal(listResponse.status, 200);
const list = await listResponse.json();
const control = list.documents.find((document) => document.title === "QA Domestico 3 kW");
assert.ok(control, "approved QA control bill must be visible");
const detailResponse = await fetch(`http://localhost:3000/api/bills/${control.id}?view=approved`);
assert.equal(detailResponse.status, 200);
const detail = await detailResponse.json();
const review = detail.document.analystReview;
assert.notEqual(review.receipt.customerVatNumber.value, review.supply.pod.value);
assert.equal(review.customer.name.value, "Mario Rossi QA");
assert.equal(review.receipt.customerVatNumber.value, "IT12345678903");
assert.equal(review.supply.pod.value, "IT001E000000000");
assert.equal(review.supply.address.value, "Via QA 3");
assert.equal(review.supply.cap.value, "00100");
assert.equal(review.supply.city.value, "Roma");
assert.equal(review.supply.province.value, "RM");
assert.equal(review.customer.taxIdentifier.value, null);
assert.equal(review.economics.total.value, 72);
console.log("QA_APPROVED_PROVENANCE_FIXTURE=PASS");
console.log("BILL_SUMMARY_REGRESSION_RECOVERY=PASS");
