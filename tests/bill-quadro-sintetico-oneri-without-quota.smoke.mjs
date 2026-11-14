import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (30/10, bolletta domestica 6 kW, 323,37 kWh, totale 155,72 EUR + canone 9,00: "non capisco come stiamo leggendo le
// bollette. a cazzo, mancano i dati"). The quadro sintetico prints "QUOTA PER I CONSUMI" 114,10 = vendita 87,33 + rete e
// oneri 26,77, "QUOTA FISSA E QUOTA POTENZA" 8,27 = 6,35 + 1,92, "Quota potenza 6" 11,86, and the oneri page lists ASOS 10,18
// and ARIM 0,53 with no quota. The receipt showed no vendita, no rete and no taxes for the bill.
const line = (description, amount, unit = null, quantity = null, code = null) => ({ code, description, amount, quantity, unitPrice: null, unit, period: null });
const lines = (prefix) => [
  line("QUOTA PER I CONSUMI", "114,10", "€/kWh", "323,37"),
  line(`${prefix ? "Quota per i consumi - " : ""}di cui spesa per vendita energia elettrica`, "87,33", "€/kWh"),
  line(`${prefix ? "Quota per i consumi - " : ""}di cui spesa per la rete e oneri generali di sistema`, "26,77", "€/kWh"),
  line("QUOTA FISSA E QUOTA POTENZA", "8,27", "€/mese", "1"),
  line(`${prefix ? "Quota fissa e quota potenza - " : ""}di cui spesa per vendita energia elettrica`, "6,35", "€/mese"),
  line(`${prefix ? "Quota fissa e quota potenza - " : ""}di cui spesa per la rete e oneri generali di sistema`, "1,92", "€/mese"),
  line("Quota potenza 6", "11,86", "€/kW/mese", "6"),
  line(`${prefix ? "Quota potenza - " : ""}di cui spesa per la rete e oneri generali di sistema`, "11,86", "€/kW/mese"),
  line("Accise e IVA", "21,49", null, null, "TAX_SUBTOTAL"),
  line("Componente ASOS a copertura dei costi per il sostegno delle fonti rinnovabili e da cogenerazione", "10,18", null, null, "ASOS"),
  line("Componente ARIM a copertura di altri oneri relativi ad attività di interesse generale", "0,53", null, null, "ARIM"),
  line("Accisa sull'energia elettrica", "7,33", "€/kWh", "323", "ACCISE"),
  line("Aliquota ridotta 10%", "14,16", null, null, "IVA"),
  line("Canone di abbonamento alla televisione per uso privato 10/2026", "9,00", null, null, "CANONE_RAI"),
  line("Totale bolletta", "155,72", null, null, "BILL_TOTAL"),
];
for (const prefix of [false, true]) {
  const bill = buildCurrentBillEconomicAnalysis(lines(prefix), "155,72");
  const t = bill.totals;
  assert.equal(t.reconciliationDifference, 0, `reconciled (${prefix})`);
  assert.equal(Math.round(((t.sellerEnergyTotal ?? 0) + (t.sellerCommercializationTotal ?? 0)) * 100) / 100, 93.68, "vendita 87,33 + 6,35");
  assert.equal(t.regulatedNetworkTotal, 29.84, "rete e oneri 40,55 less oneri 10,71");
  assert.equal(t.systemChargesTotal, 10.71);
  assert.equal(t.taxTotal, 21.49);
  const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 93.68, analysis: bill, domestic: true, validUntil: null, offerComponents: [] });
  assert.equal(receipt.status, "COMPLETE");
  assert.deepEqual(receipt.rows.map((row) => row.current), [93.68, 29.84, 10.71, 21.49]);
}
console.log("BILL_QUADRO_SINTETICO_ONERI_WITHOUT_QUOTA=PASS");
