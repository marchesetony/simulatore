import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { buildBillAnalystReview } from "../app/lib/foundation/bill-analyst-review.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

register("./node-tsx-render-loader.mjs", import.meta.url);
const { savingDetermined, annualProjection, comparisonBase } = await import("../app/components/QuickQuoteFlow.tsx");

// Tony (24/11/2026, "CORREZIONE CONFRONTO ECONOMICO", bolletta Elios CER SMART2 CASA, settembre 2026, totale 665,22 € con
// "SPESE PER INSOLUTO SDD" 10,00 €): three BPower offers were shown with monthly and annual savings while dispacciamento and
// capacity market were "non determinabili" (Atlante 3/11): the offer total left them out, the bill paid them. The same bill
// shape is rebuilt here on the synthetic 070789E reading (no customer data) with a 10 € insoluto fee among the altre partite.
// Engine and receipt formulas untouched: only what the screen declares changes.
const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 1, ...extra });
const dt = (descrizione, voce, importo) => ({ descrizione, voce, fascia: "NESSUNA", periodo: "", quantita: "", unita: "", prezzo: "", unitaPrezzo: "", importo, pagina: 3 });
const reading = parseBillReading({
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "AZIENDA DI PROVA", pod: "IT000E00000000",
  tipoClienteStampato: "altri usi", tensioneStampata: "", potenzaImpegnataKw: "4,0", potenzaMassimaPrelevataKw: "", mercato: "MERCATO LIBERO",
  periodoStampato: "01/10/2026 - 31/10/2026", periodoDal: "2026-10-01", periodoAl: "2026-10-31",
  consumoFatturato: "335", consumoF1: "56", consumoF2: "86", consumoF3: "193", consumoAnnuo: "",
  offertaNome: "OFFERTA DI PROVA", offertaCodice: "", tipologiaOfferta: "a prezzo variabile", tipologiaPrezzo: "a fasce", indice: "PUN",
  spread: "", pcvMensile: "", decorrenzaCondizioni: "", scadenzaContratto: "", totaleBolletta: "215,03",
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
    sc("Altre partite - SPESE PER INSOLUTO SDD SCAD. 29/09/2026", "ALTRE_PARTITE", "NESSUNA", "10,00"),
    sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "215,03"),
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

const components = engine.components.map(toComponent);
const complete = buildQuoteReceipt({ vector: "EE", offerSupplyCost: engine.totalCommercialCost, analysis, domestic: false, validUntil: null, offerComponents: components, warnings: engine.warnings });
const partial = buildQuoteReceipt({ vector: "EE", offerSupplyCost: engine.totalCommercialCost, analysis, domestic: false, validUntil: null, offerComponents: components, warnings: [...engine.warnings, "OFFICIAL_VALUE_MISSING:DISPATCHING:CTE_NOT_DETERMINABLE", "OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:CTE_NOT_DETERMINABLE"] });

// 2. The insoluto fee is out of the comparison, never removed from the bill: base 205,03 = 215,03 printed - 10,00, said on screen.
assert.equal(analysis.totals.billTotal, 215.03, "the bill total stays the printed one");
assert.equal(complete.currentTotal, 205.03, "the comparison base leaves the 10 € insoluto fee out");
const base = comparisonBase(complete, { analystReview: review });
assert.ok(base && /205,03/.test(base.replace(/\s/g, " ")) && /215,03/.test(base.replace(/\s/g, " ")) && /INSOLUTO/i.test(base) && /10,00/.test(base), `base traceable: ${base}`);

// 1. A complete receipt declares its saving; one with charges the CTE leaves undetermined does not, and has no projection.
assert.equal(savingDetermined(complete), true, "complete totals: saving declared");
assert.deepEqual(partial.undetermined.length, 2, `dispacciamento and capacity listed: ${partial.undetermined}`);
assert.equal(savingDetermined(partial), false, "undetermined charges: no saving declared");
assert.equal(savingDetermined({ status: "OFFER_ONLY", savings: null, undetermined: [], rows: [] }), false, "bill vendita not read: no saving");
const context = { vector: "EE", billingPeriod: { periodStart: "2026-10-01", periodEnd: "2026-10-31" }, consumption: { annual: 4000, period: { f1: 56, f2: 86, f3: 193, smc: null }, monthlyProfile: null, history: [] } };
assert.equal(annualProjection({ receipt: partial, discount: null }, context), null, "no annual or monthly saving on a partial total");

// The screen: undetermined saving said as such, no "La più conveniente", no proposal PDF; the scontrino in three columns.
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /Risparmio non determinabile/);
assert.match(flow, /index === 0 && savingDetermined\(offer\.receipt\)/);
assert.match(flow, /Proposta non disponibile: il risparmio non è determinabile \(mancano/);
assert.match(flow, /const costs = determined && !same/);
assert.match(flow, /<colgroup><col className="scontrino-col-label" \/><col \/><col \/><\/colgroup>/);
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.doesNotMatch(css, /\.scontrino-compare table \{ table-layout:fixed/, "no fixed layout that lets prices overflow");
assert.doesNotMatch(css, /\.scontrino-compare td \{ white-space:nowrap/, "cells may wrap");
console.log("quote-saving-determinable: ok");
