import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (27/10): "la simulazione dovrebbe dare lo stesso risultato della bolletta, perchè la cte bsmart è la stessa
// utilizzata per la bolletta". BPower Energia, Alone srl, settembre 2026, BT altri usi 15 kW, 3.512 kWh, totale 1.546,10 EUR.
// The receipt showed 0,01 EUR of dispatching, capacity and imbalance (the Box dell'offerta unit prices read as amounts) and
// 71,20 EUR of transport (the quadro sintetico's rete e oneri, oneri included and quota energia missing).
const line = (description, amount, quantity = null, unitPrice = null, code = null) => ({ code, description, amount, quantity, unitPrice, unit: null, period: null });
const summaryBill = [
  // Scontrino dell'energia
  line("Quota per consumi", "1.135,33 €", "3.512 kWh", "0,323272"),
  line("di cui spesa per la vendita di energia elettrica", "963,56 €", null, "0,274362"),
  line("di cui spesa per la rete e gli oneri generali di sistema", "171,77 €", null, "0,048909"),
  line("Quota fissa", "18,81 €", "1 mese", "18,81"),
  line("di cui spesa per la vendita di energia elettrica (quota fissa)", "15,00 €", null, "15,00"),
  line("di cui spesa per la rete e gli oneri generali di sistema (quota fissa)", "3,81 €", null, "3,81", "NETWORK_FIXED"),
  line("Quota potenza", "67,39 €", "15,0 kW", "4,492667"),
  line("di cui spesa per la rete e gli oneri generali di sistema (quota potenza)", "67,39 €", null, "4,492667", "NETWORK_POWER"),
  line("Altre partite - Interessi di mora per il ritardato pagamento della fattura", "2,28 €"),
  line("Accise e IVA", "322,29 €", null, null, "TAX_SUBTOTAL"),
  line("Totale bolletta", "1.546,10 €", null, null, "BILL_TOTAL"),
  // Box dell'offerta
  line("Totale spesa dovuta per l'offerta", "978,56 €"),
  line("di cui quota spesa consumi", "963,56 €"),
  line("di cui quota spesa fisso", "15,00 €"),
  line("Energia Attiva F1", "0,206350 €/kWh", null, "0,206350", "ENERGY_PRICE_F1"),
  line("Energia Attiva F2", "0,227576 €/kWh", null, "0,227576", "ENERGY_PRICE_F2"),
  line("Energia Attiva F3", "0,197024 €/kWh", null, "0,197024", "ENERGY_PRICE_F3"),
  line("Spread", "0,010000", null, "0,010000", "SPREAD"),
  line("Dispacciamento", "0,010501", null, "0,010501", "DISPATCHING"),
  line("Corrispettivo mercato capacità", "0,010697 €/kWh", null, "0,010697", "CAPACITY_MARKET"),
  line("Commercializzazione", "0,002216 €/kWh", null, "0,002216", "COMMERCIALIZATION"),
  line("Sbilanciamento", "0,005540 €/kWh", null, "0,005540", "IMBALANCE"),
  // Imposte
  line("Imposte erariali (primo scaglione)", "43,90 €", "3.512 kWh", "0,0125", "EXCISE"),
  line("IVA vendite 22%", "278,39 €", "1.265,43", "22", "VAT"),
  line("Fuori Campo Art. 15", "0,00 €", "2,28", "0", "VAT"),
  // Oneri generali di sistema
  line("Componente ASOS - quota potenza", "19,50 €", null, null, "ASOS"),
  line("Componente ASOS - quota per consumi", "111,97 €", null, null, "ASOS"),
  line("Componente ASOS - quota fissa", "1,10 €", null, null, "ASOS"),
  line("Componente ARIM - quota potenza", "4,55 €", null, null, "ARIM"),
  line("Componente ARIM - quota per consumi", "5,68 €", null, null, "ARIM"),
  line("Componente ARIM - quota fissa", "0,26 €", null, null, "ARIM"),
];
const summary = buildCurrentBillEconomicAnalysis(summaryBill, "1.546,10", { billingPeriodStart: "2026-09-01" });
assert.equal(summary.totals.reconciliationStatus, "RECONCILED", `difference ${summary.totals.reconciliationDifference}`);
assert.equal(summary.totals.sellerEnergyTotal, 963.56);
assert.equal(summary.totals.sellerOtherTotal, null, "the Box dell'offerta unit prices are not money billed");
// Transport = rete e oneri of the quadro sintetico minus the oneri page, per quota: the detailed bill's own lines.
assert.equal(summary.totals.regulatedNetworkTotal, 99.91);
assert.deepEqual(summary.components.filter((item) => item.classification === "ARERA_NETWORK" && item.includedInReconciliation).map((item) => item.amount).sort(), ["2,45", "43,34", "54,12"]);
assert.equal(summary.totals.systemChargesTotal, 143.06);

// The detailed bill (065400E_D) prints every charge with quantity and unit price.
const detailBill = [
  line("Energia Attiva F1", "262,43 €", "1.213 kWh", "0,216350"), line("Energia Attiva F2", "279,39 €", "1.176 kWh", "0,237576"), line("Energia Attiva F3", "232,49 €", "1.123 kWh", "0,207024"),
  line("Perdite di rete F1", "26,18 €", "121 kWh", "0,216350"), line("Perdite di rete F2", "28,03 €", "118 kWh", "0,237576"), line("Perdite di rete F3", "23,19 €", "112 kWh", "0,207024"),
  line("Corrispettivo mercato capacità (quote variabili)", "41,32 €", "3.863 kWh", "0,010697"), line("Dispacciamento (quote variabili)", "40,57 €", "3.863 kWh", "0,010501"),
  line("Commercializzazione", "8,56 €", "3.863 kWh", "0,002216"), line("Sbilanciamento", "21,40 €", "3.863 kWh", "0,005540"), line("QF", "15,00 €", "1 POD/mese", "15,000000"),
  line("TOTALE", "978,56 €"),
  line("Trasporto (quote variabili)", "54,12 €", "3.512 kWh", "0,015410"), line("Trasporto (quote fisse)", "2,45 €", "1 POD/mese", "2,450000"), line("Trasporto (quote potenza)", "43,34 €", "15 kW/mese", "2,889300"),
  line("TOTALE", "99,91 €"),
  line("Oneri di sistema (quote variabili)", "117,65 €", "3.512 kWh", "0,033499"), line("Oneri di sistema (quote fisse)", "1,36 €", "1 POD/mese", "1,360000"), line("Oneri di sistema (quote potenza)", "24,05 €", "15 kW/mese", "1,603333"),
  line("TOTALE", "143,06 €"),
  line("Imposte Erariali", "43,90 €", "3.512 kWh", "0,012500"), line("TOTALE", "43,90 €"),
  line("Interessi di mora per il ritardato pagamento della fattura", "2,28 €", "1 POD/mese", "2,280000"), line("TOTALE", "2,28 €"),
  line("TOTALE PERIODO", "1.267,71 €"),
];
const detail = buildCurrentBillEconomicAnalysis(detailBill, "1.267,71", { billingPeriodStart: "2026-09-01" });
assert.equal(detail.totals.reconciliationStatus, "RECONCILED", `difference ${detail.totals.reconciliationDifference}`);
assert.equal(detail.totals.regulatedNetworkTotal, 99.91);
assert.equal(detail.totals.systemChargesTotal, 143.06);
assert.equal(Math.round(((detail.totals.sellerEnergyTotal ?? 0) + (detail.totals.sellerCommercializationTotal ?? 0) + (detail.totals.sellerOtherTotal ?? 0)) * 100) / 100, 978.56);

// Receipt on the summary bill: the charges the bill folds into the energy line say so, and the energy line is compared with
// the CTE's energy plus those charges.
const offer = [
  { category: "ENERGY", sign: "CHARGE", label: "Energia", amount: { amount: 774.31 } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Perdite di rete", amount: { amount: 77.43 }, formulaInputs: { kind: "LOSSES" } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Dispacciamento", amount: { amount: 40.56 }, formulaInputs: { kind: "DISPATCHING" } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Capacity market libero (da CTE)", amount: { amount: 28.97 }, formulaInputs: { kind: "CAPACITY_MARKET", source: "CTE_STATED_VALUE" } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Commercializzazione", amount: { amount: 7.02 }, formulaInputs: { feeUnit: "EUR_PER_KWH" } },
  { category: "IMBALANCE", sign: "CHARGE", label: "Sbilanciamento", amount: { amount: 17.56 }, formulaInputs: { feeUnit: "EUR_PER_KWH" } },
  { category: "FIXED_FEE", sign: "CHARGE", label: "Quota fissa", amount: { amount: 15 }, formulaInputs: { feeUnit: "EUR_PER_MONTH" } },
];
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 960.85, analysis: summary, domestic: false, validUntil: null, offerComponents: offer });
const energyRow = receipt.rows.find((row) => row.key === "ENERGY");
assert.equal(energyRow.current, 978.56);
const details = Object.fromEntries(energyRow.details.map((item) => [item.key, item]));
assert.equal(details.DISPATCHING.current, null);
assert.match(details.DISPATCHING.currentNote, /compreso nel prezzo energia della bolletta \(0,010501 €\/kWh\)/);
assert.match(details.LOSSES.currentNote, /compreso nel prezzo energia/);
assert.match(details.ENERGY.label, /comprende anche/);
assert.equal(details.ENERGY.difference, Math.round((774.31 + 77.43 + 40.56 + 28.97 + 7.02 + 17.56 - 963.56) * 100) / 100);
assert.equal(receipt.rows.find((row) => row.key === "NETWORK").current, 99.91);

// Tony (28/10): "come fa ad essere diversa se la fattura ... è stata emessa con le caratteristiche della cte selezionata?".
// The stored reading of the same bill had the Box prices rounded to cents (0,01 € of dispatching, 0,21 € of F1) and the
// oneri both per quota and as one 143,06 € total: the receipt showed 964,20 € of energy and -88,94 € of transport.
const rounded = summaryBill.filter((item) => !/^Componente/.test(item.description) && !/ENERGY_PRICE|SPREAD|DISPATCHING|CAPACITY_MARKET|COMMERCIALIZATION|IMBALANCE/.test(item.code ?? "")).concat([
  line("Energia Attiva F1", "0,21 €", null, "0,206350", "ENERGY_PRICE_F1"), line("Energia Attiva F2", "0,23 €", null, "0,227576", "ENERGY_PRICE_F2"), line("Energia Attiva F3", "0,20 €", null, "0,197024", "ENERGY_PRICE_F3"),
  line("Dispacciamento", "0,01 €", null, null, "DISPATCHING"), line("Corrispettivo mercato capacità", "0,01 €", null, null, "CAPACITY_MARKET"), line("Sbilanciamento", "0,01 €", null, "0,005540", "IMBALANCE"),
  line("Oneri di sistema quota potenza", "24,05 €", null, null, "SYSTEM_CHARGES"), line("Oneri di sistema quota energia", "117,65 €", null, null, "SYSTEM_CHARGES"), line("Oneri di sistema quota fissa", "1,36 €", null, null, "SYSTEM_CHARGES"),
  line("Spesa per oneri di sistema", "143,06 €", null, null, "SYSTEM_CHARGES"),
]);
const stored = buildCurrentBillEconomicAnalysis(rounded, "1.546,10", { billingPeriodStart: "2026-09-01" });
assert.equal(stored.totals.reconciliationStatus, "RECONCILED", `difference ${stored.totals.reconciliationDifference}`);
assert.equal(stored.totals.sellerEnergyTotal, 963.56);
assert.equal(stored.totals.sellerOtherTotal, null);
assert.equal(stored.totals.systemChargesTotal, 143.06);
assert.equal(stored.totals.regulatedNetworkTotal, 99.91);
const storedReceipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 960.85, analysis: stored, domestic: false, validUntil: null, offerComponents: offer });
assert.equal(storedReceipt.rows.find((row) => row.key === "ENERGY").current, 978.56);
const storedDetails = Object.fromEntries(storedReceipt.rows.find((row) => row.key === "ENERGY").details.map((item) => [item.key, item]));
assert.equal(storedDetails.DISPATCHING.current, null); assert.match(storedDetails.DISPATCHING.currentNote, /compreso nel prezzo energia/);
assert.equal(storedReceipt.rows.find((row) => row.key === "NETWORK").current, 99.91);
assert.equal(storedReceipt.rows.find((row) => row.key === "SYSTEM").current, 143.06);
console.log("BPOWER_BE_SMART_BILL=PASS");
