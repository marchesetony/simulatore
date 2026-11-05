import assert from "node:assert/strict";
import { ClaudeBillReader, parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { checkBillReading, italianNumber, scontrinoSum } from "../app/lib/reading/bill-reader-checks.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { BILL_READER_SCHEMA, BILL_READER_TOOL_NAME } from "../app/lib/reading/bill-reader-schema.ts";
import { readingHasScontrino } from "../app/lib/ingestion/printed-scontrino.ts";

// Tony (5/11/2026, "continuano gli errori di lettura ... cancellare e ripartire da zero"): one reader, Claude reads the whole
// bill, the numbers are checked against each other, a reading that does not add up is read again.

// Sample 4 of campioni.md (Minniti, BPower sintetica, Tony "ok" 2/11).
const row = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const minniti = parseBillReading({
  tipoDocumento: "BOLLETTA_SINTETICA", vettore: "EE", tipoCliente: "DOMESTICO", livelloTensione: "BT",
  fornitore: "BPower Energia S.p.A.", intestatario: "MINNITI", pod: "IT001E00000000", tipoClienteStampato: "Domestico residente", tensioneStampata: "220 V",
  potenzaImpegnataKw: "3", potenzaDisponibileKw: "3,3", periodoStampato: "01/09/2026 - 30/09/2026", periodoDal: "2026-09-01", periodoAl: "2026-09-30",
  consumoFatturato: "447", consumoF1: "85", consumoF2: "183", consumoF3: "179",
  offertaNome: "BE Family CASA PROTETTA", offertaCodice: "003888ESVFL02XXXXXXXCASAPROTETTA", tipologiaOfferta: "VARIABILE", indice: "PUN", spread: "0,02 €/kWh",
  totaleBolletta: "171,77",
  scontrino: [
    row("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "141,95", { quantita: "447", unita: "kWh", prezzoMedio: "0,317562", unitaPrezzo: "€/kWh" }),
    row("di cui spesa per la vendita", "DI_CUI_VENDITA", "CONSUMI", "120,55"),
    row("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "21,40"),
    row("Quota fissa", "QUOTA_TOTALE", "FISSA", "14,92"),
    row("di cui spesa per la vendita", "DI_CUI_VENDITA", "FISSA", "13,00"),
    row("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "1,92"),
    row("Quota potenza", "QUOTA_TOTALE", "POTENZA", "5,93", { quantita: "3,0", unita: "kW", prezzoMedio: "1,976667", unitaPrezzo: "€/kW/mese" }),
    row("Bonus sociale", "BONUS_SOCIALE", "NESSUNA", "-16,80"),
    row("Accise e IVA", "ACCISE_IVA", "NESSUNA", "25,77"),
    row("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "171,77"),
    row("Canone TV", "CANONE_TV", "NESSUNA", "9,00"),
  ],
  assenti: [{ campo: "consumoAnnuo", motivo: "non stampato nella sintetica" }],
});

assert.equal(italianNumber("1.234,56"), 1234.56);
assert.equal(italianNumber("-16,80 €"), -16.8);
assert.equal(italianNumber("0,207540"), 0.20754);
assert.equal(italianNumber("74.563"), 74563);
assert.equal(italianNumber(""), null);
assert.equal(scontrinoSum(minniti.scontrino).toFixed(2), "171.77", "TV licence is outside the bill total");
assert.deepEqual(checkBillReading(minniti), [], "a correct reading has no failed check");

const bill = toStructuredBill({ reading: minniti, checks: [], reread: false });
assert.equal(bill.reader, "CLAUDE_DIRETTO");
assert.equal(bill.billedConsumption.value, 447);
assert.equal(bill.f1Consumption.value, 85);
assert.equal(bill.voltageLevel.value, "LV");
assert.equal(bill.customerType.value, "RESIDENTIAL");
assert.equal(bill.totalAmount.value, 171.77);
assert.equal(bill.annualConsumption.status, "NOT_FOUND", "the annual consumption is not invented");
assert.deepEqual(bill.readingAbsent, [{ field: "consumoAnnuo", reason: "non stampato nella sintetica" }]);
assert.equal(bill.billingPeriod.value.from, "2026-09-01");
assert.equal(bill.billingPeriod.value.to, "2026-09-30");
assert.equal(bill.offerCode.value, "003888ESVFL02XXXXXXXCASAPROTETTA");
assert.ok(readingHasScontrino(bill), "the scontrino reaches the receipt as 'di cui' lines");
assert.ok(bill.economicChargeLines.some((line) => line.code === "NETWORK_SYSTEM" && line.description === "Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema" && line.amount === "21,40 €"));
assert.ok(bill.economicChargeLines.some((line) => line.code === "BILL_TOTAL" && line.amount === "171,77 €"));
assert.ok(bill.economicChargeLines.some((line) => line.code === "BONUS" && line.amount === "-16,80 €"));
assert.ok(bill.extendedFacts.some((fact) => fact.code === "SPREAD" && fact.value === "0,02 €/kWh"));

// The screenshot of 5/11 (BPower, consumo fatturato 0): F1-F3 read but no total → the total is F1+F2+F3, never 0.
const bandsOnly = parseBillReading({ ...minniti, consumoFatturato: "" });
assert.equal(toStructuredBill({ reading: bandsOnly, checks: [], reread: false }).billedConsumption.value, 447);

// Checks that send the bill back to Claude.
const codes = (reading) => checkBillReading(reading).map((check) => check.code);
assert.ok(codes(parseBillReading({ ...minniti, consumoF1: "58" })).includes("BANDS_SUM"));
assert.ok(codes(parseBillReading({ ...minniti, consumoFatturato: "0", consumoF1: "", consumoF2: "", consumoF3: "" })).includes("CONSUMPTION_MISSING"));
assert.ok(codes(parseBillReading({ ...minniti, scontrino: minniti.scontrino.filter((item) => item.tipo !== "ACCISE_IVA") })).includes("SCONTRINO_TOTAL"));
assert.ok(codes(parseBillReading({ ...minniti, scontrino: minniti.scontrino.map((item) => item.importo === "120,55" ? { ...item, importo: "102,55" } : item) })).includes("QUOTA_SHARES"));
assert.ok(codes(parseBillReading({ ...minniti, scontrino: minniti.scontrino.map((item) => item.importo === "141,95" ? { ...item, prezzoMedio: "0,217562" } : item) })).includes("PRODUCT"));
assert.ok(codes(parseBillReading({ ...minniti, periodoDal: "" })).includes("PERIOD_MISSING"));

// The reader: a first reading that does not add up is read again with the findings; the better reading is kept.
const message = (input) => ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: {}, content: [{ type: "tool_use", id: "t", name: BILL_READER_TOOL_NAME, input }] });
const calls = [];
const client = { messages: { async create(params) { calls.push(params); return message(calls.length === 1 ? { ...minniti, consumoFatturato: "0", consumoF1: "", consumoF2: "", consumoF3: "" } : minniti); } } };
const reader = new ClaudeBillReader(client, "claude-sonnet-4-5", 8000);
const read = await reader.extract({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
assert.equal(calls.length, 2, "read again because the consumption was missing");
assert.match(calls[1].messages[0].content[1].text, /Consumo fatturato/);
assert.equal(calls[0].temperature, 0, "temperature 0 where the model accepts it");
assert.equal(calls[0].tools[0].strict, true);
assert.equal(calls[0].messages[0].content[0].type, "document", "Claude receives the PDF itself");
assert.equal(read.billedConsumption.value, 447);
assert.equal(read.readingReread, true);
assert.deepEqual(read.readingChecks, []);

// A reading that adds up is read once.
calls.length = 0;
const once = new ClaudeBillReader({ messages: { async create(params) { calls.push(params); return message(minniti); } } }, "claude-sonnet-4-5", 8000);
await once.extract({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
assert.equal(calls.length, 1);

// What still does not add up after the second reading is kept for the operator, not corrected.
calls.length = 0;
const stubborn = new ClaudeBillReader({ messages: { async create(params) { calls.push(params); return message({ ...minniti, consumoF1: "58" }); } } }, "claude-sonnet-4-5", 8000);
const kept = await stubborn.extract({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
assert.equal(calls.length, 2);
assert.equal(kept.readingChecks.length, 1);
assert.match(kept.readingChecks[0], /F1 58/);

// The schema the API receives: every property required (strict tool), no free-form object.
const walk = (schema, path) => {
  if (schema.type === "object") { assert.equal(schema.additionalProperties, false, path); assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), path); for (const [key, child] of Object.entries(schema.properties)) walk(child, `${path}.${key}`); }
  if (schema.type === "array") walk(schema.items, `${path}[]`);
};
walk(BILL_READER_SCHEMA, "root");
// Tony (5/11, DARVEPOST BPower, "Le righe dello scontrino sommano 212.42 € ma il totale bolletta è 106.21 €"): the
// "Totale da pagare" printed after the Totale bolletta is not a row of the bill total, nor altre partite.
const darvepost = parseBillReading({ ...minniti, tipoCliente: "ALTRI_USI", totaleBolletta: "106,21", consumoFatturato: "140", consumoF1: "", consumoF2: "", consumoF3: "", scontrino: [
  row("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "47,03", { quantita: "140", unita: "kWh", prezzoMedio: "0,335929", unitaPrezzo: "€/kWh" }),
  row("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "CONSUMI", "39,09"),
  row("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "7,94"),
  row("Quota fissa e Quota potenza - 1 mese", "QUOTA_TOTALE", "FISSA", "18,74"),
  row("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "FISSA", "15,00"),
  row("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "3,74"),
  row("Quota potenza", "QUOTA_TOTALE", "POTENZA", "12,13"),
  row("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "12,13"),
  row("Altre partite - Interessi di mora", "ALTRE_PARTITE", "NESSUNA", "0,04"),
  row("Altre partite - Spese di sollecito", "ALTRE_PARTITE", "NESSUNA", "9,00"),
  row("Accise e IVA", "ACCISE_IVA", "NESSUNA", "19,27"),
  row("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "106,21"),
  row("Totale da pagare", "ALTRO", "NESSUNA", "106,21"),
] });
assert.equal(scontrinoSum(darvepost.scontrino).toFixed(2), "106.21");
assert.ok(!codes(darvepost).includes("SCONTRINO_TOTAL"));
const darvepostBill = toStructuredBill({ reading: darvepost, checks: [], reread: false });
assert.ok(!darvepostBill.economicChargeLines.some((line) => line.code === "ALTRE_PARTITE" && /da pagare/i.test(line.description)));
assert.ok(darvepostBill.economicChargeLines.some((line) => line.code === "AMOUNT_DUE"));
assert.ok(minnitiTv(), "the TV licence is kept as canone, not altre partite");
function minnitiTv() { return bill.economicChargeLines.some((line) => line.code === "CANONE_RAI" && line.amount === "9,00 €") && !bill.economicChargeLines.some((line) => line.code === "ALTRE_PARTITE"); }
console.log("bill-reader smoke OK");
