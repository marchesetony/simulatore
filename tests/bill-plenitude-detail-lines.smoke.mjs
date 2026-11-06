import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (30/10, bolletta Plenitude Trend Business Luce Base, 2324 kWh, totale 1.015,64 EUR: "credo che la lettura non è stata
// fatta. cazzo come devo fare a farti comprendere che devi leggere e verificare"). The receipt showed vendita 72,92 against
// 642,18 on the bill: Corrispettivo Luce Index, Contributo al consumo, the TIDE/TIS articles, delibera ARG/elt 98/11 and the
// transport quota energia 35,77 were all left out as "partite escluse dal confronto".
const line = (description, amount, unit = "€/kWh", quantity = null, code = null, unitPrice = null) => ({ code, description, amount, quantity, unitPrice, unit, period: null });
const lines = [
  line("Commercializzazione e vendita - parte fissa", "16,00", "€/pdp/mese", "1"),
  line("Articolo 15.2 TIS", "0,00", "€/pdp/mese", "1"),
  line("Corrispettivo Luce Index F1", "171,48", "€/kWh", "831"), line("Corrispettivo Luce Index F2", "135,64", "€/kWh", "596"), line("Corrispettivo Luce Index F3", "176,73", "€/kWh", "897"),
  line("Perdite su Corrispettivo Luce Index F1", "17,13", "€/kWh", "83"), line("Perdite su Corrispettivo Luce Index F2", "13,65", "€/kWh", "60"), line("Perdite su Corrispettivo Luce Index F3", "17,73", "€/kWh", "90"),
  line("Contributo al consumo F1", "19,11", "€/kWh", "831"), line("Contributo al consumo F2", "13,71", "€/kWh", "596"), line("Contributo al consumo F3", "20,63", "€/kWh", "897"),
  line("Perdite su contributo al consumo F1", "1,91", "€/kWh", "83"), line("Perdite su contributo al consumo F2", "1,38", "€/kWh", "60"), line("Perdite su contributo al consumo F3", "2,07", "€/kWh", "90"),
  line("Articolo 25 bis TIS", "0,00", "€/kWh", "2324"), line("Perdite articolo 25 bis TIS", "0,00", "€/kWh", "232"),
  line("Articolo 14 delibera ARG/elt 98/11", "7,43", "€/kWh", "2324"), line("Perdite art. 14 delibera ARG/elt 98/11", "0,74", "€/kWh", "232"),
  line("Articolo 25.3 TIDE", "7,73", "€/kWh", "2324"), line("Perdite articolo 25.3 TIDE", "0,77", "€/kWh", "232"),
  line("Articolo 25.8 TIDE", "5,26", "€/kWh", "2324"), line("Perdite articolo 25.8 TIDE", "0,53", "€/kWh", "232"),
  line("Articolo 25.7 TIDE", "-0,20", "€/kWh", "2324", null, "-0,00008400"), line("Perdite articolo 25.7 TIDE", "-0,02", "€/kWh", "232", null, "-0,00008400"),
  line("Articolo 25.4 TIDE", "7,07", "€/kWh", "2324"), line("Perdite articolo 25.4 TIDE", "0,71", "€/kWh", "232"),
  line("Articolo 25.5 TIDE", "1,52", "€/kWh", "2324", null, "0,00065200"), line("Perdite articolo 25.5 TIDE", "0,15", "€/kWh", "232", null, "0,00065200"),
  line("Articolo 25.6 TIDE", "3,02", "€/kWh", "2324"), line("Perdite articolo 25.6 TIDE", "0,30", "€/kWh", "232"),
  line("Spesa per la tariffa per l'uso della rete elettrica - Quota fissa", "2,41", "€/pdp/mese", "1", "NETWORK_FIXED"),
  line("Spesa per la tariffa per l'uso della rete elettrica - Quota potenza", "25,41", "€/kW/mese", "9,26", "NETWORK_POWER"),
  line("Energia Reattiva Prelevata F1", "2,33", "€/kVArh", "214"), line("Energia Reattiva Prelevata F2", "2,03", "€/kVArh", "187"), line("Energia Reattiva Immessa Capacitiva F3", "0,04", "€/kVArh", "4"),
  line("Spesa per la tariffa per l'uso della rete elettrica - Quota energia", "35,77", "€/kWh", "2324"),
  line("Spesa per gli oneri generali di sistema - Quota fissa", "0,01", "€/pdp/mese", "1"),
  line("Spesa per gli oneri generali di sistema - Quota potenza", "0,01", "€/kW/mese", "9,26"),
  line("Componente ASOS - Quota fissa", "1,08", "€/pdp/mese", "1", "ASOS"), line("Componente ASOS - Quota potenza", "11,43", "€/kW/mese", "9,26", "ASOS"), line("Componente ASOS - Quota energia", "74,08", "€/kWh", "2324", "ASOS"),
  line("Componente ARIM - Quota fissa", "0,25", "€/pdp/mese", "1", "ARIM"), line("Componente ARIM - Quota potenza", "2,66", "€/kW/mese", "9,26", "ARIM"), line("Componente ARIM - Quota energia", "3,75", "€/kWh", "2324", "ARIM"),
  line("Imposta erariale", "29,05", null, null, "ACCISE"), line("IVA 22%", "183,15", null, null, "IVA"),
  line("Totale bolletta", "1.015,64", null, null, "BILL_TOTAL"),
];
const bill = buildCurrentBillEconomicAnalysis(lines, "1.015,64");
const t = bill.totals;
const seller = Math.round(((t.sellerEnergyTotal ?? 0) + (t.sellerCommercializationTotal ?? 0) + (t.sellerOtherTotal ?? 0)) * 100) / 100;
assert.equal(seller, 642.18, "vendita as the bill's Totale 642,18");
assert.equal(t.regulatedNetworkTotal, 63.59, "transport 2,41 + 25,41 + 35,77 (reactive 4,40 apart)");
assert.equal(t.systemChargesTotal, 93.27);
assert.equal(t.reconciliationDifference, 0);
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 638.36, analysis: bill, domestic: false, validUntil: null, offerComponents: [] });
assert.equal(receipt.rows.find((row) => row.key === "ENERGY").current, 642.18);
assert.equal(receipt.rows.find((row) => row.key === "NETWORK").current, 67.99, "with reactive energy, as the bill's Totale 67,99");
assert.ok(!receipt.excluded.some((item) => /Index|Contributo|TIDE|TIS|98\/11|Quota energia/.test(item.label)), `left out: ${receipt.excluded.map((item) => item.label).join(", ")}`);
console.log("BILL_PLENITUDE_DETAIL_LINES=PASS");
