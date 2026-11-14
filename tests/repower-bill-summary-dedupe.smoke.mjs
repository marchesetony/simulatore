import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (27/10) sent the real Repower bill (Laving srl, settembre 2026, 37.493 kWh, BT altri usi 85 kW) after our receipt
// showed 19.446 EUR of energy and 205,03 EUR of reactive energy. The bill prints the same money several times (quadro
// sintetico, "di cui", section "TOTALE", IMPOSTE/ONERI summary tables) plus "Conguaglio dei mesi precedenti" for August.
// These are the lines a full reading returns; the analysis must land on the bill's own sums.
const S = "dal 01/09/2026 al 30/09/2026";
const A = "dal 01/08/2026 al 31/08/2026";
const line = (description, amount, quantity = null, unitPrice = null, code = null, period = null) => ({ code, description, amount, quantity, unitPrice, unit: null, period });
const lines = [
  // Scontrino dell'energia (quadro sintetico)
  line("Quota energia", "11.332,25 €", "37.493 kWh", "0,302250"),
  line("di cui spesa per la vendita di energia elettrica", "9.499,63 €", null, "0,253371"),
  line("di cui spesa per la rete e gli oneri generali di sistema", "1.832,62 €", null, "0,048879"),
  line("energia reattiva prelevata oltre 33% di energia attiva prelevata", "63,41 €", "5.828 kVARh", "1,088023"),
  line("Quota fissa", "15,74 €", "1 mese", "15,74"),
  line("di cui spesa per la vendita di energia elettrica (quota fissa)", "12,00 €", "1 mese", "12,00"),
  line("di cui spesa per la rete e gli oneri generali di sistema (quota fissa)", "3,74 €", "1 mese", "3,74"),
  line("Quota potenza", "647,66 €"),
  line("di cui spesa per la rete e gli oneri generali di sistema (quota potenza)", "647,66 €", "151,80 kW", "4,266535"),
  line("Ricalcoli", "34,44 €", null, null, "RICALCOLI"),
  line("Accise e IVA", "3.234,20 €", null, null, "TAX_SUBTOTAL"),
  line("Totale bolletta", "15.327,70 €", null, null, "BILL_TOTAL"),
  // Box dell'offerta
  line("Totale spesa dovuta per l'offerta nel periodo", "9.511,63 €"),
  // IMPOSTE / ONERI GENERALI summary tables
  line("iva 22%", "2.764,01 €", "12.563,69", "22", "VAT"),
  line("Imposta Erariale", "468,66 €", "37.493", "0,012500", "EXCISE"),
  line("Ricalcoli accise Imposta Erariale", "1,53 €", "122", "0,012500", "EXCISE"),
  line("ASOS quota fissa", "1,08 €", null, null, "ASOS"),
  line("ASOS quota energia", "1.198,98 €", null, null, "ASOS"),
  line("ASOS quota potenza", "187,43 €", null, null, "ASOS"),
  line("ARIM quota fissa", "0,25 €", null, null, "ARIM"),
  line("ARIM quota energia", "60,70 €", null, null, "ARIM"),
  line("ARIM quota potenza", "43,67 €", null, null, "ARIM"),
  // Elementi di dettaglio: vendita
  line("Corrispettivo di commercializzazione", "12,00 €", "1 mese", "12,000000", "PCV", S),
  line("F0 - energia (monoraria)", "7.747,52 €", "37.493 kWh", "0,206639", "ENERGY_PRICE_F0", S),
  line("Corrispettivo servizio di vendita", "412,42 €", "41.242 kWh", "0,010000", "SPREAD", S),
  line("Oneri di dispacciamento", "433,09 €", "37.493 kWh", "0,011551", "DISPATCHING", S),
  line("Perdite di rete", "774,75 €", null, null, "NETWORK_LOSS_CHARGE", S),
  line("Corrispettivo capacità fuori picco", "131,85 €", "37.493 kWh", "0,003517", "CAPACITY_CHARGE_OFF_PEAK", S),
  line("F0 - energia (monoraria)", "7.670,50 €", "44.884 kWh", "0,170896", "ENERGY_PRICE_F0", A),
  line("F0 - energia (monoraria)", "-7.654,23 €", "-44.762 kWh", "0,170998", "ENERGY_PRICE_F0", A),
  line("Corrispettivo servizio di vendita", "493,72 €", "49.372 kWh", "0,010000", "SPREAD", A),
  line("Corrispettivo servizio di vendita", "-492,38 €", "-49.238 kWh", "0,010000", "SPREAD", A),
  line("Oneri di dispacciamento", "518,46 €", "44.884 kWh", "0,011551", "DISPATCHING", A),
  line("Oneri di dispacciamento", "-517,05 €", "-44.762 kWh", "0,011551", "DISPATCHING", A),
  line("Perdite di rete", "767,05 €", null, null, "NETWORK_LOSS_CHARGE", A),
  line("Perdite di rete", "-765,42 €", null, null, "NETWORK_LOSS_CHARGE", A),
  line("Corrispettivo capacità fuori picco", "151,33 €", "43.032 kWh", "0,003517", "CAPACITY_CHARGE_OFF_PEAK", A),
  line("Corrispettivo capacità fuori picco", "-150,90 €", "-42.910 kWh", "0,003517", "CAPACITY_CHARGE_OFF_PEAK", A),
  line("TOTALE", "9.532,71 €"),
  // Rete
  line("Corrispettivo distribuzione, misura e trasporto (quota fissa)", "2,41 €", "1 mese", "2,410000", null, S),
  line("Corrispettivo distribuzione, misura e trasporto (quota energia)", "577,02 €", "37.493 kWh", "0,015390", null, S),
  line("Corrispettivo distribuzione, misura e trasporto (quota potenza)", "416,56 €", "151,80 kW", "2,744142", null, S),
  line("Corrispettivo distribuzione, misura e trasporto (quota energia)", "690,76 €", "44.884 kWh", "0,015390", null, A),
  line("Corrispettivo distribuzione, misura e trasporto (quota energia)", "-688,88 €", "-44.762 kWh", "0,015390", null, A),
  line("TOTALE", "997,87 €"),
  // Oneri
  line("Componente ASOS quota fissa", "1,08 €", "1 mese", "1,082700", "ASOS", S),
  line("Componente ARIM quota fissa", "0,25 €", "1 mese", "0,252300", "ARIM", S),
  line("Componente ASOS quota energia", "1.195,09 €", "37.493 kWh", "0,031875", "ASOS", S),
  line("Componente ARIM quota energia", "60,51 €", "37.493 kWh", "0,001614", "ARIM", S),
  line("Componente ASOS quota potenza", "187,43 €", "151,80 kW", "1,234700", "ASOS", S),
  line("Componente ARIM quota potenza", "43,67 €", "151,80 kW", "0,287700", "ARIM", S),
  line("Componente ASOS quota energia", "1.430,68 €", "44.884 kWh", "0,031875", "ASOS", A),
  line("Componente ASOS quota energia", "-1.426,79 €", "-44.762 kWh", "0,031875", "ASOS", A),
  line("Componente ARIM quota energia", "72,44 €", "44.884 kWh", "0,001614", "ARIM", A),
  line("Componente ARIM quota energia", "-72,25 €", "-44.762 kWh", "0,001614", "ARIM", A),
  line("TOTALE", "1.492,11 €"),
  // Energia reattiva
  line("Energia reattiva F1 - oltre 33% di energia attiva", "50,70 €", "4.660 kVARh", "0,010880", null, S),
  line("Energia reattiva F2 - oltre 33% di energia attiva", "12,71 €", "1.168 kVARh", "0,010880", null, S),
  line("Energia reattiva F2 - oltre 33% di energia attiva", "14,54 €", "1.336 kVARh", "0,010880", null, A),
  line("Energia reattiva F2 - oltre 33% di energia attiva", "-7,14 €", "-656 kVARh", "0,010880", null, A),
  line("TOTALE", "70,81 €"),
  // Imposte (dettaglio)
  line("Imposta Erariale entro 200.000 kWh/mese", "468,66 €", "37.493 kWh", "0,012500", "EXCISE", S),
  line("Imposta Erariale entro 200.000 kWh/mese", "561,05 €", "44.884 kWh", "0,012500", "EXCISE", A),
  line("Imposta Erariale entro 200.000 kWh/mese", "-559,52 €", "-44.762 kWh", "0,012500", "EXCISE", A),
  line("TOTALE", "470,19 €"),
  line("Totale imponibile", "12.563,69 €"),
  line("iva 22%", "2.764,01 €", "12.563,69", "22", "VAT"),
];

const analysis = buildCurrentBillEconomicAnalysis(lines, "15.327,70", { billingPeriodStart: "2026-09-01" });
const t = analysis.totals;
assert.equal(t.reconciliationStatus, "RECONCILED", `lines add up to the bill total (difference ${t.reconciliationDifference})`);
// Spesa per la vendita: 9.499,63 (consumi) + 12,00 (quota fissa) = 9.511,63, as the Box dell'offerta says.
assert.equal(Math.round(((t.sellerEnergyTotal ?? 0) + (t.sellerCommercializationTotal ?? 0) + (t.sellerOtherTotal ?? 0)) * 100) / 100, 9511.63);
assert.equal(t.regulatedNetworkTotal, 995.99, "trasporto del mese, conguaglio di agosto escluso");
assert.equal(t.systemChargesTotal, 1488.03, "oneri di sistema del mese, conguaglio di agosto escluso");

const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 9000, analysis, domestic: false, validUntil: null });
const energy = receipt.rows.find((row) => row.key === "ENERGY");
assert.equal(energy.current, 9511.63, "materia energia letta in bolletta");
const reactive = receipt.rows.find((row) => row.key === "NETWORK").details.find((item) => item.key === "REACTIVE");
assert.equal(reactive.current, 63.41, "energia reattiva del mese (scontrino 63,41 EUR), non 205,03");
const recalculations = receipt.excluded.filter((item) => /ricalcol|conguagl/i.test(item.label));
assert.equal(recalculations.length, 1, "i conguagli di agosto sono una sola voce esclusa");
assert.equal(recalculations[0].amount, 34.44, "come lo scontrino: Ricalcoli 34,44 EUR");
console.log("REPOWER_BILL_SUMMARY_DEDUPE=PASS");
