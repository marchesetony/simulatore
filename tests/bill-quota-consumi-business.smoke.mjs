import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11, bolletta business "Altri usi" 13,4 kW, 741 kWh, totale 333,96 EUR): "ma dove sono i dati con gli importi della
// bolletta". The receipt showed no spesa per la vendita and no taxes, and "Quota Consumi 177,57 €" among the excluded items.
// Three causes: "Quota Consumi" (without "per") was not known as a quota total; the Box dell'offerta "di cui spesa per la
// quota per consumi" was not known as a copy of the quadro sintetico; "Accise e IVA 69,48 €" was the only VAT printed and was
// dropped as a subtotal. With the taxes missing, the "di cui spesa per vendita energia" lines were dropped to match the total.
// Synthetic lines, same structure as that bill; no customer data.
const line = (description, amount, unit = null, quantity = null, code = null, unitPrice = null) => ({ code, description, amount, quantity, unitPrice, unit, period: null });
const bill = (withExcise) => [
  line("Totale spesa dovuta per l'Offerta", "167,34 €"),
  line("di cui spesa per la quota per consumi", "141,34 €"),
  line("di cui spesa per la quota fissa", "26,00 €"),
  line("Dispacciamento", "0.001750", "€/kWh", null, "DISPATCHING"),
  line("Quota Consumi", "177,57 €", "kWh", "741"),
  line("Quota Consumi - di cui spesa per vendita energia", "141,34 €", "€/kWh", null, null, "0,190742"),
  line("Quota Consumi - di cui spese per la rete e gli oneri generali di sistema", "36,23 €", "€/kWh", null, null, "0,048893"),
  line("Quota Fissa", "29,74 €"),
  line("Quota Fissa - di cui spesa per vendita energia", "26,00 €", "€/PdP"),
  line("Quota Fissa - di cui spese per la rete e gli oneri generali di sistema", "3,74 €", "€/PdP"),
  line("Quota Potenza", "57,17 €", "kW", "13,4"),
  line("Quota Potenza - di cui spese per la rete e gli oneri generali di sistema", "57,17 €", "€/kW"),
  line("Accise e IVA", "69,48 €", null, null, "TAX_SUBTOTAL"),
  line("TOTALE BOLLETTA", "333,96 €", null, null, "BILL_TOTAL"),
  line("Oneri - Quota per consumi - ARIM", "1,20", "€/kWh", "741", "ARIM", "0,001614"),
  line("Oneri - Quota per consumi - ASOS", "23,62", "€/kWh", "741", "ASOS", "0,031875"),
  line("Oneri - Quota fissa - ARIM", "0,25", "€/PdP", "1", "ARIM"),
  line("Oneri - Quota fissa - ASOS", "1,08", "€/PdP", "1", "ASOS"),
  line("Oneri - Quota potenza - ARIM", "3,86", "€/kW", "13.4", "ARIM"),
  line("Oneri - Quota potenza - ASOS", "16,54", "€/kW", "13.4", "ASOS"),
  ...(withExcise ? [line("Addizionale Erariale", "9,26 €", "€/kWh", "741 kWh", "ACCISE", "0,0125"), line("Totale Imposte", "9,26 €", null, null, "TAX_SUBTOTAL")] : []),
];
for (const withExcise of [true, false]) {
  const analysis = buildCurrentBillEconomicAnalysis(bill(withExcise), "333,96");
  assert.equal(analysis.totals.reconciliationStatus, "RECONCILED", `lines add up to the bill (${withExcise})`);
  assert.equal(analysis.totals.taxTotal, 69.48, "Accise e IVA as printed");
  assert.equal(analysis.totals.regulatedNetworkTotal, 50.59);
  assert.equal(analysis.totals.systemChargesTotal, 46.55);
  const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 150, analysis, domestic: false, validUntil: null, offerComponents: [] });
  assert.equal(receipt.rows.find((row) => row.key === "ENERGY").current, 167.34, "spesa per la vendita 141,34 + 26,00");
  assert.equal(receipt.rows.find((row) => row.key === "TAXES").current, 69.48);
  assert.deepEqual(receipt.excluded, [], "no quota total among the excluded items");
}
console.log("BILL_QUOTA_CONSUMI_BUSINESS=PASS");
