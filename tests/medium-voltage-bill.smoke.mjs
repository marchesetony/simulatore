import assert from "node:assert/strict";
import { voltageFromText, withTextVoltage } from "../app/lib/ingestion/printed-voltage.ts";
import { printedScontrinoLines } from "../app/lib/ingestion/printed-scontrino.ts";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";
import { billedMonths, offerScontrino } from "../app/lib/quote/offer-scontrino.ts";
import { readFileSync } from "node:fs";
import { withPrintedVoltageCheck } from "../app/lib/market/pun-reference.ts";

// Tony (2/11, "voglio capire perchè a noi risulta molto meno il risparmio rispetto a quello che ha fatto bpower"): a business
// bill in media tensione (20.000 V, 200 kW) was quoted as bassa tensione, and its 510,89 € of oneri (ASOS and ARIM listed
// with no quota) were taken out of the quota per consumi. Synthetic text shaped like that bill; no customer data.

// 1. The voltage printed in the text is the supply's, and wins over the reading.
assert.equal(voltageFromText("CARATTERISTICHE TECNICHE DELLA FORNITURA\nTipologia Cliente Altri Usi\nTensione nominale di alimentazione 20.000 V"), "MV");
assert.equal(voltageFromText("Tensione di fornitura: 220 V - Bassa Tensione"), "LV");
assert.equal(voltageFromText("Tensione di alimentazione: 400 V"), "LV");
assert.equal(voltageFromText("Livello di tensione: Media Tensione"), "MV");
assert.equal(voltageFromText("Tensione di alimentazione 132 kV"), "HV");
assert.equal(voltageFromText("Consumo annuo 122.211 kWh\nPotenza impegnata 200,00 kW"), null, "no voltage row, no voltage");
const read = { voltageLevel: { value: "LV", status: "FOUND", confidence: 0.9, source: "DOCUMENT_AI" } };
assert.equal(withTextVoltage(read, "Tensione nominale di alimentazione 20.000 V").voltageLevel.value, "MV");
assert.equal(withTextVoltage(read, "nessuna tensione stampata"), read);

// 2. The scontrino, energia reattiva included, and the oneri page.
const text = [
  "SCONTRINO DELL'ENERGIA", "QUANTITA' PREZZO MEDIO IMPORTI", "Quota per consumi",
  "9.512 kWh x 0,314091 €/kWh 2.987,63 €",
  "di cui spesa per la vendita di energia elettrica 0,267883 €/kWh 2.548,10 €",
  "di cui spesa per la rete e gli oneri generali di sistema 0,046208 €/kWh 439,53 €",
  "Energia reattiva prelevata 753 kVARh x 0,003772 €/ kVARh 2,84 €",
  "Quota fissa e Quota potenza", "1 mese x 105,730000 €/mese 105,73 €",
  "di cui spesa per la vendita di energia elettrica 0,000000 €/mese 0,00 €",
  "di cui spesa per la rete e gli oneri generali di sistema 105,730000 €/mese 105,73 €",
  "104 kW per 1 mese x 4,186923 €/kW/mese 435,44 €",
  "di cui spesa per la rete e gli oneri generali di sistema 4,186923 €/kW/mese 435,44 €",
  "Bonus sociale 0,00 €", "Altre partite - Addebito CTS-Corrispettivo Tariffario Specifico 42,46 €", "Accise e IVA 931,36 €", "Totale bolletta 4.505,46 €",
].join("\n");
const lines = printedScontrinoLines(text);
const reactive = lines.find((line) => /reattiva/i.test(line.description));
assert.ok(reactive, "energia reattiva is read from the scontrino");
assert.equal(reactive.amount, "2,84 €");
const oneri = [
  { code: "ARIM", description: "Componente ARIM a copertura di altri oneri relativi ad attività di interesse generale", amount: "49,27 €", quantity: null, unit: null, unitPrice: null },
  { code: "ASOS", description: "Componente ASOS a copertura dei costi per il sostegno delle fonti rinnovabili e da cogenerazione", amount: "461,62 €", quantity: null, unit: null, unitPrice: null },
];
const analysis = buildCurrentBillEconomicAnalysis([...lines, ...oneri], "4.505,46");
assert.equal(analysis.totals.reconciliationStatus, "RECONCILED");
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 2500, analysis, domestic: false, validUntil: null });
const bill = offerScontrino({ quotas: receipt.quotas, offerTotal: receipt.currentTotal, taxesIncluded: receipt.taxesIncluded, vector: "EE", quantity: 9512, months: 1, powerKw: 104, side: "current" });
const consumption = bill.find((line) => line.kind === "main");
assert.equal(consumption.amount, 2987.63, "the quota per consumi stays as printed (was 2.476,74 € with the oneri moved out)");
assert.equal(bill.find((line) => line.kind === "sub" && /rete/.test(line.label)).amount, 439.53);
assert.equal(bill.find((line) => line.kind === "total").amount, 4505.46);

// 3. The receipt says why rete e oneri are the bill's in media tensione.
const mv = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 2500, analysis, domestic: false, validUntil: null, warnings: ["OFFICIAL_VALUE_MISSING:REGULATED:REGULATORY_SCOPE_VOLTAGE_MV"] });
assert.match(mv.officialCheck.NETWORK.reason, /media tensione/);

// 4. "01/09/2026 - 30/09/2026" is one month, as printed ("1 mese"), not 0,97: the screen counts on the day after the last day.
assert.equal(billedMonths("2026-09-01", "2026-10-01"), 1);
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /const base = \{ bill, context: withExclusiveEnd\(prepared\.context\)/);
assert.match(flow, /getUTCDate\(\) !== 1 \? new Date\(time \+ 86_400_000\)/);

// 5. Tony (2/11, "come mai ancora uguale"): a bill archived as BT while it prints 20.000 V says so, with the reread button.
const archived = { normalized: { supply: { voltageLevel: "LV" } }, structuredBill: read };
assert.deepEqual(withPrintedVoltageCheck(archived, "Tensione nominale di alimentazione 20.000 V").printedVoltageMismatch, { printed: "MV", read: "LV" });
assert.equal(withPrintedVoltageCheck({ normalized: { supply: { voltageLevel: "MV" } }, structuredBill: read }, "Tensione nominale di alimentazione 20.000 V").printedVoltageMismatch, undefined);
assert.match(flow, /bill\.printedVoltageMismatch \|\| bill\.chargeLinesUnread/);

console.log("medium voltage bill smoke ok");

// Tony (2/11, sample bills): the voltage is printed in table layouts too. IREN prints the header "Tensione di
// alimentazione" with "Media Tensione 20.000" on the row below; Repower prints "LIVELLO NOMINALE DI TENSIONE" with
// "Bassa tensione (380 V)" two rows below; BPower prints "Tensione nominale: 220 V". Synthetic layouts.
assert.equal(voltageFromText("   Tipologia cliente      Tensione di alimentazione      Potenza Impegnata\n   ALTRI USI              Media Tensione 20.000          311,1 kW"), "MV");
assert.equal(voltageFromText("      LIVELLO NOMINALE DI TENSIONE                 dal 01/10/2025\n                                                   Aggiornato\n      Bassa tensione (380 V)"), "LV");
assert.equal(voltageFromText("Tipologia cliente: Altri usi\nTensione nominale: 220 V"), "LV");
