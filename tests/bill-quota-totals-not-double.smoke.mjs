import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (29/10, bolletta Casa Protetta, domestico residente 3 kW, 447 kWh, totale 180,77 EUR di cui canone 9,00): "stai
// inserendo dei calcoli che già sono presenti in altre voci e li stai conteggiando due volte, rivedi tutto". The reading
// prefixed each line with its block ("Quota fissa e Quota potenza - Quota fissa"): the quota totals 14,92 and 5,93 were kept
// as charges, the transport 6,58 (quota per consumi) and 1,92 (quota fissa) were dropped to make the sum match, and the
// receipt showed 8,50 EUR of transport "addebitati in meno" with 1,34 EUR of VAT on it. Bolletta 2.0: total = di cui vendita
// + di cui rete e oneri.
const line = (description, amount, unit = null, quantity = null, code = null) => ({ code, description, amount, quantity, unitPrice: null, unit, period: null });
const block = (withFixedNetwork) => [
  line("Quota per consumi", "141,95", "kWh", "447"),
  line("Quota per consumi - di cui spesa per la vendita di energia elettrica", "120,55", "€/kWh"),
  line("Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "21,40", "€/kWh"),
  line("Quota fissa e Quota potenza - Quota fissa", "14,92", "giorni", "30"),
  line("Quota fissa e Quota potenza - di cui spesa per la vendita di energia elettrica", "13,00", "€/giorno"),
  ...(withFixedNetwork ? [line("Quota fissa e Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "1,92", null)] : []),
  line("Quota potenza", "5,93", "kW", "3,0", "NETWORK_POWER"),
  line("Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "5,93", "€/kW/giorno"),
  line("Bonus sociale", "-16,80", null, null, "BONUS"),
  line("Canone di abbonamento alla televisione per uso privato (Settembre 2026)", "9,00", null, null, "CANONE_RAI"),
  line("Accise e IVA", "25,77", null, null, "TAX_SUBTOTAL"),
  line("Imposte erariali", "10,15", null, null, "ACCISE"), line("IVA vendite 10%", "15,62", null, null, "IVA"),
  line("Componente ASOS quota per consumi", "13,50", null, null, "ASOS"), line("Componente ARIM quota per consumi", "1,32", null, null, "ARIM"),
  line("Totale bolletta", "180,77", null, null, "BILL_TOTAL"),
];
for (const withFixedNetwork of [true, false]) {
  const bill = buildCurrentBillEconomicAnalysis(block(withFixedNetwork), "180,77");
  assert.equal(bill.totals.reconstructedCurrentSupplyTotal, 171.77, `supply total without TV licence (${withFixedNetwork})`);
  assert.equal(bill.totals.regulatedNetworkTotal, 14.43, "transport 5,93 + 6,58 + 1,92");
  assert.equal(bill.totals.systemChargesTotal, 14.82);
  assert.equal(bill.totals.sellerEnergyTotal + (bill.totals.sellerCommercializationTotal ?? 0), 133.55);
  const live = bill.components.filter((item) => item.includedInReconciliation);
  assert.ok(!live.some((item) => /^(Quota per consumi|Quota fissa e Quota potenza - Quota fissa|Quota potenza)$/.test(item.description)), "no quota total counted as a charge");
  const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 133.55, analysis: bill, domestic: true, validUntil: null, offerComponents: [] });
  assert.equal(receipt.rows.find((row) => row.key === "NETWORK").current, 14.43);
  assert.deepEqual(receipt.excluded.map((item) => item.amount).sort((a, b) => a - b), [-16.8, 9], "only bonus and TV licence left out");
}
console.log("BILL_QUOTA_TOTALS_NOT_DOUBLE=PASS");

// Tony (29/10, delibera 386/2025/R/com): a household CTE's spread covers sbilanciamento and commercializzazione and is
// gross of losses. The bill's effective spread is its seller consumption quota less PUN x 1,10 and CDISPD, per kWh:
// 120,55 - 94,46 x 1,10 - 6,74 on 447 kWh = 0,022 EUR/kWh, against 0,03 in the CTE.
const { effectiveBillSpread } = await import("../app/lib/quote/receipt.ts");
const spreadComponents = [
  { category: "ENERGY", sign: "CHARGE", formulaId: "EE_PUN_MWH_TO_KWH_PLUS_SPREAD", amount: { amount: 107.87 }, formulaInputs: { punEurPerMwh: 211.3199, quantityKwh: 447 } },
  { category: "VARIABLE_FEE", sign: "CHARGE", formulaId: "CTE_PASS_THROUGH_LOSSES_ON_ENERGY", amount: { amount: 9.45 }, formulaInputs: { kind: "LOSSES", lossFactor: "0.1" } },
  { category: "REGULATED_ENERGY", sign: "CHARGE", label: "Dispacciamento e mercato della capacità (CDISPD)", formulaId: "REGULATED_DOMESTIC_CDISPD_RATE_TIMES_KWH", amount: { amount: 6.74 }, formulaInputs: {} },
];
const effective = effectiveBillSpread({ quotas: [{ key: "CONSUMPTION", currentSeller: 120.55 }] }, spreadComponents);
assert.ok(Math.abs(effective - 0.02215) < 0.00005, `effective spread ${effective}`);
assert.equal(effectiveBillSpread({ quotas: [{ key: "CONSUMPTION", currentSeller: 120.55 }] }, spreadComponents.slice(0, 2)), null, "no CDISPD, no effective spread");
console.log("EFFECTIVE_BILL_SPREAD=PASS");
