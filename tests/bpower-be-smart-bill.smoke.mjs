import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt, isSameOffer, sameOfferDifferences } from "../app/lib/quote/receipt.ts";

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
// Tony (28/10): the bill is issued with the Be Smart CTE, so the receipt lists every charge that differs and why.
assert.equal(isSameOffer({ billSupplier: "BPower Energia S.p.A.", billOffer: "003888ESVFL04XXXXXXXXXBSMART1125", offerSupplier: "BPower Energia S.p.A.", offerCode: "003888ESVFL04XXXXXXXXXBSMART1125", offerName: "Be Smart" }), true);
assert.equal(isSameOffer({ billSupplier: "BPower Energia S.p.A.", billOffer: "003888ESVFL04XXXXXXXXXBSMART1125", offerSupplier: "Enel Energia S.p.A.", offerCode: "003888ESVFL04XXXXXXXXXBSMART1125", offerName: "Be Smart" }), false);
const sameOfferCheck = sameOfferDifferences(storedReceipt);
assert.ok(sameOfferCheck.length > 0 && sameOfferCheck.every((item) => item.cause.length > 0));
assert.ok(!sameOfferCheck.some((item) => /Dispacciamento/.test(item.label) && item.current === null && item.offer === null), "charges billed inside the energy price are not differences");
// Tony (28/10, c6b6519): "ancora errori e mancate letture anche dei dati in archivio". The archived reading keeps the Box
// unit (€/kWh or kWh) in the unit field and uses the stored catalogue codes: still read as 0,01 € billed.
const unitLine = (description, amount, unit, code, unitPrice = null) => ({ ...line(description, amount, null, unitPrice, code), unit });
const archived = rounded.filter((item) => !/ENERGY_PRICE|DISPATCHING|CAPACITY_MARKET|IMBALANCE/.test(item.code ?? "")).concat([
  unitLine("Energia Attiva F1", "0,21", "€/kWh", "PUN_F1"), unitLine("Energia Attiva F2", "0,23", "€/kWh", "PUN_F2"), unitLine("Energia Attiva F3", "0,20", "kWh", "PUN_F3"),
  unitLine("Dispacciamento", "0,01", "€/kWh", "DISPATCHING_SELLER_CHARGE"), unitLine("Corrispettivo mercato capacità", "0,01", "EUR/KWH", "CAPACITY_MARKET_SELLER_CHARGE"), unitLine("Sbilanciamento", "0,01", "€/kWh", "BALANCING_CHARGE"),
]);
const archivedAnalysis = buildCurrentBillEconomicAnalysis(archived, "1.546,10", { billingPeriodStart: "2026-09-01" });
assert.equal(archivedAnalysis.totals.sellerEnergyTotal, 963.56);
assert.equal(archivedAnalysis.totals.reconciliationStatus, "RECONCILED", `difference ${archivedAnalysis.totals.reconciliationDifference}`);
const archivedReceipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 960.85, analysis: archivedAnalysis, domestic: false, validUntil: null, offerComponents: offer });
const archivedDetails = Object.fromEntries(archivedReceipt.rows.find((row) => row.key === "ENERGY").details.map((item) => [item.key, item]));
for (const key of ["DISPATCHING", "CAPACITY_MARKET"]) if (archivedDetails[key]) assert.equal(archivedDetails[key].current, null, key);
assert.equal(archivedReceipt.rows.find((row) => row.key === "ENERGY").current, 978.56);
// Tony (28/10, fb5aede, screenshot): still 964,20 € of energy and 0,01 € of dispatching, capacity and imbalance. The archived
// Box lines also carry the kWh of the period (and sometimes the unit price): a few cents on 3.863 kWh is the price itself.
const withKwh = rounded.filter((item) => !/ENERGY_PRICE|DISPATCHING|CAPACITY_MARKET|IMBALANCE/.test(item.code ?? "")).concat([
  { ...unitLine("Energia Attiva F1", "0,21", "kWh", "PUN_F1", "0,206350"), quantity: "1.290 kWh" }, { ...unitLine("Energia Attiva F2", "0,23", "kWh", "PUN_F2"), quantity: "1.020" }, { ...unitLine("Energia Attiva F3", "0,20", "kWh", "PUN_F3"), quantity: "1.202 kWh" },
  { ...unitLine("Dispacciamento", "0,01", "kWh", "DISPATCHING_SELLER_CHARGE", "0,010501"), quantity: "3.863 kWh" }, { ...unitLine("Corrispettivo mercato capacità", "0,01", "€", "UNKNOWN"), quantity: "3.863" }, { ...unitLine("Sbilanciamento", "0,01", "kWh", "BALANCING_CHARGE"), quantity: "3.863 kWh" },
]);
const withKwhAnalysis = buildCurrentBillEconomicAnalysis(withKwh, "1.546,10", { billingPeriodStart: "2026-09-01" });
assert.equal(withKwhAnalysis.totals.sellerEnergyTotal, 963.56);
assert.equal(withKwhAnalysis.totals.reconciliationStatus, "RECONCILED", `difference ${withKwhAnalysis.totals.reconciliationDifference}`);
const withKwhReceipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 960.85, analysis: withKwhAnalysis, domestic: false, validUntil: null, offerComponents: offer });
const withKwhDetails = Object.fromEntries(withKwhReceipt.rows.find((row) => row.key === "ENERGY").details.map((item) => [item.key, item]));
assert.equal(withKwhDetails.ENERGY.current, 963.56);
for (const key of ["DISPATCHING", "CAPACITY_MARKET", "IMBALANCE", "LOSSES", "COMMERCIALIZATION"]) if (withKwhDetails[key]) { assert.equal(withKwhDetails[key].current, null, key); assert.match(withKwhDetails[key].currentNote ?? "", /compreso nel prezzo energia/, key); }
// A real small charge on few kWh stays billed.
assert.equal(buildCurrentBillEconomicAnalysis([line("Dispacciamento", "0,40 €", "5 kWh", "0,08", "DISPATCHING")], null).components[0].accountingRole, "ATOMIC");
assert.doesNotMatch(withKwhDetails.IMBALANCE.currentNote, /0\.01/, "a price rounded to cents is not shown as the unit price");
// Tony (28/10, 23a6078): BPower bills commercialisation and imbalance at 0,002216 and 0,00554 €/kWh on kWh with losses,
// the CTE prints 0,002 and 0,005 net of losses: "derivano da un arrotondamento di decimali sulla cte ... la consideriamo
// corretta". The -5,35 € on the energy price and the -1,18 € of IVA on it are accepted; a larger gap is still a difference.
const sameCte = (energyGap, vatGap) => sameOfferDifferences({ rows: [
  { key: "ENERGY", label: "Spesa per la materia energia", current: 978.56, offer: 978.56 + energyGap, details: [{ key: "ENERGY", label: "Prezzo energia, in bolletta comprende anche commercializzazione, sbilanciamento", current: 963.56, offer: 963.56 + energyGap, difference: energyGap }, { key: "PCV", label: "Quota fissa di vendita (PCV)", current: 15, offer: 15, difference: 0 }] },
  { key: "TAX", label: "Imposte (accise e IVA)", current: 322.29, offer: 322.29 + vatGap, details: [{ key: "EXCISE", label: "Accise", current: 43.9, offer: 43.9, difference: 0 }, { key: "VAT", label: "IVA", current: 278.39, offer: 278.39 + vatGap, difference: vatGap }] },
] });
assert.ok(sameCte(-5.35, -1.18).every((item) => item.accepted === true), JSON.stringify(sameCte(-5.35, -1.18)));
assert.equal(sameCte(-20, -4.4).filter((item) => !item.accepted).length, 2, "a gap above 1% of the energy price is a real difference");
// Tony (28/10, BPower Be FIX RELAX 26 microbus, 213 kWh): "quello che segni non in bolletta, in effetti si trova dentro il
// prezzo energia". The bill prints one energy line (49,21 €) and no Box: losses, commercialisation, dispatching, capacity
// and imbalance of the CTE are compared inside it, not shown as "non in bolletta".
const fixBill = buildCurrentBillEconomicAnalysis([
  line("Energia attiva prezzo fisso", "49,21 €", "213 kWh", "0,231033", "ENERGY_FIXED_PRICE"), line("Quota fissa", "15,00 €", "1 mese", "15,00", "PCV"),
], "64,21");
const fixOffer = [
  { category: "ENERGY", sign: "CHARGE", label: "Energia a prezzo fisso", amount: { amount: 38.13 } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Perdite di rete", amount: { amount: 3.81 }, formulaInputs: { kind: "LOSSES" } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Dispacciamento", amount: { amount: 2.46 }, formulaInputs: { kind: "DISPATCHING" } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Mercato della capacità", amount: { amount: 0.75 }, formulaInputs: { kind: "CAPACITY_MARKET" } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Commercializzazione", amount: { amount: 0.85 }, formulaInputs: { feeUnit: "EUR_PER_KWH" } },
  { category: "IMBALANCE", sign: "CHARGE", label: "Sbilanciamento", amount: { amount: 1.07 }, formulaInputs: { feeUnit: "EUR_PER_KWH" } },
  { category: "FIXED_FEE", sign: "CHARGE", label: "Quota fissa", amount: { amount: 15 }, formulaInputs: { feeUnit: "EUR_PER_MONTH" } },
];
const fixDetails = Object.fromEntries(buildQuoteReceipt({ vector: "EE", offerSupplyCost: 62.07, analysis: fixBill, domestic: false, validUntil: null, offerComponents: fixOffer }).rows.find((row) => row.key === "ENERGY").details.map((item) => [item.key, item]));
for (const key of ["LOSSES", "COMMERCIALIZATION", "DISPATCHING", "IMBALANCE"]) assert.match(fixDetails[key]?.currentNote ?? "", /compreso nel prezzo energia/, key);
assert.match(fixDetails.ENERGY.label, /comprende anche/);
assert.equal(fixDetails.ENERGY.difference, Math.round((38.13 + 3.81 + 2.46 + 0.75 + 0.85 + 1.07 - 49.21) * 100) / 100);
// Tony (28/10, BPower Casa Protetta, domestico non residente 3 kW, 65 kWh, totale 128,07 EUR): the quadro sintetico prices
// the quota fissa per day ("di cui spesa per la rete" 8,86 EUR at 0,328148 EUR/giorno). A per-day line is the quota fissa,
// so its transport is 8,86 - 7,13 ASOS quota fissa, not dropped as a second quota energia.
const dayUnit = (description, amount, unitPrice, unit) => ({ ...line(description, amount, null, unitPrice), unit });
const dailyBill = buildCurrentBillEconomicAnalysis([
  { ...line("Quota per consumi", "20,48", "65", "0,315077"), unit: "kWh" },
  dayUnit("di cui spesa per la vendita di energia elettrica", "17,37", "0,267231", "€/kWh"),
  dayUnit("di cui spesa per la rete e gli oneri generali di sistema", "3,11", "0,047846", "€/kWh"),
  { ...line("Quota fissa e Quota potenza", "21,86", "27", "0,80963"), unit: "giorni" },
  dayUnit("di cui spesa per la vendita di energia elettrica", "13,00", "0,481481", "€/giorno"),
  dayUnit("di cui spesa per la rete e gli oneri generali di sistema", "8,86", "0,328148", "€/giorno"),
  { ...line("Quota potenza", "5,33", "3,0", "0,065802"), unit: "kW" },
  dayUnit("di cui spesa per la rete e gli oneri generali di sistema", "5,33", "0,065802", "€/kW/giorno"),
  line("Altre partite - Costo Pratica", "50,00"), line("Altre partite - Deposito cauzionale", "19,00"), line("Accise e IVA", "11,40"),
  line("Imposte erariali", "1,48", null, null, "ACCISE"), line("IVA vendite 10%", "9,92", null, null, "IVA"),
  line("Componente ASOS quota per consumi", "2,05", null, null, "ASOS"), line("Componente ASOS quota fissa", "7,13", null, null, "ASOS"), line("Componente ARIM quota per consumi", "0,11", null, null, "ARIM"),
], "128,07");
assert.equal(dailyBill.totals.reconstructedCurrentSupplyTotal, 128.07);
assert.ok(dailyBill.components.some((item) => item.accountingRole === "ATOMIC" && /quota fissa/.test(item.description) && item.amount === "1,73"), "transport of the quota fissa");
console.log("BPOWER_BE_SMART_BILL=PASS");
