import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCteReview } from "../app/lib/cte/review.ts";

const evidence = "Clienti non domestici, oltre 1.500 e fino a 200.000 kWh/anno. Esclusioni: Pubblica illuminazione, Enti pubblici.";
const fields = [
  { path: "supplier.name", value: "Fornitore Energia S.p.A.", sourceText: "Ragione sociale: Fornitore Energia S.p.A.", sourcePage: 1, confidence: 0.98, status: "CONFIRMED" },
  { path: "supplier.supplierId", value: null, sourceText: "Ragione sociale: Fornitore Energia S.p.A.", sourcePage: 1, confidence: 0.98, status: "NOT_FOUND" },
  { path: "offer.name", value: "Offerta Business", sourceText: "Offerta: Offerta Business", sourcePage: 1, confidence: 0.97, status: "CONFIRMED" },
  { path: "offer.code", value: "BUS-01", sourceText: "Codice offerta: BUS-01", sourcePage: 1, confidence: 0.97, status: "CONFIRMED" },
  { path: "validity.periodStart", value: "01/01/2026", sourceText: "Validità dal 01/01/2026", sourcePage: 1, confidence: 0.96, status: "CONFIRMED" },
  { path: "validity.periodEnd", value: "31/12/2026", sourceText: "Validità fino al 31/12/2026", sourcePage: 1, confidence: 0.96, status: "CONFIRMED" },
  { path: "eligibility.customerTypes", value: evidence, sourceText: evidence, sourcePage: 2, confidence: 0.95, status: "CONFIRMED" },
  { path: "eligibility.voltageLevels", value: "bassa o media tensione", sourceText: "Alimentazione in bassa o media tensione", sourcePage: 2, confidence: 0.95, status: "CONFIRMED" },
  { path: "pricing.mode", value: "Prezzo indicizzato", sourceText: "Prezzo indicizzato", sourcePage: 3, confidence: 0.95, status: "CONFIRMED" },
  { path: "pricing.reference", value: "PUN", sourceText: "Indice PUN", sourcePage: 3, confidence: 0.95, status: "CONFIRMED" },
  { path: "pricing.spread.amount", value: "0,025 €/kWh", sourceText: "Spread: 0,025 €/kWh", sourcePage: 3, confidence: 0.95, status: "CONFIRMED" },
  { path: "commercialTerms.fixedFees", value: "15,00 €/mese", sourceText: "Quota fissa: 15,00 €/mese", sourcePage: 4, confidence: 0.95, status: "CONFIRMED" },
  { path: "commercialTerms.variableFees", value: "0,003 €/kWh al netto delle perdite di rete", sourceText: "Quota variabile: 0,003 €/kWh al netto delle perdite di rete", sourcePage: 4, confidence: 0.95, status: "CONFIRMED" },
  { path: "commercialTerms.imbalance", value: "0,005 €/kWh al netto delle perdite di rete", sourceText: "Sbilanciamento: 0,005 €/kWh al netto delle perdite di rete", sourcePage: 4, confidence: 0.95, status: "CONFIRMED" },
  { path: "commercialTerms.oneOffFees", value: "Una tantum: 1,50 € — Gestione servizi", sourceText: "Una tantum: 1,50 € — Gestione servizi", sourcePage: 4, confidence: 0.95, status: "CONFIRMED" },
  { path: "taxTreatment", value: "IVA e imposte escluse", sourceText: "IVA e imposte escluse", sourcePage: 5, confidence: 0.95, status: "CONFIRMED" },
];
const review = normalizeCteReview({ vector: "EE", fields });
const byKey = new Map([...review.commercialFields, ...review.notFoundFields].map((field) => [field.fieldKey, field]));
assert.ok(review.sources.length > 0);
assert.equal(new Set(review.sources.map((source) => source.sourceTextComplete)).size, review.sources.length);
assert.equal(byKey.get("eligibility.customerTypes")?.sourceRef, byKey.get("eligibility.consumptionRange")?.sourceRef);
assert.equal(byKey.get("eligibility.customerTypes")?.sourceRef, byKey.get("eligibility.exclusions")?.sourceRef);
assert.equal(review.sources.find((source) => source.sourceRef === byKey.get("eligibility.customerTypes")?.sourceRef)?.sourceTextComplete, evidence);
assert.equal(byKey.get("commercialTerms.variableFees")?.confidence, 0.95);
assert.equal(byKey.get("commercialTerms.variableFees")?.sourceText, "Quota variabile: 0,003 €/kWh al netto delle perdite di rete");
assert.equal(byKey.get("commercialTerms.variableFees")?.conditions?.[0], "al netto delle perdite di rete");
assert.equal(byKey.get("commercialTerms.oneOffFees")?.description, "Gestione servizi");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = await readFile(path.join(root, "app/components/CteIngestionPanel.tsx"), "utf8");
const css = await readFile(path.join(root, "app/globals.css"), "utf8");
for (const label of ["Fornitore e offerta", "Ambito di applicazione", "Struttura prezzo", "Componenti commerciali", "Trattamento fiscale", "Provenienza documentale", "Non rilevati", "Modifica dati", "Salva modifiche", "Annulla", "Componente", "Importo", "Unità/periodicità", "Condizioni", "Revisione"]) assert.ok(ui.includes(label), `missing compact review label: ${label}`);
assert.doesNotMatch(ui, /Dettagli tecnici/);
assert.doesNotMatch(ui, /Voci facoltative non rilevate/);
assert.doesNotMatch(ui, /<TechnicalDetails/);
assert.doesNotMatch(ui, /\[Fonte/);
assert.doesNotMatch(ui, /Fonte\s+\d+/);
assert.doesNotMatch(ui, /Confidenza:/);
assert.equal((ui.match(/Provenienza documentale/g) ?? []).length, 1);
assert.equal((ui.match(/Non rilevati/g) ?? []).length, 1);
assert.match(ui, /Pagina: \{source\.sourcePage/);
assert.match(ui, /\{source\.sourceText\}/);
assert.doesNotMatch(ui, /<textarea/);
assert.match(ui, /sourceRef/);
assert.match(ui, /cte-source-\$\{source\.sourceRef\}/);
assert.match(css, /\.cte-review-layout\s*\{/);
assert.match(css, /\.cte-commercial-table\s*\{/);
assert.match(css, /@media \(max-width:760px\)/);
assert.match(css, /\.cte-review-compact \{ gap:16px/);
assert.match(css, /\.cte-review-group h4 \{[^}]*color:var\(--teal\)/);
assert.match(css, /\.cte-collapsed-section > summary \{ color:var\(--teal\)/);
assert.match(css, /\.cte-commercial-table th,.cte-commercial-table td \{ padding-top:7px; padding-bottom:7px/);
assert.match(css, /\.cte-approval-gate \{ margin-top:0; padding:18px 20px/);
assert.match(css, /\.cte-review-layout \{ gap:12px; align-items:start; grid-auto-rows:auto/);
assert.match(css, /\.cte-review-group \{ align-self:start; height:auto; min-height:0/);
assert.match(css, /color:#0891B2/);
assert.match(css, /border:1px solid #C7DDE5/);
assert.match(ui, /summaryDisplayValue/);
assert.match(ui, /cte-spread-item/);
assert.match(css, /\.cte-review-layout > \.cte-review-group:nth-child\(3\) \.cte-summary-grid \{ grid-template-columns:repeat\(3/);
assert.match(css, /\.cte-spread-item \{ padding:7px 10px; border:1px solid #A5F3FC/);
assert.match(css, /\.cte-spread-item > strong \{ margin-top:0; color:#0E7490; font-size:1\.2rem; font-weight:800/);
assert.match(css, /\.cte-summary-meta:empty \{ display:none; \}/);
console.log("cte review compact smoke: ok (grouped summary, unique evidence references, responsive presentation; no provider call)");
