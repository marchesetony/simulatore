import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11): "la bolletta si compone di uno scontrino che riassume tutti i costi addebitati [...] devi inserire nel calcolo
// principalmente le voci dello scontrino energetico prevista dal regolamento commerciale secondo le delibere ARERA. non
// inventare nulla attenersi all'originale". Here the detail lines were read wrong (energy 120,00 instead of 141,34, an
// excise line only): the bill column must still show the quadro sintetico as printed. Synthetic lines, no customer data.
const line = (description, amount, unit = null, quantity = null, code = null) => ({ code, description, amount, quantity, unitPrice: null, unit, period: null });
const rows = [
  line("Quota Consumi", "177,57 €", "kWh", "741"),
  line("Quota Consumi - di cui spesa per vendita energia", "141,34 €", "€/kWh"),
  line("Quota Consumi - di cui spese per la rete e gli oneri generali di sistema", "36,23 €", "€/kWh"),
  line("Quota Fissa", "29,74 €"),
  line("Quota Fissa - di cui spesa per vendita energia", "26,00 €", "€/PdP"),
  line("Quota Fissa - di cui spese per la rete e gli oneri generali di sistema", "3,74 €", "€/PdP"),
  line("Quota Potenza", "57,17 €", "kW", "13,4"),
  line("Quota Potenza - di cui spese per la rete e gli oneri generali di sistema", "57,17 €", "€/kW"),
  line("Accise e IVA", "69,48 €", null, null, "TAX_SUBTOTAL"),
  line("TOTALE BOLLETTA", "333,96 €", null, null, "BILL_TOTAL"),
  line("Energia F1 (dettaglio)", "120,00", "€/kWh", "741", "ENERGY_PRICE"),
  line("ASOS quota per consumi", "23,62", "€/kWh", "741", "ASOS"),
  line("ARIM quota per consumi", "1,20", "€/kWh", "741", "ARIM"),
  line("Addizionale Erariale", "9,26 €", "€/kWh", "741 kWh", "ACCISE"),
];
const analysis = buildCurrentBillEconomicAnalysis(rows, "333,96");
assert.deepEqual(analysis.totals.printedSummary, { seller: 167.34, networkAndSystem: 97.14, taxes: 69.48 });
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 150, analysis, domestic: false, validUntil: null, offerComponents: [] });
const current = (key) => receipt.rows.find((row) => row.key === key)?.current ?? null;
assert.equal(current("ENERGY"), 167.34, "spesa per la vendita as printed");
assert.equal(Math.round((current("NETWORK") + current("SYSTEM")) * 100) / 100, 97.14, "rete e oneri as printed");
assert.equal(current("TAXES"), 69.48, "Accise e IVA as printed");
console.log("RECEIPT_PRINTED_SUMMARY_FIRST=PASS");
