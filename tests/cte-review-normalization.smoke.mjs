import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cteApprovalGate, normalizeCteReview, formatCteReviewValue } from "../app/lib/cte/review.ts";

const field = (path, value, sourceText = String(value), extra = {}) => ({ path, value, confidence: 0.93, sourcePage: 2, sourceText, status: value === null ? "NOT_FOUND" : "CONFIRMED", ...extra });
const values = [
  field("supplier.name", "Ragione sociale: BPower Energia S.p.A.", "Ragione sociale: BPower Energia S.p.A. P.IVA 01867000851"),
  field("offer.name", "Offerta commerciale: Be Relax 06.25", "Offerta commerciale: Be Relax 06.25"),
  field("offer.code", "Codice offerta: BR0625", "Codice offerta: BR0625"),
  field("validity.periodStart", "Validit\u00E0 dal 01/11/2025", "Validit\u00E0 dal 01/11/2025"),
  field("validity.periodEnd", "Validit\u00E0 fino al 31/12/2026", "Validit\u00E0 fino al 31/12/2026"),
  field("expiry.date", "Scadenza dichiarata: 31/12/2026", "Scadenza dichiarata: 31/12/2026"),
  field("eligibility.customerTypes", "Clienti non domestici, altri usi Business, oltre 1.500 e fino a 200.000 kWh/anno. Esclusioni: Pubblica illuminazione, Pubblica Amministrazione, Enti pubblici.", "Clienti non domestici, altri usi Business, oltre 1.500 e fino a 200.000 kWh/anno. Esclusioni: Pubblica illuminazione, Pubblica Amministrazione, Enti pubblici."),
  field("pricing.mode", "Prezzo indicizzato al PUN", "Prezzo indicizzato al PUN"),
  field("currency", "Euro (\u20AC)", "Euro (\u20AC)"),
  field("taxTreatment", "IVA e imposte escluse", "IVA e imposte escluse"),
  field("commercialTerms.fixedFees", "Quota fissa: 15,00 \u20AC/mese", "Quota fissa: 15,00 \u20AC/mese"),
  field("commercialTerms.variableFees", "Quota variabile: 0,003 \u20AC/kWh al netto delle perdite di rete", "Quota variabile: 0,003 \u20AC/kWh al netto delle perdite di rete"),
  field("commercialTerms.oneOffFees", "Una tantum: 1,50 \u20AC \u2014 Gestione APP e servizi", "Una tantum: 1,50 \u20AC \u2014 Gestione APP e servizi"),
  field("commercialTerms.imbalance", "Sbilanciamento: 0,005 \u20AC/kWh", "Sbilanciamento: 0,005 \u20AC/kWh"),
  field("eligibility.voltageLevels", "Alimentazioni in bassa o media tensione", "Alimentazioni in bassa o media tensione"),
  field("pricing.reference", "PUN", "PUN"),
  field("pricing.spread.amount", "Spread: 0,025 \u20AC/kWh", "Spread: 0,025 \u20AC/kWh"),
];
const review = normalizeCteReview({ vector: "EE", fields: values });
const commercial = new Map(review.commercialFields.map((item) => [item.fieldKey, item]));
assert.equal(review.currency, "EUR");
assert.equal(commercial.get("supplier.name")?.normalizedValue, "BPower Energia S.p.A.");
assert.equal(commercial.get("supplier.supplierId")?.label, "Partita IVA fornitore");
assert.equal(commercial.get("supplier.supplierId")?.normalizedValue, "01867000851");
assert.equal(commercial.get("supplier.supplierId")?.sourcePage, 2);
assert.equal(commercial.get("supplier.supplierId")?.status, "CONFIRMED");
assert.equal(commercial.get("offer.name")?.normalizedValue, "Be Relax 06.25");
assert.equal(commercial.get("validity.period")?.normalizedValue, "01/11/2025 \u2013 31/12/2026");
assert.equal(commercial.get("eligibility.customerTypes")?.normalizedValue, "Non domestico \u2013 Altri usi Business");
assert.equal(commercial.get("eligibility.consumptionRange")?.normalizedValue, "Oltre 1.500 e fino a 200.000 kWh/anno");
assert.deepEqual(commercial.get("eligibility.exclusions")?.normalizedValue, ["Pubblica illuminazione", "Pubblica Amministrazione", "Enti pubblici"]);
assert.equal(commercial.get("pricing.mode")?.normalizedValue, "Indicizzata");
assert.equal(commercial.get("pricing.reference")?.normalizedValue, "PUN");
assert.equal(commercial.get("pricing.spread.amount")?.normalizedValue, 0.025);
assert.equal(commercial.get("pricing.spread.amount")?.unit, "\u20AC/kWh");
assert.equal(commercial.get("commercialTerms.fixedFees")?.normalizedValue, 15);
assert.equal(commercial.get("commercialTerms.fixedFees")?.unit, "\u20AC/mese");
assert.equal(commercial.get("commercialTerms.variableFees")?.normalizedValue, 0.003);
assert.deepEqual(commercial.get("commercialTerms.variableFees")?.conditions, ["al netto delle perdite di rete"]);
assert.equal(commercial.get("commercialTerms.oneOffFees")?.normalizedValue, 1.5);
assert.equal(commercial.get("commercialTerms.oneOffFees")?.description, "Gestione APP e servizi");
assert.equal(commercial.get("eligibility.voltageLevels")?.normalizedValue, "BT / MT");
assert.equal(commercial.get("taxTreatment")?.normalizedValue, "IVA e imposte escluse");
assert.equal(commercial.has("expiry.date"), false);
assert.equal(commercial.get("supplier.name")?.sourceText, "Ragione sociale: BPower Energia S.p.A. P.IVA 01867000851");
assert.equal(formatCteReviewValue(commercial.get("pricing.spread.amount")), "0,025 \u20AC/kWh");
assert.equal(review.commercialFields.some((item) => item.fieldKey === "supplier.supplierId"), true);

const gas = normalizeCteReview({ vector: "GAS", fields: [field("pricing.reference", "PSV"), field("pricing.spread.amount", "0,080 \u20AC/Smc")] });
assert.equal(gas.commercialFields.find((item) => item.fieldKey === "pricing.reference")?.normalizedValue, "PSV");
const wrongEe = normalizeCteReview({ vector: "EE", fields: [field("pricing.reference", "PSV")] });
assert.equal(wrongEe.commercialFields.some((item) => item.fieldKey === "pricing.reference"), false);
assert.equal(wrongEe.notFoundFields.find((item) => item.fieldKey === "pricing.reference")?.status, "CONFIRMED");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirectory = path.join(root, "var", "phase6", "cte-archives", "tenant_local-demo");
const names = await readdir(runtimeDirectory).catch(() => []);
const currentRecords = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(runtimeDirectory, name), "utf8"))));
const current = currentRecords.filter((record) => ["REVIEW_REQUIRED", "APPROVED"].includes(record.payload?.status) && record.payload?.documentType === "CTE" && record.payload?.vector === "EE").sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
assert.ok(current, "latest local EE CTE review or approved record is required for regression");
const currentReview = normalizeCteReview(current.payload);
const currentCommercial = new Map(currentReview.commercialFields.map((item) => [item.fieldKey, item]));
assert.equal(currentCommercial.get("supplier.name")?.normalizedValue, "BPower Energia S.p.A.");
assert.equal(currentCommercial.get("supplier.supplierId")?.normalizedValue, "01867000851");
assert.equal(currentCommercial.get("supplier.supplierId")?.label, "Partita IVA fornitore");
assert.equal(currentCommercial.get("supplier.supplierId")?.status, "CONFIRMED");
assert.equal(currentCommercial.get("supplier.supplierId")?.sourcePage, 1);
const currentGate = cteApprovalGate(current.payload);
assert.equal(currentGate.blockers.some((item) => item.fieldKey === "supplier.supplierId"), false);
assert.equal(currentCommercial.get("offer.name")?.normalizedValue, "Be Relax 06.25");
assert.equal(currentCommercial.get("validity.period")?.normalizedValue, "01/11/2025 \u2013 31/12/2026");
assert.equal(currentCommercial.get("eligibility.customerTypes")?.normalizedValue, "Non domestico \u2013 Altri usi Business");
assert.equal(currentCommercial.get("eligibility.consumptionRange")?.normalizedValue, "Oltre 1.500 e fino a 200.000 kWh/anno");
assert.deepEqual(currentCommercial.get("eligibility.exclusions")?.normalizedValue, ["Pubblica illuminazione", "Pubblica Amministrazione", "Enti pubblici"]);
assert.equal(currentCommercial.get("pricing.mode")?.normalizedValue, "Indicizzata");
assert.equal(currentCommercial.get("pricing.reference")?.normalizedValue, "PUN");
assert.equal(currentCommercial.get("pricing.spread.amount")?.normalizedValue, 0.025);
assert.equal(currentCommercial.get("commercialTerms.fixedFees")?.normalizedValue, 15);
assert.equal(currentCommercial.get("commercialTerms.variableFees")?.normalizedValue, 0.003);
assert.equal(currentCommercial.get("commercialTerms.imbalance")?.normalizedValue, 0.005);
assert.equal(currentCommercial.get("commercialTerms.oneOffFees")?.normalizedValue, 1.5);
assert.equal(currentCommercial.get("eligibility.voltageLevels")?.normalizedValue, "BT / MT");
assert.equal(currentCommercial.get("taxTreatment")?.normalizedValue, "IVA e imposte escluse");
assert.equal(currentReview.notFoundFields.some((item) => item.fieldKey === "commercialTerms.commercialDiscounts"), true);
assert.equal(currentReview.notFoundFields.some((item) => item.fieldKey === "supplier.supplierId"), false);
assert.ok(current.payload.fields.every((field) => typeof field.value !== "number" || Number.isFinite(field.value)));
console.log("cte review normalization smoke: ok (deterministic server mapping, current persisted EE record, no provider call)");
