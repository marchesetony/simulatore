import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { approveDocumentVersion, confirmBillFields, ingestBill, LocalBillRepository, LocalDocumentStorage, requiredFieldNames, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { ANNUAL_ESTIMATE_LABEL, assessConsumptionHistory, resolveAnnualConsumption } from "../app/lib/calculation/annual-consumption.ts";
import { annualConsumptionDetailOf } from "../app/lib/calculation/bill-driven.ts";
import { annualConsumptionLine, billAnnualConsumption } from "../app/lib/ui/annual-consumption.ts";
import { reviewSubmission } from "../app/lib/ui/bill-review-submission.ts";
import { billForReading, billReadSections } from "../app/lib/ui/bill-read-details.ts";

// Tony (12/11/2026, "CONSUMO ANNUO STIMATO", opzione B): declared first, else the valid monthly history (average × 12), else the
// billed period annualised on its months, else nothing; the estimate is labelled, shows its origin, keeps full precision and is
// never saved as the bill's declared annual consumption. Synthetic data only (no real customer, POD or supplier).
const BPOWER_070990E = [["2026-05", 342], ["2026-06", 445], ["2026-07", 518], ["2026-08", 377], ["2026-09", 344], ["2026-10", 348]].map(([month, quantity]) => ({ month, quantity }));
const base = { declared: null, billed: 344, periodStart: "2026-09-01", periodEnd: "2026-09-30" };

// 1. Caso di controllo: maggio–ottobre 2026, 6 mesi, 2.374 kWh, 395,666… kWh al mese, 4.748 kWh stimati.
const control = resolveAnnualConsumption({ ...base, history: BPOWER_070990E });
assert.equal(control.status, "ESTIMATED"); assert.equal(control.source, "HISTORY");
assert.equal(control.basisTotal, 2374); assert.equal(control.months.length, 6);
assert.equal(control.value, 2374 / 6 * 12); assert.equal(Math.round(control.value), 4748);
const controlLine = annualConsumptionLine(control, "kWh");
assert.match(controlLine, /^4\.748 kWh · CONSUMO ANNUO STIMATO — non rappresenta un consumo annuo effettivo · media di 6 mesi dello storico consumi \(maggio 2026 – ottobre 2026: 2\.374 kWh\) × 12$/);
console.log("CONTROL_BPOWER_070990E=PASS");

// 2. The declared value comes first and is never replaced.
const declared = resolveAnnualConsumption({ ...base, declared: 5000, history: BPOWER_070990E });
assert.deepEqual([declared.status, declared.value], ["DECLARED", 5000]);
assert.equal(annualConsumptionLine(declared, "kWh"), "5.000 kWh (dichiarato in bolletta)");
console.log("DECLARED_FIRST=PASS");

// 3. History checks.
const contradictory = [...BPOWER_070990E, { month: "2026-07", quantity: 600 }];
assert.equal(assessConsumptionHistory(contradictory).usable, false, "a month with two different values is not dropped silently");
assert.match(assessConsumptionHistory(contradictory).issues.join(" "), /2026-07 ripetuto nello storico con valori diversi \(518 e 600\)/);
const fallback = resolveAnnualConsumption({ ...base, history: contradictory });
assert.deepEqual([fallback.source, fallback.value], ["BILLED_PERIOD", 344 * 12], "unreliable history → billed period, determinable");
assert.match(annualConsumptionLine(fallback, "kWh"), /consumo del periodo fatturato 01\/09\/2026 – 30\/09\/2026 \(344 kWh in 1 mese\) ÷ 1 × 12, storico consumi non utilizzabile\. Note: mese 2026-07 ripetuto/);
const repeated = assessConsumptionHistory([...BPOWER_070990E, { month: "2026-07", quantity: 518 }]);
assert.equal(repeated.usable, true); assert.equal(repeated.months.length, 6, "the same consumption is counted once");
assert.equal(resolveAnnualConsumption({ ...base, history: [{ month: "2026-01", quantity: 0 }, { month: "2026-02", quantity: 100 }, { month: "2026-03", quantity: 200 }] }).value, 1200, "a month at 0 kWh counts");
const gaps = resolveAnnualConsumption({ ...base, history: [{ month: "2026-01", quantity: 100 }, { month: "2026-04", quantity: 200 }] });
assert.equal(gaps.value, 1800); assert.match(gaps.issues.join(" "), /mesi mancanti nello storico: 2026-02, 2026-03/);
assert.equal(assessConsumptionHistory([{ month: "2026-01", quantity: 0 }, { month: "2026-02", quantity: 0 }]).usable, false, "a history without consumption is not used");
const twelve = resolveAnnualConsumption({ ...base, history: [{ month: "2025-01", quantity: 9999 }, ...Array.from({ length: 12 }, (_, index) => ({ month: `2025-${String(index + 2).padStart(2, "0")}`.replace("2025-13", "2026-01"), quantity: 100 }))] });
assert.equal(twelve.value, 1200, "the latest twelve months only");
console.log("HISTORY_CHECKS=PASS");

// 4. Period fallback and insufficient data.
assert.equal(resolveAnnualConsumption({ ...base, billed: 1131.12, periodStart: "2026-06-01", periodEnd: "2026-07-31" }).value, 1131.12 / 2 * 12);
const none = resolveAnnualConsumption({ ...base, billed: 0, history: contradictory });
assert.deepEqual([none.status, none.value], ["NOT_DETERMINABLE", null], "no history and nothing billed: no value");
assert.equal(resolveAnnualConsumption({ ...base, periodEnd: "2026-09-05" }).value, null, "a period too short is not annualised");
console.log("FALLBACK_AND_INSUFFICIENT=PASS");

// 5. Full precision in the calculation, rounded on screen only.
const precise = resolveAnnualConsumption({ ...base, history: [1, 1, 1, 1, 2].map((quantity, index) => ({ month: `2026-0${index + 1}`, quantity })) });
assert.ok(Math.abs(precise.value - 14.4) < 1e-12); assert.match(annualConsumptionLine(precise, "kWh"), /^14 kWh · /);
assert.equal(annualConsumptionDetailOf({ vector: "EE", billingPeriod: { periodStart: "2026-09-01", periodEnd: "2026-09-30" }, consumption: { annual: null, period: { f1: 200, f2: 100, f3: 44, smc: null }, history: BPOWER_070990E } }).value, 2374 / 6 * 12, "CTE thresholds use the same estimate");
console.log("PRECISION=PASS");

// 6. An approved estimate never becomes the declared annual consumption.
const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 1, ...extra });
const reading = parseBillReading({
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "AZIENDA DI PROVA SRL", pod: "IT000E00000001",
  periodoStampato: "01/09/2026 - 30/09/2026", periodoDal: "2026-09-01", periodoAl: "2026-09-30",
  consumoFatturato: "344", consumoF1: "200", consumoF2: "100", consumoF3: "44", consumoAnnuo: "",
  totaleBolletta: "100,00",
  storicoConsumi: BPOWER_070990E.map(({ month, quantity }) => ({ mese: month, consumo: String(quantity) })),
  scontrino: [sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "100,00", { quantita: "344", unita: "kWh" }), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "100,00")],
  dettaglio: [],
  assenti: [{ campo: "consumoAnnuo", motivo: "non stampato" }],
});
const structured = toStructuredBill({ reading, checks: [], reread: false });
assert.equal(structured.annualConsumption.status, "NOT_FOUND");
assert.equal(requiredFieldNames.includes("annualConsumption"), false, "the annual consumption is not required to approve");
const root = await mkdtemp(path.join(os.tmpdir(), "annual-estimate-"));
try {
  const tenant = "tenant_prova-a";
  const document = await ingestBill({ tenantId: tenant, fileName: "prova.pdf", contentType: "application/pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.7 prova", "latin1")), maxBytes: 100_000, storage: new LocalDocumentStorage(root), repository: new LocalBillRepository(root), audit: { async record() {} }, structuredExtractor: { async extract() { return structured; } } });
  const publicBill = toPublicDocument(document);
  assert.equal(publicBill.fields.annualConsumption.value ?? null, null, "declared field empty after reading");
  // The review form: only what the bill says, nothing typed by the operator.
  const FIELDS = ["customerName", "supplier", "pod", "billingPeriod", "billedConsumption", "annualConsumption", "totalAmount"];
  const values = Object.fromEntries(FIELDS.map((field) => [field, publicBill.fields[field]?.value ?? ""]));
  const submission = reviewSubmission(FIELDS, values, publicBill.fields);
  assert.deepEqual(submission.missing, []);
  assert.equal(submission.confirm.includes("annualConsumption"), false);
  assert.deepEqual(submission.correct, [], "no correction is sent for the annual consumption");
  const confirmed = confirmBillFields({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: submission.confirm, at: "2026-11-12T10:00:00.000Z" });
  const approved = approveDocumentVersion({ document: confirmed, tenantId: tenant, versionId: confirmed.currentVersionId, at: "2026-11-12T10:01:00.000Z" });
  const version = approved.versions.find((item) => item.versionId === approved.currentApprovedVersionId);
  assert.ok(version, "approved without an annual consumption");
  assert.equal(version.fields.annualConsumption.value ?? null, null, "the declared field stays empty after approval");
  assert.equal(version.structuredBill?.annualConsumption?.status ?? "NOT_FOUND", "NOT_FOUND", "the reading still says it is not printed");
  // The estimate is computed apart, from the same reading, and shown labelled in "Dati letti".
  const shown = toPublicDocument(approved);
  const estimate = billAnnualConsumption(billForReading(shown));
  assert.deepEqual([estimate.status, estimate.source, Math.round(estimate.value)], ["ESTIMATED", "HISTORY", 4748]);
  const rows = billReadSections(billForReading(shown)).flatMap((section) => section.rows);
  assert.equal(rows.find((row) => row.label === "Consumo annuo")?.value, "Non presente nella fattura", "declared row unchanged");
  assert.equal(rows.findIndex((row) => row.label === ANNUAL_ESTIMATE_LABEL), rows.findIndex((row) => row.label === "Consumo annuo") + 1, "right after the declared row");
  const row = rows.find((item) => item.label === ANNUAL_ESTIMATE_LABEL);
  assert.ok(row, "estimate row present"); assert.equal(row.value, "4.748 kWh"); assert.equal(row.state, "CALCULATED");
  assert.match(row.note, /media di 6 mesi dello storico consumi \(maggio 2026 – ottobre 2026: 2\.374 kWh\) × 12/);
  // An operator who types the annual consumption printed on the bill still corrects it by hand.
  assert.deepEqual(reviewSubmission(FIELDS, { ...values, annualConsumption: "4.200" }, publicBill.fields).correct, [{ field: "annualConsumption", value: "4.200" }]);
  console.log("APPROVED_ESTIMATE_NOT_DECLARED=PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}

// 7. The screens: no estimate in the declared field; savings on an estimate say so (also in the proposal's basis label).
const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
assert.doesNotMatch(flow, /values\.annualConsumption = /, "the estimate is never put in the declared field");
assert.doesNotMatch(flow, /estimatedAnnual\(/);
assert.match(flow, /Risparmio annuo calcolato su consumi stimati: \$\{quantityText\(basis\.annual, unit\)\}, \$\{ANNUAL_ESTIMATE_LABEL\}, \$\{annualEstimateOrigin\(basis\.detail, unit\)\}/);
assert.match(flow, /<small>\{basisLabel\}<\/small>/, "screen and proposal share the label");
assert.match(flow, /annualConsumptionLine\(annual, quote\.context\.vector === "EE" \? "kWh" : "Smc"\)/, "the CTE threshold says where the annual comes from");
console.log("SCREENS=PASS");
console.log("annual consumption estimate OK");
