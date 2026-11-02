import assert from "node:assert/strict";
import { billingPeriodFromText, parseItalianPeriod, withTextBillingPeriod } from "../app/lib/ingestion/billing-period.ts";
import { BILL_WIRE_FIELD_NAMES, mapBillWireToStructuredBill, parseBillWireExtraction } from "../app/lib/ingestion/bill-wire.ts";
import { withReadBillingPeriodField } from "../app/lib/market/pun-reference.ts";

// Tony (2/11, "manca il periodo di riferimento, ricorda che delle bollette possono essere riferite a due mesi di fornitura come
// questa"): every printed form of the period is read, one month or two, and an empty period is read from the PDF text.
// Synthetic text shaped like an Enel bill; no customer data.
const span = (period) => period && [period.from, period.to];
assert.deepEqual(span(parseItalianPeriod("01/07/2026 - 31/08/2026")), ["2026-07-01", "2026-08-31"]);
assert.deepEqual(span(parseItalianPeriod("dal 1 luglio 2026 al 31 agosto 2026")), ["2026-07-01", "2026-08-31"]);
assert.deepEqual(span(parseItalianPeriod("luglio - agosto 2026")), ["2026-07-01", "2026-09-01"]);
assert.deepEqual(span(parseItalianPeriod("Luglio/Agosto 2026")), ["2026-07-01", "2026-09-01"]);
assert.deepEqual(span(parseItalianPeriod("dicembre 2025 - gennaio 2026")), ["2025-12-01", "2026-02-01"]);
assert.deepEqual(span(parseItalianPeriod("dicembre - gennaio 2026")), ["2025-12-01", "2026-02-01"]);
assert.deepEqual(span(parseItalianPeriod("lug 2026")), ["2026-07-01", "2026-08-01"]);
assert.deepEqual(span(parseItalianPeriod("07/2026")), ["2026-07-01", "2026-08-01"]);
assert.equal(parseItalianPeriod("31/08/2026 - 01/07/2026"), null, "a reversed range is not a period");
assert.equal(parseItalianPeriod("Totale bolletta 242,27"), null);

const text = ["Enel Energia", "Bolletta per la fornitura di energia elettrica", "Totale da pagare 242,27 €", "Periodo di fornitura:", "luglio - agosto 2026", "Consumo fatturato 869 kWh"].join("\n");
assert.deepEqual(span(billingPeriodFromText(text)), ["2026-07-01", "2026-09-01"]);
assert.deepEqual(span(billingPeriodFromText("Periodo fatturato dal 01/07/2026 al 31/08/2026\nScadenza 20/09/2026")), ["2026-07-01", "2026-08-31"]);
assert.equal(billingPeriodFromText("Scadenza 20/09/2026\nEmessa il 05/09/2026"), null, "dates outside a period row are not the period");

const empty = { billingPeriod: { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" } };
const filled = withTextBillingPeriod(empty, text);
assert.equal(filled.billingPeriod.status, "FOUND");
assert.deepEqual(span(filled.billingPeriod.value), ["2026-07-01", "2026-09-01"]);
const read = { billingPeriod: { value: { from: "2026-07-01", to: "2026-07-31", raw: "luglio 2026" }, status: "FOUND", confidence: 0.95, source: "DOCUMENT_AI" } };
assert.equal(withTextBillingPeriod(read, text), read, "a period already read is never changed");

// An archived bill with an empty "Periodo fatturato" shows the period for the agent to confirm.
const fields = { billingPeriod: { value: null, confidence: 0, source: "unavailable", confirmed: false }, supplier: { value: "Enel Energia", confidence: 1, source: "document-ai", confirmed: false } };
const shown = withReadBillingPeriodField({ fields, structuredBill: filled });
assert.equal(shown.fields.billingPeriod.value, "2026-07-01 - 2026-09-01");
assert.equal(shown.fields.billingPeriod.confirmed, false);
assert.equal(shown.fields.supplier, fields.supplier);
const confirmed = { ...fields, billingPeriod: { value: "2026-07-01 - 2026-07-31", confidence: 1, source: "document-ai", confirmed: true } };
assert.equal(withReadBillingPeriodField({ fields: confirmed, structuredBill: filled }).fields, confirmed, "a period already shown is kept");

// The AI reading writes the period as printed ("luglio - agosto 2026"): it is kept, not dropped.
const wire = { schemaVersion: 1 };
for (const name of BILL_WIRE_FIELD_NAMES) wire[name] = { value: "NOT_FOUND", status: "NOT_FOUND" };
delete wire.customerId;
wire.vector = { value: "EE", status: "FOUND" };
wire.billingPeriod = { value: "luglio - agosto 2026", status: "FOUND" };
const mapped = mapBillWireToStructuredBill(parseBillWireExtraction(wire));
assert.equal(mapped.billingPeriod.status, "FOUND");
assert.deepEqual(span(mapped.billingPeriod.value), ["2026-07-01", "2026-09-01"]);

console.log("billing-period smoke ok");
