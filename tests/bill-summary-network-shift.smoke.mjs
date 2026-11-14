import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (31/10, bolletta BPower settembre 2026, 390 kWh, totale 168,42 EUR + canone 9,00): "quota energia, ... leggi male la
// bolletta" and "la bolletta che tu segni totale 181,62 non esiste". The sintetica prints rete e oneri 21,68 for the quota
// per consumi; its fattura di dettaglio charges transport 5,75 (= ARERA) and vendita 123,80. The receipt showed rete 22,53
// "3,00 EUR in più di ARERA" and a total of 181,62 (the bill without the bonus).
const line = (description, amount, unit = null, quantity = null, code = null) => ({ code, description, amount, quantity, unitPrice: null, unit, period: null });
const bill = buildCurrentBillEconomicAnalysis([
  line("Quota per consumi", "129,48", "kWh", "390"),
  line("Quota per consumi - di cui spesa per la vendita di energia elettrica", "107,80", "€/kWh"),
  line("Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "21,68", "€/kWh"),
  line("Quota fissa e Quota potenza - Quota fissa", "14,92", "mese", "1"),
  line("Quota fissa e Quota potenza - di cui spesa per la vendita di energia elettrica", "13,00", "€/mese"),
  line("Quota fissa e Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "1,92", "€/mese"),
  line("Quota potenza", "11,86", "kW", "6,0", "NETWORK_POWER"),
  line("Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "11,86", "€/kW/mese"),
  line("Bonus sociale", "-12,00", null, null, "BONUS"),
  line("Canone di abbonamento alla televisione per uso privato (Settembre 2026)", "9,00", null, null, "CANONE_RAI"),
  line("Accise e IVA", "24,16", null, null, "TAX_SUBTOTAL"),
  line("Imposte erariali", "8,85", null, null, "ACCISE"), line("IVA vendite 10%", "15,31", null, null, "IVA"),
  line("Componente ASOS quota per consumi", "12,29", null, null, "ASOS"), line("Componente ARIM quota per consumi", "0,64", null, null, "ARIM"),
  line("Totale bolletta", "168,42", null, null, "BILL_TOTAL"),
], "168,42");
const official = [
  { category: "REGULATED_ENERGY", sign: "CHARGE", label: "Trasporto quota energia", amount: { amount: 5.75 }, formulaInputs: { componentCode: "NETWORK_ENERGY" } },
  { category: "REGULATED_FIXED", sign: "CHARGE", label: "Trasporto quota fissa", amount: { amount: 1.92 }, formulaInputs: { componentCode: "NETWORK_FIXED" } },
  { category: "REGULATED_POWER", sign: "CHARGE", label: "Trasporto quota potenza", amount: { amount: 11.86 }, formulaInputs: { componentCode: "NETWORK_POWER" } },
  { category: "REGULATED_ENERGY", sign: "CHARGE", label: "ASOS", amount: { amount: 12.29 }, formulaInputs: { componentCode: "ASOS" } },
  { category: "REGULATED_ENERGY", sign: "CHARGE", label: "ARIM", amount: { amount: 0.64 }, formulaInputs: { componentCode: "ARIM" } },
];
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 123.80, analysis: bill, domestic: true, validUntil: null, offerComponents: official });
const row = (key) => receipt.rows.find((item) => item.key === key);
assert.equal(row("ENERGY").current, 123.8, "vendita as in the fattura di dettaglio");
assert.equal(row("NETWORK").current, 19.53, "rete as in the fattura di dettaglio (= ARERA)");
assert.equal(receipt.officialCheck.NETWORK.status, "VERIFIED", "no '3,00 EUR in più di ARERA' warning");
assert.equal(row("SYSTEM").current, 12.93);
assert.equal(row("BONUS").current, -12, "bonus on its own line");
assert.equal(row("BONUS").offer, -12, "the same bonus with the new offer");
assert.equal(row("TAXES").current, 24.16, "accise e IVA as printed");
assert.equal(receipt.currentTotal, 168.42, "the bill's own total");
assert.equal(receipt.savings, 0, "same supply cost: the bonus and the split move nothing");
assert.ok(!receipt.excluded.some((item) => /bonus/i.test(item.label)), "the bonus is no longer among the excluded items");
assert.match(row("ENERGY").details.find((item) => item.key === "ENERGY").label, /3,00 € che la pagina sintetica/);
const quotas = receipt.quotas.reduce((total, item) => total + (item.current ?? 0), 0);
assert.equal(Math.round(quotas * 100) / 100, 168.42, "the scontrino adds up to the bill's total");
console.log("BILL_SUMMARY_NETWORK_SHIFT=PASS");
