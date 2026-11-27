import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { technicalScontrino } from "../app/lib/quote/technical-scontrino.ts";
import { technicalTaxes } from "../app/lib/calculation/technical-quadrature.ts";
import { register } from "node:module";

// The screen is rendered with react-dom/server: the test registers a loader that compiles .tsx (tests/node-tsx-render-loader.mjs).
register("./node-tsx-render-loader.mjs", import.meta.url);
const { TechnicalSimulation } = await import("../app/components/QuickQuoteFlow.tsx");

// Tony (15/11/2026, "Intervento risolutivo scontrino ARERA"): the Direttore's technical simulation is shown as the ARERA
// Scontrino dell'energia beside the original bill. Control case shaped on bill BPower 071808E (October 2026, 10 kWh,
// 1,5 kW BT altri usi, total 35,00 €) and CTE Be Relax 06.25: synthetic lines with the same amounts, no customer data.
const line = (description, amount, unit = null, quantity = null, code = null, unitPrice = null) => ({ code, description, amount, quantity, unitPrice, unit, period: null });
const quadro = [
  line("Quota per consumi", "3,42 €", "kWh", "10"),
  line("Quota per consumi - di cui spesa per vendita energia", "2,92 €", "€/kWh", null, null, "0,292"),
  line("Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "0,50 €", "€/kWh", null, null, "0,05"),
  line("Quota fissa", "18,74 €", "mese", "1"),
  line("Quota fissa - di cui spesa per vendita energia", "15,00 €", "€/mese"),
  line("Quota fissa - di cui spesa per la rete e gli oneri generali di sistema", "3,74 €", "€/mese"),
  line("Quota potenza", "6,40 €", "kW", "1,5"),
  line("Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "6,40 €", "€/kW"),
  line("Oneri - Quota per consumi - ARIM", "0,02", "€/kWh", "10", "ARIM"),
  line("Oneri - Quota per consumi - ASOS", "0,32", "€/kWh", "10", "ASOS"),
  line("Oneri - Quota fissa - ARIM", "0,25", "€/mese", "1", "ARIM"),
  line("Oneri - Quota fissa - ASOS", "1,08", "€/mese", "1", "ASOS"),
  line("Oneri - Quota potenza - ARIM", "0,43", "€/kW", "1,5", "ARIM"),
  line("Oneri - Quota potenza - ASOS", "1,85", "€/kW", "1,5", "ASOS"),
];
const taxes = [line("Imposta erariale di consumo (accise)", "0,13 €", "€/kWh", "10", "ACCISE", "0,0125"), line("IVA 22%", "6,31 €", null, null, "IVA")];
const analysisOf = (withTaxes) => buildCurrentBillEconomicAnalysis([...quadro, ...(withTaxes ? taxes : []), line("TOTALE BOLLETTA", withTaxes ? "35,00 €" : "28,56 €", null, null, "BILL_TOTAL")], withTaxes ? "35,00" : "28,56");

// The engine's lines for Be Relax 06.25 after the losses correction (commit 486b75c): vendita 17,92, rete e oneri 10,64.
const fee = (label, amount, category, inputs, formulaId = "CTE_PASS_THROUGH_RATE_TIMES_KWH") => ({ label, category, sign: "CHARGE", amount, formulaId, formulaInputs: inputs });
const regulated = (label, amount, category, componentCode, rate) => ({ label, category, sign: "CHARGE", amount, formulaId: `REGULATED_${componentCode}`, formulaInputs: { componentCode, ...rate } });
const components = [
  fee("Energia F1", 0.78, "ENERGY", { band: "F1", month: "2026-10", quantityKwh: 3, punEurPerMwh: 235, spreadPerKwh: 0.025 }, "EE_PUN_MWH_TO_KWH_PLUS_SPREAD"),
  fee("Energia F2", 1.11, "ENERGY", { band: "F2", month: "2026-10", quantityKwh: 4, punEurPerMwh: 252.5, spreadPerKwh: 0.025 }, "EE_PUN_MWH_TO_KWH_PLUS_SPREAD"),
  fee("Energia F3", 0.72, "ENERGY", { band: "F3", month: "2026-10", quantityKwh: 3, punEurPerMwh: 215, spreadPerKwh: 0.025 }, "EE_PUN_MWH_TO_KWH_PLUS_SPREAD"),
  fee("Quote variabili", 0.03, "VARIABLE_FEE", { feeUnit: "EUR_PER_KWH", feeRate: 0.0033, basisQuantity: 10 }, "FEE_RATE_TIMES_KWH"),
  fee("Sbilanciamento", 0.06, "IMBALANCE", { feeUnit: "EUR_PER_KWH", feeRate: 0.0055, basisQuantity: 10 }, "IMBALANCE_RATE_TIMES_KWH"),
  fee("Dispacciamento", 0.11, "VARIABLE_FEE", { kind: "DISPATCHING", feeUnit: "EUR_PER_KWH", feeRate: 0.010877, basisQuantity: 10 }),
  fee("Capacity market libero", 0.07, "VARIABLE_FEE", { kind: "CAPACITY_MARKET", capacityNature: "CONTRACTUAL", feeUnit: "EUR_PER_KWH", feeRate: 0.007, basisQuantity: 10 }),
  fee("Mercato della capacità", 0.04, "VARIABLE_FEE", { kind: "CAPACITY_MARKET", capacityNature: "REGULATED", feeUnit: "EUR_PER_KWH", feeRate: 0.0037653, basisQuantity: 10 }),
  fee("PCV", 15, "FIXED_FEE", { feeUnit: "EUR_PER_MONTH", feeRate: 15, basisMonths: 1 }, "FEE_RATE_TIMES_MONTHS"),
  regulated("Distribuzione quota fissa", 0.45, "REGULATED_FIXED", "NETWORK_FIXED", { rateEurPerPodYear: 5.3471, monthsApplied: 1 }),
  regulated("Misura", 1.82, "REGULATED_FIXED", "METERING_FIXED", { rateEurPerPodYear: 21.8469, monthsApplied: 1 }),
  regulated("UC6 quota fissa", 0.14, "REGULATED_FIXED", "UC6_FIXED", { rateEurPerPodYear: 1.68, monthsApplied: 1 }),
  regulated("ARIM quota fissa", 0.25, "REGULATED_FIXED", "ARIM", { rateEurPerPodYear: 3, monthsApplied: 1 }),
  regulated("ASOS quota fissa", 1.08, "REGULATED_FIXED", "ASOS", { rateEurPerPodYear: 12.96, monthsApplied: 1 }),
  regulated("Distribuzione quota potenza", 4.12, "REGULATED_POWER", "NETWORK_POWER", { rateEurPerKwYear: 32.9297, powerBasisKw: 1.5, monthsApplied: 1 }),
  regulated("ARIM quota potenza", 0.43, "REGULATED_POWER", "ARIM", { rateEurPerKwYear: 3.44, powerBasisKw: 1.5, monthsApplied: 1 }),
  regulated("ASOS quota potenza", 1.85, "REGULATED_POWER", "ASOS", { rateEurPerKwYear: 14.8, powerBasisKw: 1.5, monthsApplied: 1 }),
  regulated("Distribuzione quota energia", 0.01, "REGULATED_ENERGY", "NETWORK_ENERGY", { rateEurPerKwh: 0.00098, quantityKwh: 10 }),
  regulated("Trasmissione", 0.12, "REGULATED_ENERGY", "TRANSMISSION_ENERGY", { rateEurPerKwh: 0.01183, quantityKwh: 10 }),
  regulated("UC3", 0.03, "REGULATED_ENERGY", "UC3", { rateEurPerKwh: 0.0026, quantityKwh: 10 }),
  regulated("ARIM quota energia", 0.02, "REGULATED_ENERGY", "ARIM", { rateEurPerKwh: 0.0016, quantityKwh: 10 }),
  regulated("ASOS quota energia", 0.32, "REGULATED_ENERGY", "ASOS", { rateEurPerKwh: 0.0318, quantityKwh: 10 }),
];
const sum = (items) => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100;
assert.equal(sum(components.filter((item) => !item.category.startsWith("REGULATED_"))), 17.92);
assert.equal(sum(components), 28.56, "technical total net of taxes, as in the control case");
// Tony (15/11/2026, quadratura autonoma): the server checks rete e oneri and computes excise and VAT from the law; here the
// engine certifies the scope (COMPLETE) and the taxes come from the same fiscal module, never from the bill.
const regulatedComplete = { status: "COMPLETE", basis: "ENGINE", tariffClass: "BTA1", checked: [], missing: [], asos: { class: "0", basis: "DOCUMENTED", note: "classe ASOS 0 documentata in bolletta" } };
const taxesOf = (warnings, regulated = regulatedComplete) => technicalTaxes({ vector: "EE", taxTreatment: "EXCLUDED", domestic: false, resident: null, committedPowerKw: 1.5, supplyPeriod: { periodStart: "2026-10-01", periodEnd: "2026-11-01" }, bands: { f1: 3, f2: 4, f3: 3 }, monthlyProfile: null, warnings, regulated, totalNetOfTaxes: 28.56 });
const withTaxes = (base, regulated = regulatedComplete) => { const taxes = taxesOf(base.warnings, regulated); return { ...base, regulatedCompleteness: regulated, taxes, totals: { netOfTaxes: 28.56, taxes: taxes.totalTaxes, withTaxes: taxes.totalTaxes === null ? null : Math.round((28.56 + taxes.totalTaxes) * 100) / 100 } }; };
const result = withTaxes({ components, totalCommercialCost: 17.92, costScope: "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE", warnings: [] });
const base = { vector: "EE", domestic: false, quantity: 10, months: 1, powerKw: 1.5 };

// 1. Complete case: both columns, quota by quota, taxes and totals.
const complete = technicalScontrino({ ...base, result, analysis: analysisOf(true) });
assert.equal(complete.receipt.status, "COMPLETE");
assert.equal(complete.taxesIncluded, true);
const quota = (key) => complete.receipt.quotas.find((item) => item.key === key);
assert.deepEqual([quota("CONSUMPTION").current, quota("CONSUMPTION").currentSeller, quota("CONSUMPTION").offer, quota("CONSUMPTION").offerSeller], [3.42, 2.92, 3.42, 2.92], "quota per consumi: vendita 2,92 + rete e oneri 0,50 on both sides");
assert.deepEqual([quota("FIXED").current, quota("FIXED").currentSeller, quota("FIXED").offer, quota("FIXED").offerSeller], [18.74, 15, 18.74, 15], "quota fissa: PCV 15,00 + rete e oneri 3,74");
assert.deepEqual([quota("POWER").current, quota("POWER").currentSeller, quota("POWER").offer, quota("POWER").offerSeller], [6.4, 0, 6.4, 0], "quota potenza: rete e oneri 6,40 only");
assert.deepEqual([quota("EXCISE").current, quota("VAT").current], [0.13, 6.31], "the bill's own taxes, for its column only");
// The simulation's taxes are its own: excise 10 x 0,0125 and VAT 22% on 28,56 + 0,13, from the fiscal module.
const offerLine = (label) => complete.offerLines.find((item) => item.label === label);
assert.deepEqual([offerLine("di cui accise").amount, offerLine("di cui IVA").amount, offerLine("di cui IVA").price], [0.13, 6.31, "22%"]);
assert.equal(complete.offerTaxesDetermined, true);
assert.equal(complete.receipt.quotas.some((item) => item.key === "OTHER"), false, "no altre partite: every line is in a quota");
assert.equal(complete.billTotal, 35);
assert.equal(complete.offerTotal, 35, "28,56 + accise 0,13 + IVA 6,31");
assert.equal(complete.complete, true);
assert.equal(complete.difference, 0);
assert.equal(complete.differencePercent, 0);
assert.deepEqual(complete.missing, []);
// No duplication: the quotas of each column add up to its supply total once, and each voce appears once per column.
assert.equal(Math.round((quota("CONSUMPTION").offer + quota("FIXED").offer + quota("POWER").offer) * 100) / 100, 28.56);
let section = "";
const keys = complete.rows.map((row) => { if (row.kind === "section") section = row.label; return `${section}|${row.kind}|${row.label}|${row.bill?.price ?? ""}`; });
assert.equal(new Set(keys).size, keys.length, "each row once");
const row = (label) => complete.rows.filter((item) => item.label === label);
assert.equal(row("Accise e IVA").length, 1);
assert.deepEqual([row("Accise e IVA")[0].bill.amount, row("Accise e IVA")[0].offer.amount], [6.44, 6.44]);
assert.deepEqual([row("di cui accise")[0].bill.amount, row("di cui accise")[0].offer.amount], [0.13, 0.13]);
assert.deepEqual([row("di cui IVA")[0].bill.amount, row("di cui IVA")[0].offer.amount, row("di cui IVA")[0].offer.price], [6.31, 6.31, "22%"]);
const total = complete.rows.find((item) => item.kind === "total");
assert.equal(total.label, "Totale bolletta");
assert.deepEqual([total.bill.amount, total.offer.amount], [35, 35]);
const main = complete.rows.filter((item) => item.kind === "main");
assert.deepEqual(main.map((item) => [item.label, item.bill.price, item.offer.price, item.bill.amount, item.offer.amount]), [
  ["10 kWh", "0,342000 €/kWh", "0,342000 €/kWh", 3.42, 3.42],
  ["1 mese", "18,74 €/mese", "18,74 €/mese", 18.74, 18.74],
  ["1,5 kW per 1 mese", "4,2667 €/kW/mese", "4,2667 €/kW/mese", 6.4, 6.4],
], "quantity and average price for each quota");

// 2. The bill without taxes: no difference; the simulation keeps its own taxes (it never needed the bill's), the bill's
// 28,56 is "imposte escluse" and its taxes are shown as missing on its side.
const untaxed = technicalScontrino({ ...base, result, analysis: analysisOf(false) });
assert.equal(untaxed.taxesIncluded, false);
assert.equal(untaxed.complete, false);
assert.equal(untaxed.difference, null);
assert.equal(untaxed.differencePercent, null);
assert.equal(untaxed.billTotal, 28.56);
assert.equal(untaxed.offerTotal, 35, "the simulation's own total with taxes");
const untaxedTotal = untaxed.rows.find((item) => item.kind === "total");
assert.equal(untaxedTotal.label, "Totale", "two totals of a different kind share no label");
assert.deepEqual([untaxed.rows.find((item) => item.label === "tipo di totale").bill.price, untaxed.rows.find((item) => item.label === "tipo di totale").offer.price], ["Totale imposte escluse", "Totale bolletta"], "the bill's 28,56 is never shown as a total with taxes");
assert.equal(untaxed.rows.find((item) => item.label === "Accise e IVA").bill.price, "non determinabili");
assert.ok(untaxed.missing.some((text) => /accise e IVA/.test(text)));

// 3. A charge the engine could not price: partial total, no difference, the reason in words.
const partial = technicalScontrino({ ...base, result: withTaxes({ ...result, warnings: ["OFFICIAL_VALUE_MISSING:DISPATCHING:LOSS_COEFFICIENT_UNAVAILABLE"] }), analysis: analysisOf(true) });
assert.equal(partial.complete, false);
assert.equal(partial.difference, null);
assert.equal(partial.offerLines.find((item) => item.kind === "total").label, "Totale parziale della simulazione (voci non determinate)");
assert.equal(partial.rows.find((item) => item.label === "tipo di totale").offer.price, "Totale parziale della simulazione (voci non determinate)", "the partial total is said on the simulation side");
assert.deepEqual(partial.missing, ["dispacciamento: coefficiente perdite TIS Tabella 4 non verificato per il periodo", "IVA: costo della fornitura simulata non completo, manca la base imponibile"], "no VAT on an incomplete supply cost");
// 4. Rete e oneri not computed in full: not complete either.
const regulatedPartial = { ...regulatedComplete, status: "INCOMPLETE", basis: "NONE", missing: ["rete e oneri ARERA: il motore non li calcola per intero per questa tipologia di fornitura"] };
assert.equal(technicalScontrino({ ...base, result: withTaxes({ ...result, costScope: "COMMERCIAL_PLUS_REGULATED_PARTIAL" }, regulatedPartial), analysis: analysisOf(true) }).difference, null);

// 5. The screen: the real component rendered to HTML.
const context = { billId: "bill-test", billVersionId: "v1", vector: "EE", customerType: "NON_RESIDENTIAL", supply: { pod: null, pdr: null, voltageLevel: "LV", contractedPowerKw: 1.5 }, consumption: { annual: null, period: { f1: 3, f2: 4, f3: 3, smc: null } }, billingPeriod: { periodStart: "2026-10-01", periodEnd: "2026-11-01" }, currentSupplier: "Fornitore attuale", classification: { domestic: false }, missingRequiredData: [] };
const billOf = (withTaxes) => ({ analystReview: { economics: { economicAnalysis: analysisOf(withTaxes) } } });
const technical = { banner: "SIMULAZIONE TECNICA FUORI DAI REQUISITI CTE — NON VALIDA COME PROPOSTA COMMERCIALE", cte: { supplier: "BPower", offerName: "Be Relax 06.25", offerCode: "TEST", consumptionRequirement: "> 1.500 kWh/anno" }, annualConsumption: { value: 192, status: "ESTIMATED" }, totalCommercialPlusRegulatedSubsetCost: 28.56, ...result };
const html = renderToStaticMarkup(createElement(TechnicalSimulation, { result: technical, context, bill: billOf(true) }));
assert.match(html, /SIMULAZIONE TECNICA FUORI DAI REQUISITI CTE — NON VALIDA COME PROPOSTA COMMERCIALE/, "banner kept");
assert.match(html, /Fattura originale · Fornitore attuale/);
assert.match(html, /Simulazione Be Relax 06\.25/);
for (const text of ["Quota per consumi", "Quota fissa e Quota potenza", "di cui spesa per la vendita di energia elettrica", "di cui spesa per la rete e gli oneri generali di sistema", "Accise e IVA", "di cui accise", "di cui IVA", "Totale bolletta"]) assert.ok(html.includes(text), text);
assert.match(html, /data-testid="technical-difference"/);
assert.match(html, /=\s*35,00\s€/);
assert.match(html, /<strong>0,00\s€ \(0%\)<\/strong>/, "difference in € and % between the two totals with taxes");
assert.match(html, /<details class="quote-detail"><summary>Dettaglio analitico dei corrispettivi<\/summary>/, "the engine's lines in the analytical panel, closed");
assert.doesNotMatch(html, /Totale tecnico/, "no more flat list with a technical total");
assert.doesNotMatch(html, /proposta in PDF|Scarica la proposta|button primary/, "no proposal from the technical simulation");
const untaxedHtml = renderToStaticMarkup(createElement(TechnicalSimulation, { result: technical, context, bill: billOf(false) }));
assert.match(untaxedHtml, /data-testid="technical-difference-missing"/);
assert.match(untaxedHtml, /Totale imposte escluse/);
assert.match(untaxedHtml, /non determinabili/);
assert.match(html, /Accise calcolate: 10 kWh × 0,0125 €\/kWh/, "the excise formula and its law are shown");
assert.match(html, /IVA 22% su 28,69\s€/);
assert.match(html, /Nessun importo della fattura entra nella simulazione/);
assert.match(html, /data-testid="technical-provenance"/);

// Wiring: the server passes each line's formula, never an id or fingerprint.
const server = readFileSync(new URL("../app/lib/calculation/technical-derogation.ts", import.meta.url), "utf8");
assert.match(server, /formulaId: component\.formulaId, formulaInputs: component\.formulaInputs/);
if (process.env.TECHNICAL_SCONTRINO_HTML) (await import("node:fs")).writeFileSync(process.env.TECHNICAL_SCONTRINO_HTML, JSON.stringify({ complete: html, untaxed: untaxedHtml }));
console.log("TECHNICAL_SCONTRINO_ARERA=PASS");
