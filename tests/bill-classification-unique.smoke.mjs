import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { register } from "node:module";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { buildBillAnalystReview } from "../app/lib/foundation/bill-analyst-review.ts";
import { buildCurrentBillEconomicAnalysis, classifyBillEconomicComponent, isReactiveEnergy, billComponentLabel } from "../app/lib/foundation/bill-economic-analysis.ts";
import { comparisonComponentsOf } from "../app/lib/foundation/bill-feature-permissions.ts";
import { billReadSections } from "../app/lib/ui/bill-read-details.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";
import { offerScontrino } from "../app/lib/quote/offer-scontrino.ts";
import { technicalScontrino } from "../app/lib/quote/technical-scontrino.ts";
import { technicalTaxes } from "../app/lib/calculation/technical-quadrature.ts";
import { parseProposalPresentation } from "../app/lib/proposal/presentation.ts";
import { renderReceiptProposal } from "../app/lib/export/receipt-pdf.ts";

register("./node-tsx-render-loader.mjs", import.meta.url);
const { TechnicalSimulation } = await import("../app/components/QuickQuoteFlow.tsx");

// Tony (16/11/2026, "Eliminazione definitiva delle incoerenze di classificazione"): one classification of the bill's amounts,
// the bill analysis (bill-economic-analysis.ts), read by every view. Regression case 070789E (BPower, October 2026, CTE Be
// Smile FLEX 25): vendita 121,75 + rete e trasporto 18,54 + energia reattiva 5,48 + oneri 18,64 + accise 4,19 + IVA 36,43 =
// 205,03 €. The 5,48 € is energia reattiva in Dati letti, Dettaglio economico, Scontrino comparativo, Simulazione and PDF;
// never bonus, canone, altre partite or a difference. Synthetic reading with the same amounts: no customer data.
const cents = (value) => Math.round(value * 100) / 100;
const num = (text) => Number(String(text).replace(/[^\d,-]/g, "").replace(",", "."));
const plain = (text) => String(text).replace(/ /g, " ");

// ---------------------------------------------------------------------------------------------------------------------------
// The bill as the reader reads it (scontrino + detail), mapped and analysed as on the server.
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
const bill = { fields: {}, structuredBill, analystReview: review, resolvedVector: "EE" };
const analysis = review.economics.economicAnalysis;

// 1. Classification of reactive energy: stored with the code production knows (OTHER_CHARGE), classified by the analysis.
const stored = structuredBill.economicChargeLines.find((line) => /reattiva/i.test(line.description));
assert.equal(stored.code, "OTHER_CHARGE", "no new stored code: production shares the database");
const reactive = analysis.components.filter(isReactiveEnergy);
assert.equal(reactive.length, 1);
assert.deepEqual(
  { classification: reactive[0].classification, group: reactive[0].group, amount: num(reactive[0].amount), origin: reactive[0].origin, included: reactive[0].includedInReconciliation, role: reactive[0].accountingRole },
  { classification: "REACTIVE_ENERGY", group: "REACTIVE_ENERGY", amount: 5.48, origin: "PRINTED", included: true, role: "ATOMIC" },
);
assert.equal(classifyBillEconomicComponent("OTHER_CHARGE", "Energia reattiva immessa"), "REACTIVE_ENERGY");
assert.equal(classifyBillEconomicComponent("ALTRE_PARTITE", "Energia reattiva prelevata F1"), "REACTIVE_ENERGY");
assert.equal(classifyBillEconomicComponent("NETWORK_SYSTEM", "Corrispettivo energia reattiva"), "REACTIVE_ENERGY");
assert.equal(classifyBillEconomicComponent("OTHER_CHARGE", "Ricalcolo energia reattiva agosto"), "RICALCOLI", "a prior-period recalculation stays a recalculation");
for (const bucket of ["BONUS", "CANONE_RAI", "ALTRE_PARTITE", "UNCLASSIFIED_BILL_CHARGE"]) assert.ok(!analysis.components.some((line) => line.classification === bucket && num(line.amount) === 5.48), `5,48 never ${bucket}`);
assert.deepEqual(analysis.regulatedAndSystemCosts.REACTIVE_ENERGY.map((line) => line.lineId), reactive.map((line) => line.lineId), "Dettaglio economico: under costi regolati, its own bucket");
assert.equal(analysis.taxesAndOtherItems.OTHER_ITEMS.filter((line) => line.includedInReconciliation).length, 0, "nothing of 070789E is an altra partita");
// The quadro sintetico's quota totals are identified as quota totals, not altre partite; they are not summed again.
for (const line of analysis.components.filter((item) => /^Quota (per consumi|fissa|potenza)$/.test(item.description))) assert.deepEqual([line.classification, line.includedInReconciliation], ["QUOTA_TOTAL", false], line.description);

// 2. Sum of the components and reconciliation with the total, from the single classification.
const t = analysis.totals;
const amountOf = (classification) => cents(analysis.components.filter((line) => line.classification === classification && line.includedInReconciliation).reduce((sum, line) => sum + num(line.amount), 0));
const seller = cents(t.sellerEnergyTotal + t.sellerCommercializationTotal + (t.sellerOtherTotal ?? 0));
assert.deepEqual([seller, t.regulatedNetworkTotal, t.reactiveEnergyTotal, t.systemChargesTotal, amountOf("ACCISE"), amountOf("IVA"), t.billTotal], [121.75, 18.54, 5.48, 18.64, 4.19, 36.43, 205.03]);
assert.equal(cents(121.75 + 18.54 + 5.48 + 18.64 + 4.19 + 36.43), 205.03);
assert.equal(cents(seller + t.regulatedNetworkTotal + t.reactiveEnergyTotal + t.systemChargesTotal + t.taxTotal), t.billTotal, "the components add up to the printed total");
assert.equal(cents(t.regulatedNetworkTotal + t.reactiveEnergyTotal), 24.02, "rete complessiva");
assert.equal(t.reconciliationStatus, "RECONCILED");
assert.equal(t.reconciliationDifference, 0);
assert.equal(t.otherItemsTotal, null, "the reactive energy is not an altra partita");
assert.equal(t.extraordinaryTotal, null, "nor a voce straordinaria");
// Printed, calculated and assumed stay apart: the transport per quota is calculated from printed amounts, and says how.
const transport = analysis.components.filter((line) => line.classification === "ARERA_NETWORK" && line.includedInReconciliation);
assert.deepEqual(transport.map((line) => [num(line.amount), line.origin]), [[5.15, "CALCULATED"], [2.41, "CALCULATED"], [10.98, "CALCULATED"]]);
assert.match(plain(transport[0].derivation), /16,37 € \(rete e oneri stampati, quota energia\) − 11,22 € \(oneri di sistema stampati\) = 5,15 €/);
assert.ok(analysis.components.filter((line) => ["ARERA_SYSTEM_CHARGES", "ACCISE", "IVA", "SELLER_ENERGY_FEE", "SELLER_FIXED_FEE"].includes(line.classification)).every((line) => line.origin === "PRINTED"));
// The comparison-only copy (users without the technical detail) keeps classification and origin.
assert.deepEqual(comparisonComponentsOf(analysis.components).filter(isReactiveEnergy).map((line) => [line.classification, line.group, line.origin]), [["REACTIVE_ENERGY", "REACTIVE_ENERGY", "PRINTED"]]);

// 3. The same amounts in every view.
// Dati letti.
const economics = billReadSections(bill).find((section) => section.id === "ECONOMICS");
const row = (label) => { const found = economics.rows.find((item) => item.label === label && item.group !== "SIMULATOR"); return found && { ...found, value: plain(found.value), note: found.note && plain(found.note) }; };
assert.deepEqual([row("Energia reattiva").value, row("Energia reattiva").state, row("Energia reattiva").secondary], ["5,48 €", "READ", undefined], "Dati letti: read, in view");
assert.match(row("Energia reattiva").note, /Stampata in fattura: "Energia reattiva immessa" 5,48 €/);
assert.deepEqual([row("Vendita").value, row("Rete e trasporto").value, row("Rete complessiva").value, row("Oneri di sistema").value, row("Accise").value, row("IVA").value, row("Totale fattura").value], ["121,75 €", "18,54 €", "24,02 €", "18,64 €", "4,19 €", "36,43 €", "205,03 €"]);
assert.equal(row("Rete complessiva").state, "CALCULATED", "rete complessiva is a sum of the simulator, marked as such");
assert.equal(row("Totale fattura").note, undefined, "no unexplained 5,48 € difference on the total");
assert.ok(!economics.rows.some((item) => /altre partite|bonus|canone/i.test(item.label)), "no altre partite, bonus or canone row");

// Scontrino comparativo (ordinary path: Be Smile is within its requirements).
const engine = JSON.parse(readFileSync(new URL("./fixtures/receipt-070789E-engine-result.json", import.meta.url), "utf8"));
const offerComponents = engine.components.map((c) => ({ category: c.category, sign: c.sign, label: c.label, formulaId: c.formulaId, amount: { amount: c.amount }, formulaInputs: c.formulaInputs }));
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: engine.totalCommercialCost, analysis, domestic: false, validUntil: null, offerComponents, warnings: engine.warnings });
const quota = (key) => receipt.quotas.find((item) => item.key === key);
assert.deepEqual([quota("REACTIVE").label, quota("REACTIVE").current, quota("REACTIVE").offer, quota("REACTIVE").difference], ["Energia reattiva", 5.48, 5.48, 0]);
assert.equal(quota("OTHER"), undefined, "no \"Altre voci\" made of an arithmetic remainder");
const networkRow = receipt.rows.find((item) => item.key === "NETWORK");
assert.deepEqual([networkRow.current, networkRow.offer], [24.02, 24.02], "rete complessiva in both columns");
assert.deepEqual(networkRow.details.filter((item) => item.key === "REACTIVE").map((item) => [item.label, item.current, item.offer]), [["Energia reattiva", 5.48, 5.48]]);
assert.deepEqual(receipt.excluded, [], "nothing left out of the comparison");
const scontrino = (side) => offerScontrino({ quotas: receipt.quotas, offerTotal: side === "current" ? receipt.currentTotal : receipt.offerTotal, taxesIncluded: receipt.taxesIncluded, vector: "EE", quantity: 335, months: 1, powerKw: 4, side });
for (const side of ["current", "offer"]) {
  const lines = scontrino(side);
  assert.deepEqual(lines.filter((line) => line.label === "Energia reattiva").map((line) => [line.kind, line.amount]), [["item", 5.48]], `${side}: energia reattiva on its own line`);
  assert.ok(!lines.some((line) => /altre partite|bonus|canone/i.test(line.label)), `${side}: no altre partite, bonus or canone`);
  const placed = cents(lines.filter((line) => line.kind === "main" || line.kind === "item").reduce((sum, line) => sum + line.amount, 0));
  assert.equal(placed, lines.find((line) => line.kind === "total").amount, `${side}: the lines add up to the total`);
}
assert.equal(scontrino("current").find((line) => line.kind === "total").amount, 205.03);
assert.equal(scontrino("offer").find((line) => line.kind === "total").amount, 203.98);

// Simulazione (technical scontrino and its screen): the bill column names the energia reattiva; the simulation does not price it.
// The simulation's taxes from the server's fiscal module, never from the bill (as in the technical simulation).
const regulatedComplete = { status: "COMPLETE", basis: "ENGINE", tariffClass: "BTA6", checked: [], missing: [], asos: { class: "0", basis: "DOCUMENTED", note: "classe ASOS documentata" } };
const taxes = technicalTaxes({ vector: "EE", taxTreatment: "EXCLUDED", domestic: false, resident: null, committedPowerKw: 4, supplyPeriod: { periodStart: "2026-10-01", periodEnd: "2026-11-01" }, bands: { f1: 56, f2: 86, f3: 193 }, monthlyProfile: null, warnings: [], regulated: regulatedComplete, totalNetOfTaxes: 158.07 });
const result = { components: engine.components, totalCommercialCost: engine.totalCommercialCost, costScope: "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE", warnings: [], regulatedCompleteness: regulatedComplete, taxes, totals: { netOfTaxes: 158.07, taxes: taxes.totalTaxes, withTaxes: taxes.totalTaxes === null ? null : cents(158.07 + taxes.totalTaxes) } };
const technical = technicalScontrino({ vector: "EE", result, analysis, domestic: false, quantity: 335, months: 1, powerKw: 4 });
assert.deepEqual(technical.rows.filter((line) => line.label === "Energia reattiva").map((line) => [line.bill?.amount, line.offer?.amount ?? null]), [[5.48, null]], "Simulazione: bill column, not priced by the simulation");
assert.ok(!technical.rows.some((line) => /altre partite/i.test(line.label)));
assert.ok(technical.missing.some((text) => /energia reattiva/.test(text)), "the simulation says it does not price the energia reattiva");
const context = { billId: "bill-test", billVersionId: "v1", vector: "EE", customerType: "NON_RESIDENTIAL", supply: { pod: null, pdr: null, voltageLevel: "LV", contractedPowerKw: 4 }, consumption: { annual: null, period: { f1: 56, f2: 86, f3: 193, smc: null } }, billingPeriod: { periodStart: "2026-10-01", periodEnd: "2026-11-01" }, currentSupplier: "Fornitore attuale", classification: { domestic: false }, missingRequiredData: [] };
const html = plain(renderToStaticMarkup(createElement(TechnicalSimulation, { result: { banner: "SIMULAZIONE TECNICA", cte: { supplier: "Venditore", offerName: "Offerta", offerCode: "T", consumptionRequirement: "" }, annualConsumption: { value: null, status: "ESTIMATED" }, totalCommercialPlusRegulatedSubsetCost: 158.07, ...result }, context, bill: { analystReview: review } })));
assert.match(html, /Energia reattiva/);
assert.match(html, /5,48 €/);
assert.doesNotMatch(html, /Altre partite/);

// 4. PDF export: the presentation built from the same receipt and scontrino, through the server's validation.
const presentation = parseProposalPresentation({
  customerName: "Cliente di prova", supplyLabel: "IT000E00000000", billSupplier: "Fornitore attuale", billOfferName: "Offerta attuale", offerSupplier: "Venditore", offerName: "Offerta", offerCode: "T",
  periodLabel: "01/10/2026 - 31/10/2026", consumptionLabel: "335 kWh", taxesIncluded: true, sameOffer: false, currentTotal: receipt.currentTotal, offerTotal: receipt.offerTotal, savings: receipt.savings, savingsPercent: receipt.savingsPercent,
  annualSaving: null, annualCurrent: null, annualBasisLabel: "", validUntil: null,
  rows: receipt.rows.flatMap((item) => [{ label: item.label, current: item.current, offer: item.offer, difference: item.difference ?? null, detail: false }, ...(item.details ?? []).map((detail) => ({ label: detail.label, current: detail.current, offer: detail.offer, difference: detail.difference, detail: true }))]),
  comparison: [], excluded: receipt.excluded ?? [], scontrino: scontrino("offer"), billScontrino: scontrino("current"),
});
const pdf = Buffer.from(renderReceiptProposal({ generatedAt: "2026-11-16T00:00:00.000Z", customer: { displayName: "Cliente di prova" }, selectedOffer: { supplier: "Venditore", offerCode: "T" } }, presentation, null)).toString("latin1");
const reactiveRows = pdf.match(/Energia reattiva/g) ?? [];
assert.ok(reactiveRows.length >= 3, "PDF: energia reattiva in both scontrini and in the comparison detail");
assert.doesNotMatch(pdf, /Altre partite|Altre voci della fornitura|Escluse dal confronto/, "PDF: never altre partite");

// 5. An unknown line stays distinct from an identified one: declared unknown, never given a category.
const unknownAnalysis = buildCurrentBillEconomicAnalysis([
  { code: "OTHER_CHARGE", description: "Energia reattiva immessa", amount: "5,48" },
  { code: "OTHER_CHARGE", description: "Corrispettivo XYZ", amount: "2,00" },
  { code: "SELLER_ENERGY_FEE", description: "Spesa per la vendita di energia", amount: "100,00" },
  { code: "BILL_TOTAL", description: "Totale bolletta", amount: "107,48" },
], "107,48");
const byDescription = (description) => unknownAnalysis.components.find((line) => line.description === description);
assert.deepEqual([byDescription("Energia reattiva immessa").classification, byDescription("Corrispettivo XYZ").classification], ["REACTIVE_ENERGY", "ALTRE_PARTITE"], "OTHER_CHARGE without a known name is the reader's altre partite");
const unknown = buildCurrentBillEconomicAnalysis([{ code: "LINEA_NON_CATALOGATA", description: "Voce mai vista", amount: "2,00" }, { code: "OTHER_CHARGE", description: "Energia reattiva immessa", amount: "5,48" }, { code: "BILL_TOTAL", description: "Totale bolletta", amount: "7,48" }], "7,48");
const unknownLine = unknown.components.find((line) => line.description === "Voce mai vista");
assert.deepEqual([unknownLine.classification, unknownLine.group], ["UNCLASSIFIED_BILL_CHARGE", "OTHER_ITEMS"]);
assert.equal(billComponentLabel(unknownLine), "Voce mai vista (voce non classificata)");
assert.equal(unknown.totals.reactiveEnergyTotal, 5.48);
assert.equal(unknown.totals.otherItemsTotal, 2, "the unknown line alone is in the other items");
const unknownReceipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 0, analysis: unknown, domestic: false, validUntil: null, offerComponents: [] });
assert.deepEqual(unknownReceipt.excluded, [{ label: "Voce mai vista (voce non classificata)", amount: 2 }], "the unknown line is left out of the comparison and said unknown");
assert.equal(unknownReceipt.quotas.find((item) => item.key === "REACTIVE")?.offer, 5.48, "the identified line keeps its own quota");

// 6. No double counting: the 5,48 € is once in the analysis, once in the scontrino, never inside rete e trasporto or altre partite.
assert.equal(analysis.components.filter((line) => line.includedInReconciliation && num(line.amount) === 5.48).length, 1);
assert.equal(cents(receipt.quotas.filter((item) => !["EXCISE", "VAT", "TAXES"].includes(item.key)).reduce((sum, item) => sum + item.current, 0) + 40.62), 205.03, "quotas + taxes = bill total, 5,48 counted once");
assert.deepEqual([receipt.officialCheck.NETWORK.status, receipt.officialCheck.NETWORK.official, receipt.officialCheck.NETWORK.difference], ["VERIFIED", 18.54, 0], "the ARERA check compares the transport (18,54) without the reactive energy");
assert.deepEqual([receipt.officialCheck.SYSTEM.status, receipt.officialCheck.SYSTEM.official], ["VERIFIED", 18.64]);

// 7. Backward compatibility, 071808E (no reactive energy): same quotas and totals as before.
const l = (description, amount, unit = null, quantity = null, code = null, unitPrice = null) => ({ code, description, amount, quantity, unitPrice, unit, period: null });
const bill071808 = buildCurrentBillEconomicAnalysis([
  l("Quota per consumi", "3,42 €", "kWh", "10"), l("Quota per consumi - di cui spesa per vendita energia", "2,92 €", "€/kWh", null, null, "0,292"), l("Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "0,50 €", "€/kWh", null, null, "0,05"),
  l("Quota fissa", "18,74 €", "mese", "1"), l("Quota fissa - di cui spesa per vendita energia", "15,00 €", "€/mese"), l("Quota fissa - di cui spesa per la rete e gli oneri generali di sistema", "3,74 €", "€/mese"),
  l("Quota potenza", "6,40 €", "kW", "1,5"), l("Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "6,40 €", "€/kW"),
  l("Oneri - Quota per consumi - ARIM", "0,02", "€/kWh", "10", "ARIM"), l("Oneri - Quota per consumi - ASOS", "0,32", "€/kWh", "10", "ASOS"), l("Oneri - Quota fissa - ARIM", "0,25", "€/mese", "1", "ARIM"),
  l("Oneri - Quota fissa - ASOS", "1,08", "€/mese", "1", "ASOS"), l("Oneri - Quota potenza - ARIM", "0,43", "€/kW", "1,5", "ARIM"), l("Oneri - Quota potenza - ASOS", "1,85", "€/kW", "1,5", "ASOS"),
  l("Imposta erariale di consumo (accise)", "0,13 €", "€/kWh", "10", "ACCISE", "0,0125"), l("IVA 22%", "6,31 €", null, null, "IVA"), l("TOTALE BOLLETTA", "35,00 €", null, null, "BILL_TOTAL"),
], "35,00");
assert.deepEqual([bill071808.totals.reactiveEnergyTotal, bill071808.totals.reconciliationStatus, bill071808.totals.regulatedNetworkTotal, bill071808.totals.systemChargesTotal, bill071808.totals.taxTotal], [null, "RECONCILED", 6.69, 3.95, 6.44]);
const receipt071808 = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 17.92, analysis: bill071808, domestic: false, validUntil: null, offerComponents: [] });
assert.deepEqual(receipt071808.quotas.filter((item) => item.current).map((item) => [item.key, item.current]), [["CONSUMPTION", 3.42], ["FIXED", 18.74], ["POWER", 6.4], ["EXCISE", 0.13], ["VAT", 6.31]], "bill column as before");
assert.equal(receipt071808.quotas.some((item) => item.key === "REACTIVE"), false, "no reactive line where the bill has none");
assert.equal(receipt071808.currentTotal, 35);

// 8. No economic formula changed: the bill and offer totals of 070789E are the ones of the 15-16/11 collaudo.
assert.deepEqual([receipt.currentTotal, receipt.offerTotal, receipt.savings], [205.03, 203.98, 1.05]);
assert.deepEqual(receipt.rows.map((item) => [item.key, item.current, item.offer]), [["ENERGY", 121.75, 120.89], ["NETWORK", 24.02, 24.02], ["SYSTEM", 18.64, 18.64], ["TAXES", 40.62, 40.43]]);
assert.equal(engine.totalCommercialCost, 120.89, "engine output untouched");

console.log("bill classification unique smoke passed");
