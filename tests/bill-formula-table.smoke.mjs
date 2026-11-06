import assert from "node:assert/strict";

import { extractDocumentPriceRows } from "../app/lib/ingestion/document-numeric-evidence.ts";
import { estimateBillSpread } from "../app/lib/market/bill-spread.ts";

// HERA-style detail page: the sale-of-energy cost "Calcolata tramite la seguente formula", one row per component (EUR/kWh).
const rows = [["Prezzo Netto", "+0,225353"], ["Contributo sui consumi", "+0,015900"], ["Dispacciamento fascia F1", "+0,011551"], ["Corrispettivo mercato capacità", "+0,003517"], ["Sbilanciamento", "+0,006000"]];
const text = ["BT /F1 8 Tf 1 0 0 1 60 700 Tm (Calcolata tramite la seguente formula:) Tj 1 0 0 1 400 700 Tm (09/2026) Tj",
  ...rows.map(([label, value], index) => `1 0 0 1 60 ${680 - index * 15} Tm (${label}) Tj 1 0 0 1 400 ${680 - index * 15} Tm (${value}) Tj`), "ET"].join("\n");
const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>", `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
const pdf = `%PDF-1.4\n${objects.map((body, index) => `${index + 1} 0 obj\n${body}\nendobj\n`).join("")}trailer\n<< /Root 1 0 R >>\n%%EOF`;
const found = extractDocumentPriceRows(new Uint8Array(Buffer.from(pdf, "latin1")));
assert.deepEqual(found.map((row) => [row.label, row.unitPrice, row.period]), rows.map(([label, value]) => [label, value, "09/2026"]));

// The rows read from the PDF give the applied price even when the AI returned no price: dispatching, capacity and imbalance stay out.
const field = (value) => ({ value, status: "FOUND" });
const bill = { vector: field("EE"), f1Consumption: field(674.054), f2Consumption: field(399.716), f3Consumption: field(584.913), extendedFacts: [{ code: "PRICE_TIME_STRUCTURE_RAW", value: "Orario", status: "FOUND" }], economicChargeLines: [], documentPriceRows: found };
const record = { status: "APPROVED", vector: "EE", index: "PUN", month: "2026-09", updatedAt: "2026-10-12T00:00:00Z", record: { vector: "EE", index: "PUN", f1: { value: 120 }, f2: { value: 110 }, f3: { value: 100 }, monthly: { value: 112 } } };
const spread = estimateBillSpread(bill, ["2026-09"], [record], () => true, "2026-10-26");
const pun = (0.120 * 674.054 + 0.110 * 399.716 + 0.100 * 584.913) / 1658.683;
assert.equal(spread.status, "CALCULATED");
assert.equal(spread.structure, "HOURLY");
assert.ok(Math.abs(spread.referencePun - pun) < 1e-9);
// Product rule (Tony, 26/10): on HERA bills the spread is the "Contributo sui consumi" row of the formula table.
assert.equal(spread.source, "BILL");
assert.ok(Math.abs(spread.spread - 0.0159) < 1e-9);
assert.equal(spread.lines[0].label, "Contributo sui consumi");
// Without the energy price the reference PUN of the month is still returned.
const noPrice = estimateBillSpread({ ...bill, documentPriceRows: [] }, ["2026-09"], [record], () => true, "2026-10-26");
assert.equal(noPrice.status, "PRICE_MISSING");
assert.ok(Math.abs(noPrice.referencePun - pun) < 1e-9);
// The band PUN values are listed next to the reference PUN.
assert.deepEqual(spread.referenceBands.map((item) => [item.band, Math.round(item.pun * 1000) / 1000]), [["F1", 0.12], ["F2", 0.11], ["F3", 0.1]]);
console.log("BILL_FORMULA_TABLE=PASS");
