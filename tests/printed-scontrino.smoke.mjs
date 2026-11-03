import assert from "node:assert/strict";
import { printedScontrinoLines, withPrintedScontrino, readingHasScontrino } from "../app/lib/ingestion/printed-scontrino.ts";
import { buildCurrentBillEconomicAnalysis, classifyBillEconomicComponent } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";
import { offerScontrino } from "../app/lib/quote/offer-scontrino.ts";

// Tony (1/11, "cazzo cazzo, quante volte dobbiamo fissare le regole. leggere lo scontrino della bolletta e le condizioni
// applicate che sono riportate, se esiste leggere il dettaglio"): the scontrino is read from the PDF text without the AI.
// Synthetic texts shaped like the two layouts seen (Duferco business, Loomen PMI); no customer data.
const duferco = `Potenza Impegnata: 22,00 kW\nQuantità Prezzo Medio Importi\nQuota Consumi\n741,0 kWh 0,239636  €/kWh 177,57 €\ndi cui spesa per vendita energia\n0,190742 €/kWh\n141,34 €\ndi cui spese per la rete e gli oneri generali di sistema\n0,048893 €/kWh\n36,23 €\nQuota Fissa\n1 mese 29,740000  €/PdP 29,74 €\ndi cui spesa per vendita energia\n26,000000 €/PdP\n26,00 €\ndi cui spese per la rete e gli oneri generali di sistema\n3,740000 €/PdP\n3,74 €\nQuota Potenza\n13,4 kW per 1 mese 4,266418  €/kW 57,17 €\ndi cui spese per la rete e gli oneri generali di sistema\n4,266418 €/kW\n57,17 €\nIl prezzo medio rappresenta un valore medio di sintesi.\nAccise e IVA 69,48 €\nTOTALE BOLLETTA 333,96 €\nTOTALE DA PAGARE 333,96 €`;
const loomen = `SCONTRINO DELL'ENERGIA\nQuantità Prezzo medio Importi\nQuota per consumi\n2.642 kWh x 0,301919 €/kWh + 797,67 €\ndi cui spesa per la vendita di energia elettrica 0,253013 €/kWh + 668,46 €\ndi cui spesa per la rete e gli oneri generali di sistema 0,048906 €/kWh + 129,21 €\nQuota fissa e Quota potenza\n1 mese x 30,000000 €/mese + 30,00 €\ndi cui spesa per la vendita di energia elettrica 25,000000 €/mese + 25,00 €\ndi cui spesa per la rete e gli oneri generali di sistema 5,000000 €/mese + 5,00 €\n20 kW per 1 mese x 2,000000 €/kW/mese + 40,00 €\ndi cui spesa per la rete e gli oneri generali di sistema 2,000000 €/kW/mese + 40,00 €\nAccise e IVA + 199,00 €\nTotale bolletta = 1.066,67 €`;

// Tony (1/11, Loomen bill): the "rete e oneri" shares carry the code NETWORK_SYSTEM, so they are counted as rete e oneri and
// not as altre partite.
const d = printedScontrinoLines(duferco);
assert.deepEqual(d.map((line) => [line.code, line.description, line.amount]), [
  ["OTHER_CHARGE", "Quota Consumi", "177,57 €"],
  ["OTHER_CHARGE", "Quota Consumi - di cui spesa per vendita energia", "141,34 €"],
  ["NETWORK_SYSTEM", "Quota Consumi - di cui spese per la rete e gli oneri generali di sistema", "36,23 €"],
  ["OTHER_CHARGE", "Quota Fissa", "29,74 €"],
  ["OTHER_CHARGE", "Quota Fissa - di cui spesa per vendita energia", "26,00 €"],
  ["NETWORK_SYSTEM", "Quota Fissa - di cui spese per la rete e gli oneri generali di sistema", "3,74 €"],
  ["OTHER_CHARGE", "Quota Potenza", "57,17 €"],
  ["NETWORK_SYSTEM", "Quota Potenza - di cui spese per la rete e gli oneri generali di sistema", "57,17 €"],
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
// Tony (1/11, "bisogna trovare soluzione definitiva, affinchè sappia leggere qualsiasi bolletta"): the printed scontrino now
// replaces the AI's reading of the same block instead of leaving it, and applying it twice changes nothing.
assert.deepEqual(withPrintedScontrino(completed, loomen).economicChargeLines, completed.economicChargeLines);

// Loomen layout as in the PDF text layer: label, price and amount on separate rows, altre partite on two rows, the total's
// amount on the next row. Synthetic invoice numbers.
const multiRow = `Quota per consumi\n2.642 kWh x 0,301919 €/kWh\n+ 797,67 €\ndi cui spesa per la vendita di energia elettrica\n0,253013 €/kWh\n+ 668,46 €\ndi cui spesa per\nla rete e gli oneri generali di sistema\n0,048906 €/kWh\n+ 129,21 €\nQuota fissa\n1 mese\n17,310000 €/mese\n+ 17,31 €\ndi cui spesa per la vendita di energia elettrica\n13,500000 €/mese\n+ 13,50 €\ndi cui spesa per la rete e gli oneri generali di sistema\n3,810000 €/mese\n+ 3,81 €\n15,00 kW per 1 mese\n4,492667 €/kW/mese\n+ 67,39 €\ndi cui spesa per la rete e gli oneri generali di sistema\n4,492667 €/kW/mese\n+ 67,39 €\nAltre partite - Interessi FT. X1, Deposito Cauzionale,\nBollo, Gestione Materia Energia\n+ 403,86 €\nAccise e IVA\n+ 239,48 €\nTotale bolletta\n= 1.525,71 €\nTotale da pagare\n= 1.525,71 €`;
const m = printedScontrinoLines(multiRow);
assert.deepEqual(m.filter((line) => !/ - di cui/.test(line.description)).map((line) => [line.code, line.amount]), [
  ["OTHER_CHARGE", "797,67 €"], ["OTHER_CHARGE", "17,31 €"], ["OTHER_CHARGE", "67,39 €"],
  ["ALTRE_PARTITE", "403,86 €"], ["TAX_SUBTOTAL", "239,48 €"], ["BILL_TOTAL", "1.525,71 €"],
]);
assert.match(m.find((line) => line.code === "ALTRE_PARTITE").description, /Bollo, Gestione Materia Energia$/);
// The AI read the quota totals as charges and missed the altre partite (the bill showed quota per consumi 0,00 € and altre
// partite 882,37 €): the printed scontrino replaces those lines and the bill adds up to 1.525,71 € with the right quotas.
const wrongAi = { economicChargeLines: [
  { code: "OTHER_CHARGE", description: "Quota per consumi", amount: "797,67 €", quantity: "2.642", unit: "kWh", unitPrice: "", periodRaw: "", status: "FOUND" },
  { code: "OTHER_CHARGE", description: "Quota fissa e Quota potenza", amount: "17,31 €", quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND" },
  { code: "OTHER_CHARGE", description: "Quota potenza", amount: "67,39 €", quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND" },
  { code: "OTHER_CHARGE", description: "di cui spesa per la vendita di energia elettrica", amount: "668,46 €", quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND" },
  { code: "TAX_SUBTOTAL", description: "Accise e IVA", amount: "239,48 €", quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND" },
] };
const fixed = withPrintedScontrino(wrongAi, multiRow);
assert.deepEqual(fixed.economicChargeLines, m, "only the printed scontrino is left");
const fixedAnalysis = buildCurrentBillEconomicAnalysis(fixed.economicChargeLines, "1.525,71");
assert.equal(fixedAnalysis.totals.reconciliationStatus, "RECONCILED");
assert.equal(fixedAnalysis.totals.sellerEnergyTotal, 668.46);
assert.equal(fixedAnalysis.totals.regulatedNetworkTotal, 200.41);
assert.equal(fixedAnalysis.totals.otherItemsTotal, 403.86);
const fixedReceipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 700, analysis: fixedAnalysis, domestic: false, validUntil: null });
// The comparison leaves the altre partite (interessi, deposito, bollo) out: 1.525,71 - 403,86 = 1.121,85 €.
assert.equal(fixedReceipt.currentTotal, 1121.85);
// The bill's scontrino shows them as printed and the bill's own total.
const billSide = offerScontrino({ quotas: fixedReceipt.quotas, offerTotal: fixedReceipt.currentTotal, taxesIncluded: fixedReceipt.taxesIncluded, vector: "EE", quantity: 2642, months: 1, powerKw: 15, side: "current", excluded: [{ label: "Altre partite", amount: 403.86 }] });
assert.deepEqual(billSide.filter((line) => line.kind !== "sub").map((line) => [line.kind, line.label, line.amount]), [
  ["section", "Quota per consumi", null], ["main", "", 797.67], ["section", "Quota fissa e Quota potenza", null], ["main", "", 17.31], ["main", "", 67.39],
  ["item", "Altre partite", 403.86], ["item", "Accise e IVA", 239.48], ["total", "Totale bolletta", 1525.71],
]);
assert.ok((fixedReceipt.quotas.find((quota) => quota.key === "CONSUMPTION")?.current ?? 0) > 700, "quota per consumi is never 0,00 €");
// Altre partite read one by one by the AI are not added a second time.
const itemised = withPrintedScontrino({ economicChargeLines: [{ code: "INTERESSI_MORA", description: "Interessi", amount: "3,00 €", quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND" }] }, multiRow);
assert.equal(itemised.economicChargeLines.some((line) => line.code === "ALTRE_PARTITE"), false);

// Tony (2/11, sample bills, IREN layout): the reactive rows carry their own "di cui rete" share, and "Altre partite non
// soggette ad IVA" heads bollo and interessi di mora. Synthetic amounts.
const iren = `Quota per consumi\nENERGIA ATTIVA 1.000 kWh x 0,300000 €/kWh 300,00 €\ndi cui spesa per la vendita di energia elettrica 0,250000 €/kWh 250,00 €\ndi cui spesa per la rete e gli oneri generali di sistema 0,050000 €/kWh 50,00 €\nENERGIA REATTIVA 1.000 kVARh x 0,003770 €/kVARh 3,77 €\ndi cui spesa per la rete e gli oneri generali di sistema 0,003770 €/kVARh 3,77 €\nENERGIA REATTIVA IMMESSA 10 kVARh x 0,010000 €/kVARh 0,10 €\ndi cui spesa per la rete e gli oneri generali di sistema 0,010000 €/kVARh 0,10 €\nQuota fissa 1 mese x 20,000000 €/mese 20,00 €\ndi cui spesa per la vendita di energia elettrica 15,000000 €/mese 15,00 €\ndi cui spesa per la rete e gli oneri generali di sistema 5,000000 €/mese 5,00 €\nAltre partite non soggette ad IVA 12,00 €\nBollo fattura 2,00 €\nInteressi di mora 10,00 €\nAccise e IVA 40,00 €\nTotale bolletta 375,87 €`;
const i = printedScontrinoLines(iren);
assert.ok(!i.some((line) => /^Quota per consumi - di cui/.test(line.description) && ["3,77 €", "0,10 €"].includes(line.amount)), "the reactive share is not a quota per consumi share");
assert.deepEqual(i.filter((line) => line.code === "ALTRE_PARTITE").map((line) => [line.description, line.amount]), [["Bollo fattura", "2,00 €"], ["Interessi di mora", "10,00 €"]]);
const irenAnalysis = buildCurrentBillEconomicAnalysis(i, "375,87");
assert.equal(irenAnalysis.totals.reconciliationStatus, "RECONCILED");
const irenReceipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 300, analysis: irenAnalysis, domestic: false, validUntil: null });
// Out of the comparison: the altre partite 12,00 €; in: reactive 3,87 € with the network (50 + 5 + 3,87).
assert.equal(irenReceipt.currentTotal, 363.87);
assert.equal(irenReceipt.rows.find((row) => row.key === "NETWORK").current, 58.87);
// The TIDE dispatching lines of the spesa per la materia energia are seller dispatching, never altre partite.
for (const label of ["Corrispettivo FTE (TIDE)", "Corrispettivo OTHER (TIDE)", "Corrispettivo Uplift (TIDE)"]) assert.equal(classifyBillEconomicComponent("OTHER_CHARGE", label), "DISPATCHING_SELLER_CHARGE", label);
assert.equal(classifyBillEconomicComponent("OTHER_CHARGE", "Corrispettivo Mercato capacità"), "CAPACITY_MARKET_SELLER_CHARGE");
assert.equal(classifyBillEconomicComponent("ALTRE_PARTITE", "Altre partite non soggette ad IVA"), "ALTRE_PARTITE");

// Tony (2/11, Plenitude sample bill layout): the Box dell'offerta sits in a column to the right of the scontrino, and the
// quota per consumi holds reactive energy that neither "di cui" shows. Synthetic amounts.
const pad = (left, right = "") => `${left.padEnd(100)}${right}`;
const twoColumns = [
  pad("   QUOTA PER CONSUMI 1000 kWh      0,300000      304,40 €", "Nome offerta: Offerta Test"),
  pad("      di cui spesa per la vendita di energia      0,250000      250,00 €", "Codice offerta: TEST"),
  pad("      di cui spesa per la rete e gli oneri      0,050000      50,00 €", "Validità: dal 01/05/2025"),
  pad("      generali di sistema      €/kWh"),
  pad("   QUOTA FISSA 1 mesi      20,000000      20,00 €", "Oneri di recesso: no"),
  pad("      di cui spesa per la vendita di energia      15,000000      15,00 €"),
  pad("      di cui spesa per la rete e gli oneri      5,000000      5,00 €", "Totale dovuto per la vendita: 265,00 €"),
  pad("   Accise e IVA      40,00 €"),
  pad("   Totale bolletta      364,40 €"),
  "   Energia Reattiva Prelevata      €/kVArh      0,01088000      404      F1      4,40",
].join("\n");
const t = printedScontrinoLines(twoColumns);
assert.equal(t.find((line) => line.description === "QUOTA FISSA - di cui spesa per la rete e gli oneri 5,000000")?.amount, "5,00 €", "the box column lends no amount");
assert.equal(t.find((line) => /^Energia reattiva \(compresa/.test(line.description))?.amount, "4,40 €");
const twoReceipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 300, analysis: buildCurrentBillEconomicAnalysis(t, "364,40"), domestic: false, validUntil: null });
assert.equal(twoReceipt.currentTotal, 364.4);
assert.equal(twoReceipt.rows.find((row) => row.key === "NETWORK").current, 59.4);

// Tony (2/11, sample bills): Hera prints the amount before the average price, Elios prints amounts without "€" under an
// "Importi [€]" heading. Synthetic amounts.
const hera = ["Quota per consumi", "1000 kWh                                       300,00 €                0,300000 €/kWh", "    di cui spesa per la vendita di energia elettrica*          250,00 €              0,250000 €/kWh", "    di cui spesa per la rete e gli oneri generali di sistema**          50,00 €              0,050000 €/kWh", "Quota fissa e quota potenza", "1 mesi                       17,81 €             17,810000 €/mese", "    di cui spesa per la vendita di energia elettrica*          14,00 €              14,000000 €/mese", "    di cui spesa per la rete e gli oneri generali di sistema**          3,81 €               3,810000 €/mese", "10 kW per 1 mesi                       44,92 € 4,492000 €/kW/mese", "    di cui spesa per la rete e gli oneri generali di sistema**          44,92 € 4,492000 €/kW/mese", "Accise e IVA          60,00 €", "Totale bolletta          422,73 €"].join("\n");
assert.equal(buildCurrentBillEconomicAnalysis(printedScontrinoLines(hera), "422,73").totals.reconciliationStatus, "RECONCILED");
const elios = ["Quantità          Prezzo medio(*) Unità di misura          Importi [€]", "     QUOTA PER I CONSUMI", "          100,03          0,3488          €/kWh          34,88", "     di cui spesa per vendita energia elettrica          0,26593          €/kWh          26,60          testo a destra", "     di cui spesa per la rete e oneri generali di sistema          0,08287          €/kWh          8,28", "     QUOTA FISSA E QUOTA POTENZA", "     Quota potenza 3          1,976667          €/kW/mese          5,93          altra colonna", "     di cui spesa per la rete e oneri generali di sistema          1,976667          €/kW/mese          5,93", "    Accise e IVA          10,71          modo uniforme", "          Totale bolletta          51,52"].join("\n");
const eliosLines = printedScontrinoLines(elios);
assert.equal(eliosLines.find((line) => line.description === "QUOTA PER I CONSUMI")?.amount, "34,88 €", "the quantity is not the amount");
assert.equal(buildCurrentBillEconomicAnalysis(eliosLines, "51,52").totals.reconciliationStatus, "RECONCILED");

// Tony (3/11, Atlante delle voci): charges the CTE does not make determinable are listed, so the total is shown as provisional.
const provisional = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 300, analysis: irenAnalysis, domestic: false, validUntil: null, warnings: ["OFFICIAL_VALUE_MISSING:LOSSES:CTE_NOT_DETERMINABLE", "OFFICIAL_VALUE_MISSING:DISPATCHING:CTE_NOT_DETERMINABLE"] });
assert.deepEqual(provisional.undetermined, ["Perdite di rete", "Dispacciamento"]);
assert.deepEqual(irenReceipt.undetermined, []);
console.log("PRINTED_SCONTRINO=PASS");
