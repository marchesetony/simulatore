import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11) sent the ARERA guide to the electricity bill: the "scontrino dell'energia" lists Quota consumi and Quota fissa
// (each with "spesa per la vendita" and "spesa per la rete e per gli oneri generali di sistema"), Ricalcoli, Altre partite
// (deposito cauzionale, interessi di mora, indennizzi), Bonus sociale, Importi collegati all'offerta, Restituzione crediti,
// Importi relativi a bollette precedenti, Totale imposte e iva, Totale bolletta; then Servizi e prodotti aggiuntivi, Canone TV,
// Credito rimanente, Importi che saranno addebitati nella prossima bolletta, Totale da pagare. Synthetic amounts.
const line = (description, amount, unit = null) => ({ code: null, description, amount, quantity: null, unitPrice: null, unit, period: null });
const rows = [
  line("Quota consumi", "100,00", "kWh"),
  line("Quota consumi - di cui spesa per la vendita di energia elettrica", "70,00", "€/kWh"),
  line("Quota consumi - di cui spesa per la rete e per gli oneri generali di sistema", "30,00", "€/kWh"),
  line("Quota fissa", "40,00"),
  line("Quota fissa - di cui spesa per la vendita di energia elettrica", "10,00", "€/mese"),
  line("Quota fissa - di cui spesa per la rete e per gli oneri generali di sistema", "30,00", "€/mese"),
  line("Importi collegati all'offerta", "5,00"),
  line("Altre partite - Interessi di mora", "2,00"),
  line("Bonus sociale", "-10,00"),
  line("Restituzione crediti", "-3,00"),
  line("Importi relativi a bollette precedenti", "4,00"),
  line("Totale imposte e iva", "20,00"),
  line("Totale bolletta", "158,00"),
  line("Canone di abbonamento alla televisione", "9,00"),
  line("Importi che saranno addebitati nella prossima bolletta", "-3,00"),
  line("Totale da pagare", "164,00"),
];
const analysis = buildCurrentBillEconomicAnalysis(rows, "158,00");
assert.deepEqual(analysis.totals.printedSummary, { seller: 85, networkAndSystem: 60, taxes: 20 }, "scontrino as printed, importi collegati in vendita");
assert.equal(analysis.totals.reconciliationStatus, "RECONCILED", "lines add up to the totale bolletta");
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 70, analysis, domestic: true, validUntil: null, offerComponents: [] });
assert.equal(receipt.rows.find((row) => row.key === "ENERGY").current, 85, "quota consumi + quota fissa vendita + importi collegati");
assert.equal(receipt.rows.find((row) => row.key === "TAXES").current, 20);
const excluded = receipt.excluded.map((item) => item.label);
assert.ok(!excluded.some((label) => /prossima bolletta/i.test(label)), "carried-over amounts are not money of this bill");
assert.ok(excluded.some((label) => /mora/i.test(label)) && excluded.some((label) => /Restituzione/i.test(label)), "altre partite shown apart");
console.log("BILL_ARERA_SCONTRINO_ITEMS=PASS");
