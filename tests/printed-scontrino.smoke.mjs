import assert from "node:assert/strict";
import { printedScontrinoLines, withPrintedScontrino, readingHasScontrino } from "../app/lib/ingestion/printed-scontrino.ts";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11, "cazzo cazzo, quante volte dobbiamo fissare le regole. leggere lo scontrino della bolletta e le condizioni
// applicate che sono riportate, se esiste leggere il dettaglio"): the scontrino is read from the PDF text without the AI.
// Synthetic texts shaped like the two layouts seen (Duferco business, Loomen PMI); no customer data.
const duferco = `Potenza Impegnata: 22,00 kW\nQuantità Prezzo Medio Importi\nQuota Consumi\n741,0 kWh 0,239636  €/kWh 177,57 €\ndi cui spesa per vendita energia\n0,190742 €/kWh\n141,34 €\ndi cui spese per la rete e gli oneri generali di sistema\n0,048893 €/kWh\n36,23 €\nQuota Fissa\n1 mese 29,740000  €/PdP 29,74 €\ndi cui spesa per vendita energia\n26,000000 €/PdP\n26,00 €\ndi cui spese per la rete e gli oneri generali di sistema\n3,740000 €/PdP\n3,74 €\nQuota Potenza\n13,4 kW per 1 mese 4,266418  €/kW 57,17 €\ndi cui spese per la rete e gli oneri generali di sistema\n4,266418 €/kW\n57,17 €\nIl prezzo medio rappresenta un valore medio di sintesi.\nAccise e IVA 69,48 €\nTOTALE BOLLETTA 333,96 €\nTOTALE DA PAGARE 333,96 €`;
const loomen = `SCONTRINO DELL'ENERGIA\nQuantità Prezzo medio Importi\nQuota per consumi\n2.642 kWh x 0,301919 €/kWh + 797,67 €\ndi cui spesa per la vendita di energia elettrica 0,253013 €/kWh + 668,46 €\ndi cui spesa per la rete e gli oneri generali di sistema 0,048906 €/kWh + 129,21 €\nQuota fissa e Quota potenza\n1 mese x 30,000000 €/mese + 30,00 €\ndi cui spesa per la vendita di energia elettrica 25,000000 €/mese + 25,00 €\ndi cui spesa per la rete e gli oneri generali di sistema 5,000000 €/mese + 5,00 €\n20 kW per 1 mese x 2,000000 €/kW/mese + 40,00 €\ndi cui spesa per la rete e gli oneri generali di sistema 2,000000 €/kW/mese + 40,00 €\nAccise e IVA + 199,00 €\nTotale bolletta = 1.066,67 €`;

const d = printedScontrinoLines(duferco);
assert.deepEqual(d.map((line) => [line.code, line.description, line.amount]), [
  ["OTHER_CHARGE", "Quota Consumi", "177,57 €"],
  ["OTHER_CHARGE", "Quota Consumi - di cui spesa per vendita energia", "141,34 €"],
  ["OTHER_CHARGE", "Quota Consumi - di cui spese per la rete e gli oneri generali di sistema", "36,23 €"],
  ["OTHER_CHARGE", "Quota Fissa", "29,74 €"],
  ["OTHER_CHARGE", "Quota Fissa - di cui spesa per vendita energia", "26,00 €"],
  ["OTHER_CHARGE", "Quota Fissa - di cui spese per la rete e gli oneri generali di sistema", "3,74 €"],
  ["OTHER_CHARGE", "Quota Potenza", "57,17 €"],
  ["OTHER_CHARGE", "Quota Potenza - di cui spese per la rete e gli oneri generali di sistema", "57,17 €"],
  ["TAX_SUBTOTAL", "Accise e IVA", "69,48 €"],
  ["BILL_TOTAL", "TOTALE BOLLETTA", "333,96 €"],
]);
const l = printedScontrinoLines(loomen);
assert.deepEqual(l.map((line) => [line.description, line.amount]), [
  ["Quota per consumi", "797,67 €"],
  ["Quota per consumi - di cui spesa per la vendita di energia elettrica", "668,46 €"],
  ["Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "129,21 €"],
  ["Quota fissa", "30,00 €"],
  ["Quota fissa - di cui spesa per la vendita di energia elettrica", "25,00 €"],
  ["Quota fissa - di cui spesa per la rete e gli oneri generali di sistema", "5,00 €"],
  ["Quota potenza", "40,00 €"],
  ["Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "40,00 €"],
  ["Accise e IVA", "199,00 €"],
  ["Totale bolletta", "1.066,67 €"],
]);
assert.equal(l[1].unitPrice, "0,253013");
assert.equal(printedScontrinoLines("Fattura di dettaglio\nEnergia F1 0,12 €/kWh 10,00 €").length, 0, "no scontrino, nothing invented");

// The bill side is complete from the scontrino alone: vendita 668,46 + 25,00, rete e oneri 129,21 + 5,00 + 40,00, taxes 199.
const analysis = buildCurrentBillEconomicAnalysis(l, "1.066,67");
assert.equal(analysis.totals.reconciliationStatus, "RECONCILED");
assert.deepEqual(analysis.totals.printedSummary, { seller: 693.46, networkAndSystem: 174.21, taxes: 199 });
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 700, analysis, domestic: false, validUntil: null });
assert.equal(receipt.status, "COMPLETE");
assert.equal(receipt.rows.find((row) => row.key === "ENERGY").current, 693.46);

// A reading without the scontrino gets it; a reading that has it is left alone.
const base = { economicChargeLines: [{ code: "BILL_TOTAL", description: "Totale bolletta", amount: "1.066,67 €", quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND" }] };
const completed = withPrintedScontrino(base, loomen);
assert.equal(readingHasScontrino(completed), true);
assert.equal(completed.economicChargeLines.filter((line) => line.code === "BILL_TOTAL").length, 1, "no second total");
assert.equal(withPrintedScontrino(completed, duferco), completed);
console.log("PRINTED_SCONTRINO=PASS");
