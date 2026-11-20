import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { register } from "node:module";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { buildBillAnalystReview } from "../app/lib/foundation/bill-analyst-review.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";
import { offerScontrino } from "../app/lib/quote/offer-scontrino.ts";
import { annualSaving, quoteCostSummary } from "../app/lib/quote/annual-saving.ts";
import { parseProposalPresentation } from "../app/lib/proposal/presentation.ts";
import { renderReceiptProposal } from "../app/lib/export/receipt-pdf.ts";

register("./node-tsx-render-loader.mjs", import.meta.url);
const { annualProjection, QuoteCosts, billedMonthsOf } = await import("../app/components/QuickQuoteFlow.tsx");

// Tony (16/11/2026, "correzione costi una tantum e risparmio annuo"): bill 070789E (October 2026, 335 kWh, 205,03 €) against
// CTE Be Smile 11.25 (quota fissa business 15 €/mese, "valore una tantum gestione APP e servizi di €1,50", prices net of
// IVA). The screen showed simulation 200,80, difference 4,23, una tantum 1,50 and an annual saving of 499,09 € on the
// estimated 9.909 kWh. Cause: the bill's quota fissa di vendita (18 €/mese) came from the technical reading, which users
// without "Dettaglio tecnico" do not receive; read as 0, the 18 € was annualised with the consumption (× 29,58) while the
// offer's 15 € counted 12 times. The monthly charges now come from the receipt's quotas (same analysis for every user),
// the one-off is a separate initial cost paid once. Synthetic reading with the bill's amounts: no customer data.
const cents = (value) => Math.round(value * 100) / 100;
const plain = (text) => String(text).replace(/[  ]/g, " ");
const close = (actual, expected, message, tolerance = 0.005) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 1, ...extra });
const dt = (descrizione, voce, importo) => ({ descrizione, voce, fascia: "NESSUNA", periodo: "", quantita: "", unita: "", prezzo: "", unitaPrezzo: "", importo, pagina: 3 });
const reading = parseBillReading({
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "AZIENDA DI PROVA", pod: "IT000E00000000",
  tipoClienteStampato: "altri usi", tensioneStampata: "", potenzaImpegnataKw: "4,0", potenzaMassimaPrelevataKw: "", mercato: "MERCATO LIBERO",
  periodoStampato: "01/10/2026 - 31/10/2026", periodoDal: "2026-10-01", periodoAl: "2026-10-31",
  consumoFatturato: "335", consumoF1: "56", consumoF2: "86", consumoF3: "193", consumoAnnuo: "",
  offertaNome: "OFFERTA DI PROVA", offertaCodice: "", tipologiaOfferta: "a prezzo variabile", tipologiaPrezzo: "a fasce", indice: "PUN",
  spread: "", pcvMensile: "", decorrenzaCondizioni: "", scadenzaContratto: "", totaleBolletta: "205,03",
  scontrino: [
    sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "120,12", { quantita: "335", unita: "kWh", prezzoMedio: "0,358567", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la vendita", "DI_CUI_VENDITA", "CONSUMI", "103,75", { prezzoMedio: "0,309701", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "16,37", { prezzoMedio: "0,048866", unitaPrezzo: "€/kWh" }),
    sc("Energia reattiva immessa", "ENERGIA_REATTIVA", "NESSUNA", "5,48", { quantita: "504", unita: "kVArh", prezzoMedio: "0,010873", unitaPrezzo: "€/kVArh" }),
    sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "21,74", { quantita: "1", unita: "mese", prezzoMedio: "21,74", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la vendita", "DI_CUI_VENDITA", "FISSA", "18,00", { prezzoMedio: "18,00", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "3,74", { prezzoMedio: "3,74", unitaPrezzo: "€/mese" }),
    sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "17,07", { quantita: "4,0", unita: "kW", prezzoMedio: "4,2675", unitaPrezzo: "€/kW/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "17,07", { prezzoMedio: "4,267500", unitaPrezzo: "€/kW/mese" }),
    sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "40,62"),
    sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "205,03"),
  ],
  dettaglio: [
    dt("Componente ASOS - quota potenza", "ONERI_ASOS", "4,94"), dt("Componente ASOS - quota per consumi", "ONERI_ASOS", "10,68"), dt("Componente ASOS - quota fissa", "ONERI_ASOS", "1,08"),
    dt("Componente ARIM - quota potenza", "ONERI_ARIM", "1,15"), dt("Componente ARIM - quota per consumi", "ONERI_ARIM", "0,54"), dt("Componente ARIM - quota fissa", "ONERI_ARIM", "0,25"),
    dt("Accise: imposte erariali (primo scaglione)", "ACCISE", "4,19"), dt("IVA vendite 22%", "IVA", "36,43"),
  ],
  assenti: [],
});
const structuredBill = toStructuredBill({ reading, checks: [], reread: false });
const review = buildBillAnalystReview({ id: "bill-classification", fileName: "fixture.pdf", status: "REVIEW_REQUIRED", reviewState: "WORKING", currentVersionNumber: 1, currentApprovedVersionId: null, approvalReady: false, updatedAt: "2026-11-16T00:00:00.000Z", fields: {}, normalized: null, structuredBill, resolvedVector: "EE", invoicePunReferences: [] });
const analysis = review.economics.economicAnalysis;

// The engine's lines for the two CTEs on this bill: FLEX 25 from the collaudo fixture, Be Smile 11.25 from the stored
// comparison of 16/11 (same energy, losses, dispatching and capacity; quota fissa 15 € without Flex; sbilanciamento 1,84;
// the one-off 1,50 €, EUR_PER_CONTRACT). Engine formulas untouched.
const engine = JSON.parse(readFileSync(new URL("./fixtures/receipt-070789E-engine-result.json", import.meta.url), "utf8"));
const toComponent = (c) => ({ category: c.category, sign: c.sign, label: c.label, formulaId: c.formulaId, amount: { amount: c.amount }, formulaInputs: c.formulaInputs });
const flexComponents = engine.components.map(toComponent);
const smileComponents = [
  ...engine.components.filter((c) => !/Flex/.test(c.label)).map((c) => c.category === "IMBALANCE" ? { ...c, amount: 1.84 } : c).map(toComponent),
  toComponent({ category: "ONE_OFF_FEE", sign: "CHARGE", label: "Iva per costo pratica", formulaId: "FEE_RATE_TIMES_BASIS", amount: 1.5, formulaInputs: { feeRate: "1.5", feeUnit: "EUR_PER_CONTRACT" } }),
];
const smile = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 118.28, analysis, domestic: false, validUntil: null, offerComponents: smileComponents, warnings: engine.warnings });
const flex = buildQuoteReceipt({ vector: "EE", offerSupplyCost: engine.totalCommercialCost, analysis, domestic: false, validUntil: null, offerComponents: flexComponents, warnings: engine.warnings });
const history = [["2026-04", 699], ["2026-05", 708], ["2026-06", 549], ["2026-07", 1350], ["2026-08", 1478], ["2026-09", 661], ["2026-10", 335]].map(([month, quantity]) => ({ month, quantity }));
const context = { vector: "EE", billingPeriod: { periodStart: "2026-10-01", periodEnd: "2026-10-31" }, consumption: { annual: null, period: { f1: 56, f2: 86, f3: 193, smc: null }, monthlyProfile: null, history } };
const quoted = (receipt) => ({ receipt, discount: null });
const months = billedMonthsOf(context);
const factor = (5780 / 7 * 12) / 335;

// Period totals as on screen: the simulation of the period includes the one-off, which is its own line.
assert.deepEqual([smile.currentTotal, smile.offerTotal, smile.savings], [205.03, 200.8, 4.23], "period: bill 205,03, simulation 200,80, difference 4,23");
assert.deepEqual(smile.oneOff, { net: 1.5, taxes: 0.33, total: 1.83 }, "one-off: 1,50 € net + IVA 22% 0,33 € = 1,83 €");
const quota = (receipt, key) => receipt.quotas.find((item) => item.key === key);
assert.deepEqual([quota(smile, "ONE_OFF").label, quota(smile, "ONE_OFF").current, quota(smile, "ONE_OFF").offer], ["Corrispettivo una tantum", 0, 1.5]);
assert.equal(quota(smile, "OTHER"), undefined, "the one-off is not hidden in \"Altre voci\"");

// 1. One-off applied once when due. Its weight on the annual saving is exactly its 1,83 €, whatever the consumption or the
// months of the bill: never multiplied by the annual / billed consumption nor by 12.
for (const [f, m] of [[factor, 1], [1, 1], [6, 2], [0.5, 1]]) {
  const base = { savings: 4.23, currentTotal: 205.03, billFixed: 38.81, offerFixed: 35.81, vat: 1.22, months: m, factor: f };
  const withFee = annualSaving({ ...base, oneOff: 1.5 }); const withoutFee = annualSaving({ ...base, savings: 4.23 + 1.83, oneOff: 0 });
  close(withoutFee.saving - withFee.saving, 1.83, `one-off counted once (factor ${f}, months ${m})`, 1e-9);
}

// 2. Effective annual formula, reconstructed side by side (net monthly quotas M, VAT v, factor f = annual / billed kWh):
// annual cost = (period total − M × v) × f + M × v × 12 / months; offer recurring = offer total − one-off (with VAT).
const projection = annualProjection(quoted(smile), context);
const billMonthly = 21.74 + 17.07; const offerMonthly = 18.74 + 17.07;
const annualOf = (total, monthly) => (total - monthly * 1.22) * factor + monthly * 1.22 * 12 / months;
const annualCurrent = annualOf(205.03, billMonthly);
const annualOfferRecurring = annualOf(200.8 - 1.83, offerMonthly);
close(projection.current, annualCurrent, "annual cost of the bill", 1e-6);
close(projection.saving, annualCurrent - (annualOfferRecurring + 1.83), "annual saving = annual bill − (annual recurring offer + one-off once)", 1e-6);
assert.equal(cents(projection.saving), 113.08, "annual saving on 9.909 kWh: 113,08 €, not 499,09 €");
assert.equal(cents(projection.oneOff), 1.83);
// The old figure is what the same formula gives when the bill's 18 €/mese is missing (read as 0): the defect reproduced.
assert.equal(cents(annualSaving({ savings: 4.23, currentTotal: 205.03, billFixed: 0, offerFixed: 15, oneOff: 1.5, vat: 1.22, months: 1, factor }).saving), 499.09, "499,09 = bill PCV read as 0");
// Annual model from the history (5.780 kWh in 7 months → 9.908,57 kWh), never a fixed × 12 of the bill.
assert.notEqual(cents(projection.current), cents(205.03 * 12), "the annual cost is not the bill × 12");

// 3. No recurring one-off and a homogeneous monthly comparison: the comparable month is the year's average without the
// one-off on both sides; 12 months of it give back the recurring annual costs.
const costs = quoteCostSummary(smile, months, projection);
assert.deepEqual([costs.periodOffer, costs.oneOff.total, costs.periodOfferRecurring, costs.periodRecurringSaving], [200.8, 1.83, 198.97, 6.06], "period: 200,80 of which 1,83 one-off; recurring 198,97, saving 6,06");
assert.equal(costs.monthly.basis, "ANNUAL_AVERAGE");
close(costs.monthly.current * 12, costs.annual.current, "monthly × 12 = annual (bill)", 0.06);
close(costs.monthly.offer * 12, costs.annual.offerRecurring, "monthly × 12 = annual recurring (offer), no one-off inside", 0.06);
close(costs.monthly.saving, cents(costs.monthly.current - costs.monthly.offer), "monthly saving = difference of the two months", 0.011);
assert.equal(costs.annual.oneOff, 1.83);
assert.equal(costs.annual.offer, cents(costs.annual.offerRecurring + costs.annual.oneOff), "annual spend = recurring + one-off once");
assert.equal(costs.annual.saving, cents(costs.annual.current - costs.annual.offer), "annual saving reconciled with the two annual spends");
assert.equal(costs.annual.saving, 113.08);

// 4. No duplication in taxes/IVA: the one-off's IVA is inside the offer IVA once; quotas add up to the totals.
const sumOffer = (receipt) => cents(receipt.quotas.reduce((sum, item) => sum + (item.offer ?? 0), 0));
assert.equal(sumOffer(smile), 200.8, "offer quotas (one-off and its IVA once) = offer total");
assert.equal(cents(quota(smile, "VAT").offer - quota(flex, "VAT").offer), cents((smile.offerTotal - flex.offerTotal - (quota(smile, "VAT").offer - quota(flex, "VAT").offer)) * 0.22), "IVA moves only with the supply, one-off included once");
assert.equal(cents(smile.offerTotal - smile.oneOff.total), costs.periodOfferRecurring);

// 5. UI and PDF consistent: the screen's costs table and the proposal PDF print the same amounts.
const html = plain(renderToStaticMarkup(createElement(QuoteCosts, { costs, taxesIncluded: true })));
for (const text of ["200,80", "1,83", "198,97", "6,06", "dovuto una sola volta", "Spesa annua prevista", "113,08"]) assert.ok(html.includes(text), `screen shows ${text}`);
const scontrino = offerScontrino({ quotas: smile.quotas, offerTotal: smile.offerTotal, taxesIncluded: true, vector: "EE", quantity: 335, months: 1, powerKw: 4, discount: null });
assert.deepEqual(scontrino.filter((line) => /una tantum/i.test(line.label)).map((line) => [line.label, line.amount]), [["Corrispettivo una tantum (solo prima bolletta)", 1.5]], "scontrino: one-off once, named");
assert.ok(!scontrino.some((line) => /Altre partite/.test(line.label)), "scontrino: no altre partite");
const presentation = parseProposalPresentation(JSON.parse(JSON.stringify({
  customerName: "Cliente di prova", supplyLabel: "", billSupplier: "Fornitore attuale", billOfferName: "", offerSupplier: "Venditore", offerName: "Be Smile 11.25", offerCode: "T",
  periodLabel: "01/10/2026 - 31/10/2026", consumptionLabel: "335 kWh", taxesIncluded: true, sameOffer: false, currentTotal: smile.currentTotal, offerTotal: smile.offerTotal, savings: smile.savings, savingsPercent: smile.savingsPercent,
  annualSaving: projection.saving, annualCurrent: projection.current, annualBasisLabel: "", validUntil: null, rows: [], comparison: [], excluded: [], scontrino, billScontrino: [], costs,
})));
assert.deepEqual(presentation.costs, costs, "the PDF receives the screen's costs unchanged");
const pdf = Buffer.from(renderReceiptProposal({ generatedAt: "2026-11-16T00:00:00.000Z", customer: { displayName: "Cliente di prova" }, selectedOffer: { supplier: "Venditore", offerCode: "T" } }, presentation, null)).toString("latin1");
for (const text of ["113,08", "200,80", "198,97", "1,83", "Corrispettivo una tantum \\(solo prima bolletta\\)"]) assert.ok(pdf.includes(text), `PDF shows ${text}`);
assert.ok(pdf.includes(costs.monthly.saving.toFixed(2).replace(".", ",")), "PDF monthly saving = screen comparable month, not annual / 12 with the one-off");
assert.ok(!pdf.includes("499,09"));
assert.throws(() => parseProposalPresentation({ ...presentation, costs: { ...costs, monthly: { ...costs.monthly, basis: "X" } } }), /PROPOSAL_PRESENTATION_INVALID/);

// 6. No regression, 070789E with Be Smile FLEX 25: same period totals, no one-off, annual from the same model.
assert.deepEqual([flex.currentTotal, flex.offerTotal, flex.savings, flex.oneOff], [205.03, 203.98, 1.05, null]);
assert.equal(quota(flex, "ONE_OFF"), undefined);
const flexProjection = annualProjection(quoted(flex), context);
close(flexProjection.saving, annualCurrent - annualOf(203.98, 21.74 + 17.07), "FLEX 25: same PCV (15 + Flex 3 = 18), saving follows consumption only", 1e-6);
const flexCosts = quoteCostSummary(flex, months, flexProjection);
assert.deepEqual([flexCosts.oneOff, flexCosts.periodOfferRecurring, flexCosts.annual.oneOff], [null, 203.98, 0]);

// 7. No regression, 071808E: no one-off line, same quotas and total.
const l = (description, amount, unit = null, quantity = null, code = null, unitPrice = null) => ({ code, description, amount, quantity, unitPrice, unit, period: null });
const { buildCurrentBillEconomicAnalysis } = await import("../app/lib/foundation/bill-economic-analysis.ts");
const bill071808 = buildCurrentBillEconomicAnalysis([
  l("Quota per consumi", "3,42 €", "kWh", "10"), l("Quota per consumi - di cui spesa per vendita energia", "2,92 €", "€/kWh", null, null, "0,292"), l("Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "0,50 €", "€/kWh", null, null, "0,05"),
  l("Quota fissa", "18,74 €", "mese", "1"), l("Quota fissa - di cui spesa per vendita energia", "15,00 €", "€/mese"), l("Quota fissa - di cui spesa per la rete e gli oneri generali di sistema", "3,74 €", "€/mese"),
  l("Quota potenza", "6,40 €", "kW", "1,5"), l("Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "6,40 €", "€/kW"),
  l("Oneri - Quota per consumi - ARIM", "0,02", "€/kWh", "10", "ARIM"), l("Oneri - Quota per consumi - ASOS", "0,32", "€/kWh", "10", "ASOS"), l("Oneri - Quota fissa - ARIM", "0,25", "€/mese", "1", "ARIM"),
  l("Oneri - Quota fissa - ASOS", "1,08", "€/mese", "1", "ASOS"), l("Oneri - Quota potenza - ARIM", "0,43", "€/kW", "1,5", "ARIM"), l("Oneri - Quota potenza - ASOS", "1,85", "€/kW", "1,5", "ASOS"),
  l("Imposta erariale di consumo (accise)", "0,13 €", "€/kWh", "10", "ACCISE", "0,0125"), l("IVA 22%", "6,31 €", null, null, "IVA"), l("TOTALE BOLLETTA", "35,00 €", null, null, "BILL_TOTAL"),
], "35,00");
const receipt071808 = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 17.92, analysis: bill071808, domestic: false, validUntil: null, offerComponents: [] });
assert.deepEqual(receipt071808.quotas.filter((item) => item.current).map((item) => [item.key, item.current]), [["CONSUMPTION", 3.42], ["FIXED", 18.74], ["POWER", 6.4], ["EXCISE", 0.13], ["VAT", 6.31]]);
assert.deepEqual([receipt071808.currentTotal, receipt071808.oneOff, receipt071808.quotas.some((item) => item.key === "ONE_OFF")], [35, null, false]);

// 8. Without the monthly quotas the annual saving is not determinable: never computed with a missing fixed fee read as 0.
const noQuotas = { ...smile, quotas: smile.quotas.map((item) => item.key === "FIXED" ? { ...item, current: null } : item) };
assert.equal(annualProjection(quoted(noQuotas), context), null);

console.log("one-off and annual saving smoke passed");
