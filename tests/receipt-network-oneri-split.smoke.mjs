import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11, "le quote fisse e le quote potenza credo che li conteggi due volte nella simulazione. verifica"): the bill read
// only the quadro sintetico "di cui spese per la rete e gli oneri generali di sistema" (36,23 / 3,74 / 57,17 EUR) and no oneri
// line. The receipt showed all 97,14 EUR as transport, "46,75 € in più di ARERA", with the oneri column empty, while the
// simulation counted transport 50,39 and oneri 46,53 once each. The printed amounts are now split into the ARERA oneri and
// transport, quota by quota; nothing is counted twice. Synthetic lines, no customer data.
const line = (description, amount, unit = null, code = null) => ({ code, description, amount, quantity: null, unitPrice: null, unit, period: null });
const rows = [
  line("Quota Consumi", "177,57 €", "kWh"),
  line("Quota Consumi - di cui spesa per vendita energia", "141,34 €", "€/kWh"),
  line("Quota Consumi - di cui spese per la rete e gli oneri generali di sistema", "36,23 €", "€/kWh", "NETWORK_SYSTEM"),
  line("Quota Fissa", "29,74 €"),
  line("Quota Fissa - di cui spesa per vendita energia", "26,00 €", "€/mese"),
  line("Quota Fissa - di cui spese per la rete e gli oneri generali di sistema", "3,74 €", "€/mese", "NETWORK_SYSTEM"),
  line("Quota Potenza", "57,17 €", "kW"),
  line("Quota Potenza - di cui spese per la rete e gli oneri generali di sistema", "57,17 €", "€/kW", "NETWORK_SYSTEM"),
  line("Accise e IVA", "69,48 €", null, "TAX_SUBTOTAL"),
  line("TOTALE BOLLETTA", "333,96 €", null, "BILL_TOTAL"),
];
const regulated = (category, componentCode, amount) => ({ category, sign: "CHARGE", label: componentCode, amount: { amount }, formulaInputs: { componentCode } });
const offerComponents = [
  regulated("REGULATED_ENERGY", "NETWORK_ENERGY", 11.39), regulated("REGULATED_FIXED", "NETWORK_FIXED", 2.23), regulated("REGULATED_POWER", "NETWORK_POWER", 36.77),
  regulated("REGULATED_ENERGY", "ASOS", 24.8), regulated("REGULATED_FIXED", "ASOS", 1.33), regulated("REGULATED_POWER", "ASOS", 20.4),
];
const analysis = buildCurrentBillEconomicAnalysis(rows, "333,96");
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 150, analysis, domestic: false, validUntil: null, offerComponents });
const row = (key) => receipt.rows.find((item) => item.key === key);
assert.equal(row("SYSTEM").current, 46.53, "oneri: ARERA values, inside the printed rete e oneri");
assert.equal(row("NETWORK").current, 50.61, "transport: 97,14 printed less 46,53 oneri");
assert.equal(Math.round((row("NETWORK").current + row("SYSTEM").current) * 100) / 100, 97.14, "total as printed");
assert.deepEqual(row("NETWORK").details.map((d) => [d.current, d.offer]), [[11.43, 11.39], [2.41, 2.23], [36.77, 36.77]], "transport per quota, each counted once");
assert.deepEqual(row("SYSTEM").details.map((d) => [d.current, d.offer]), [[24.8, 24.8], [1.33, 1.33], [20.4, 20.4]], "oneri per quota, each counted once");
console.log("RECEIPT_NETWORK_ONERI_SPLIT=PASS");
