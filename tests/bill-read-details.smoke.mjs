import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { buildBillAnalystReview } from "../app/lib/foundation/bill-analyst-review.ts";
import { billReadSections, italianDecimal, NOT_IN_BILL, NOT_READ, printedContractValues } from "../app/lib/ui/bill-read-details.ts";

// Tony (10/11/2026, fattura EE20369/2026): "Dati letti" must show what the reading already holds, in four sections, and say
// for each value whether it was read, is not printed, must be checked or was calculated. Synthetic bill with the same
// structure and amounts as the verified case; no real customer, POD, address or supplier.

const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const dt = (descrizione, voce, quantita, unita, prezzo, unitaPrezzo, importo, fascia = "NESSUNA") => ({ descrizione, voce, fascia, periodo: "", quantita, unita, prezzo, unitaPrezzo, importo, pagina: 3 });

const reading = parseBillReading({
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "AZIENDA DI PROVA SPA", pod: "IT000E00000000",
  tipoClienteStampato: "altri usi", tensioneStampata: "380,0 V", potenzaImpegnataKw: "15,0", potenzaMassimaPrelevataKw: "15,0", mercato: "MERCATO LIBERO",
  periodoStampato: "01/09/2026 - 30/09/2026", periodoDal: "2026-09-01", periodoAl: "2026-09-30",
  consumoFatturato: "2.672,07", consumoF1: "1.791,02", consumoF2: "354,44", consumoF3: "526,62", consumoAnnuo: "29.306",
  offertaNome: "OFFERTA DI PROVA", offertaCodice: "CODICEPROVA01", tipologiaOfferta: "a prezzo variabile", tipologiaPrezzo: "a fasce", indice: "PUN",
  spread: "0,012 €/kWh", pcvMensile: "10,392500", decorrenzaCondizioni: "2026-05-01", scadenzaContratto: "tempo indeterminato",
  totaleBolletta: "1.226,06",
  scontrino: [
    sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "889,98", { quantita: "2.672,07", unita: "kWh", prezzoMedio: "0,333068", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la vendita", "DI_CUI_VENDITA", "CONSUMI", "711,96"),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "178,02"),
    sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "14,20", { quantita: "1", unita: "mesi" }),
    sc("di cui spesa per la vendita", "DI_CUI_VENDITA", "FISSA", "10,39", { prezzoMedio: "10,39", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "3,81", { prezzoMedio: "3,81", unitaPrezzo: "€/mese" }),
    sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "67,39", { quantita: "15", unita: "kW", prezzoMedio: "4,492667", unitaPrezzo: "€/kW/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "67,39", { prezzoMedio: "4,492667", unitaPrezzo: "€/kW/mese" }),
    sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "254,49"),
    sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "1.226,06"),
  ],
  dettaglio: [
    dt("Commercializzazione e vendita", "PCV", "1", "mesi", "10,392500", "Euro/POD/mese", "10,39"),
    dt("Energia F1", "PREZZO_ENERGIA", "1.791,00", "kWh", "0,218350", "Euro/KWH", "391,06", "F1"),
    dt("Quota variabile smart (CVS)", "COMMERCIALIZZAZIONE_VARIABILE", "2.672,07", "kWh", "0,007713", "Euro/KWH", "20,61"),
    dt("Quota variabile voci di trasporto", "ALTRO_VENDITA", "2.672,07", "kWh", "0,010000", "Euro/KWH", "26,72"),
    dt("Distribuzione fissa", "TRASPORTO_QUOTA_FISSA", "1", "mesi", "49,020000", "Eurocent/mese", "0,49"),
    dt("Asos - Quota fissa", "ONERI_ASOS", "1", "mesi", "110,280000", "Eurocent/mese", "1,10"),
    dt("Arim - Quota fissa", "ONERI_ARIM", "1", "mesi", "25,690000", "Eurocent/mese", "0,26"),
    dt("Asos - Quota potenza", "ONERI_ASOS", "15,0", "kW", "130,010000", "Eurocent/KW/mese", "19,50"),
    dt("Arim - Quota potenza", "ONERI_ARIM", "15,0", "kW", "30,300000", "Eurocent/KW/mese", "4,55"),
    dt("Asos - Quota energia", "ONERI_ASOS", "2.672,00", "kWh", "0,031881", "Euro/KWH", "85,19"),
    dt("Arim - Quota energia", "ONERI_ARIM", "2.672,00", "kWh", "0,001616", "Euro/KWH", "4,32"),
    dt("Accisa", "ACCISE", "2.672,00", "kWh", "0,012500", "Euro/KWH", "33,40"),
    dt("IVA 22% su imponibile 1.004,97", "IVA", "1.004,97", "", "22", "%", "221,09"),
  ],
  assenti: [
    { campo: "potenzaDisponibileKw", motivo: "non stampato" },
    { campo: "scadenzaCondizioni", motivo: "stampato 'n.d.' nel Box: nessuna data" },
  ],
});

const structuredBill = toStructuredBill({ reading, checks: [], reread: false });
const review = (sb, vector = "EE") => buildBillAnalystReview({ id: "bill-fixture", fileName: "fixture.pdf", status: "REVIEW_REQUIRED", reviewState: "WORKING", currentVersionNumber: 1, currentApprovedVersionId: null, approvalReady: false, updatedAt: "2026-10-10T00:00:00.000Z", fields: {}, normalized: null, structuredBill: sb, resolvedVector: vector, invoicePunReferences: [] });
const billOf = (sb, vector = "EE") => ({ fields: {}, structuredBill: sb, analystReview: review(sb, vector), resolvedVector: vector });
const sections = billReadSections(billOf(structuredBill));
const section = (all, id) => all.find((item) => item.id === id);
// Intl writes a no-break space before "€": compared as a plain space.
const plain = (item) => item && { ...item, value: item.value.replace(/\u00a0/g, " "), ...(item.note ? { note: item.note.replace(/\u00a0/g, " ") } : {}) };
const rowOf = (all, id, label) => plain(section(all, id).rows.find((item) => item.label === label));

// 1. The four sections, in order.
assert.deepEqual(sections.map((item) => item.id), ["SUPPLY", "TECHNICAL", "CONTRACT", "ECONOMICS"]);

// A. Identificazione fornitura.
assert.deepEqual(rowOf(sections, "SUPPLY", "Fornitore attuale"), { label: "Fornitore attuale", value: "VENDITORE DI PROVA S.R.L.", state: "READ" });
assert.equal(rowOf(sections, "SUPPLY", "POD").value, "IT000E00000000");
assert.equal(rowOf(sections, "SUPPLY", "Tipologia cliente").value, "altri usi");
assert.equal(rowOf(sections, "SUPPLY", "Mercato").value, "MERCATO LIBERO");
assert.equal(rowOf(sections, "SUPPLY", "Periodo fatturato").value, "01/09/2026 - 30/09/2026");
assert.equal(rowOf(sections, "SUPPLY", "Indirizzo della fornitura"), undefined, "the reader does not read the address: no row is invented");

// B. Caratteristiche tecniche, with the precision printed.
assert.equal(rowOf(sections, "TECHNICAL", "Tensione di alimentazione").value, "380,0 V · bassa tensione (BT)");
assert.equal(rowOf(sections, "TECHNICAL", "Potenza impegnata").value, "15,0 kW");
assert.equal(rowOf(sections, "TECHNICAL", "Potenza massima prelevata").value, "15,0 kW");
// 2. Missing data: declared not printed by the reader.
assert.deepEqual(rowOf(sections, "TECHNICAL", "Potenza disponibile"), { label: "Potenza disponibile", value: NOT_IN_BILL, state: "ABSENT", note: "non stampato" });
// 6. F0, F1, F2, F3 kept as read. Tony (10/11, "semplificazione"): the sum is not a second total, its gap is a discreet note.
assert.equal(rowOf(sections, "TECHNICAL", "Consumo complessivo fatturato").value, "2.672,07 kWh");
assert.match(rowOf(sections, "TECHNICAL", "Consumo complessivo fatturato").note, /F1 \+ F2 \+ F3 = 2\.672,08 kWh: scostamento di 0,01 kWh \(calcolato\)/);
assert.equal(rowOf(sections, "TECHNICAL", "Consumo F1").value, "1.791,02 kWh");
assert.equal(rowOf(sections, "TECHNICAL", "Consumo F2").value, "354,44 kWh");
assert.equal(rowOf(sections, "TECHNICAL", "Consumo F3").value, "526,62 kWh");
assert.equal(rowOf(sections, "TECHNICAL", "Somma F1 + F2 + F3"), undefined, "no second consumption total");
const matching = { ...structuredBill, f3Consumption: { ...structuredBill.f3Consumption, value: 526.61 } };
assert.equal(rowOf(billReadSections(billOf(matching)), "TECHNICAL", "Consumo complessivo fatturato").note, undefined, "no note when F1+F2+F3 matches");
assert.equal(structuredBill.billedConsumption.value, 2672.07, "the billed total is not altered");
assert.deepEqual([structuredBill.f1Consumption.value, structuredBill.f2Consumption.value, structuredBill.f3Consumption.value], [1791.02, 354.44, 526.62]);
assert.equal(rowOf(sections, "TECHNICAL", "Consumo annuo dichiarato").value, "29.306 kWh");

// C. Contratto. 4. The printed spread is shown as printed; the PCV as printed with its unit.
assert.equal(rowOf(sections, "CONTRACT", "Offerta").value, "OFFERTA DI PROVA · codice CODICEPROVA01");
assert.equal(rowOf(sections, "CONTRACT", "Decorrenza condizioni economiche").value, "01/05/2026");
assert.equal(rowOf(sections, "CONTRACT", "Scadenza contratto").value, "Contratto a tempo indeterminato");
assert.deepEqual(rowOf(sections, "CONTRACT", "Scadenza condizioni economiche"), { label: "Scadenza condizioni economiche", value: NOT_IN_BILL, state: "ABSENT", note: "stampato 'n.d.' nel Box: nessuna data" });
assert.equal(rowOf(sections, "CONTRACT", "Tipologia prezzo").value, "a prezzo variabile");
assert.equal(rowOf(sections, "CONTRACT", "Struttura del prezzo").value, "a fasce");
assert.equal(rowOf(sections, "CONTRACT", "Indice").value, "PUN");
assert.deepEqual(rowOf(sections, "CONTRACT", "Spread contrattuale (stampato)"), { label: "Spread contrattuale (stampato)", value: "0,012 €/kWh", state: "READ" });
const pcv = rowOf(sections, "CONTRACT", "PCV / commercializzazione");
assert.equal(pcv.state, "READ");
assert.equal(pcv.value, "10,392500 €/POD/mese · importo 10,39 €");
assert.equal(rowOf(sections, "CONTRACT", "Quota variabile smart (CVS)").value, "0,007713 €/kWh · importo 20,61 €");
assert.equal(rowOf(sections, "CONTRACT", "Quota variabile voci di trasporto").value, "0,010000 €/kWh · importo 26,72 €");

// D. Economics. 5. Printed values and the simulator's grouping are separate and labelled.
const economics = section(sections, "ECONOMICS").rows;
assert.equal(rowOf(sections, "ECONOMICS", "Spesa per la vendita di energia").value, "722,35 €");
assert.equal(rowOf(sections, "ECONOMICS", "Spesa per la rete e gli oneri generali di sistema").value, "249,22 €");
const network = rowOf(sections, "ECONOMICS", "di cui spesa per la rete e il trasporto");
assert.equal(network.value, "134,30 €");
assert.equal(network.state, "CALCULATED", "the network share is a difference: labelled calculated");
assert.equal(rowOf(sections, "ECONOMICS", "Oneri generali di sistema").value, "114,92 €");
assert.equal(rowOf(sections, "ECONOMICS", "Accise").value, "33,40 €");
assert.equal(rowOf(sections, "ECONOMICS", "IVA").value, "221,09 €");
assert.deepEqual(rowOf(sections, "ECONOMICS", "Totale fatturato"), { label: "Totale fatturato", value: "1.226,06 €", state: "READ" }, "the components add up: the total once, no note");
assert.equal(rowOf(sections, "ECONOMICS", "Somma delle componenti stampate"), undefined, "the total is not repeated");
// 8. The simulator's grouping only where it differs from what the bill prints, always labelled.
const normalized = economics.filter((item) => /classificazione del simulatore/.test(item.label)).map(plain);
assert.deepEqual(normalized.map((item) => item.label), ["Vendita (classificazione del simulatore)", "Rete e trasporto (classificazione del simulatore)"], "equal groupings (oneri, accise e IVA) are not repeated");
assert.ok(normalized.every((item) => item.state === "CALCULATED" && /in fattura \d/.test(item.note)));
assert.match(section(sections, "ECONOMICS").note, /dove differisce dalla fattura/);
// 1, 2, 7. No value shown twice: one row per label in the whole screen.
const labels = sections.flatMap((entry) => entry.rows.map((item) => item.label));
assert.deepEqual(labels.filter((label, index) => labels.indexOf(label) !== index), []);
for (const label of ["Intestatario", "Fornitore attuale", "POD", "Periodo fatturato", "Totale fatturato", "Consumo complessivo fatturato"]) assert.equal(labels.filter((item) => item === label).length, 1, label);
// 5, 6. What the bill prints for the contract, so the screen adds a calculated value only where it is missing or different.
assert.deepEqual(printedContractValues(billOf(structuredBill)), { priceType: "a prezzo variabile", priceStructure: "a fasce", spread: "0,012 €/kWh", monthlyPcv: 10.3925 });

// 3. Read and calculated are never mixed: every calculated row says so.
for (const item of sections.flatMap((entry) => entry.rows)) if (item.state === "CALCULATED") assert.match(item.note ?? "", /Calcolat|Somma|classificazione|Raggruppamento|Dedott/i, item.label);

// 3. "Da verificare" only when the data mark it.
const uncertain = { ...structuredBill, f2Consumption: { ...structuredBill.f2Consumption, status: "NEEDS_REVIEW" } };
const uncertainRow = rowOf(billReadSections(billOf(uncertain)), "TECHNICAL", "Consumo F2");
assert.equal(uncertainRow.state, "REVIEW");
assert.equal(uncertainRow.value, "354,44 kWh", "the value stays as read");
assert.equal(rowOf(sections, "TECHNICAL", "Consumo F2").state, "READ");

// 2. Not read and not declared absent: "Non letto", never "Non presente nella fattura".
const bare = parseBillReading({ ...reading, potenzaMassimaPrelevataKw: "", mercato: "", spread: "", assenti: [] });
const bareSections = billReadSections(billOf(toStructuredBill({ reading: bare, checks: [], reread: false })));
assert.deepEqual(rowOf(bareSections, "TECHNICAL", "Potenza massima prelevata"), { label: "Potenza massima prelevata", value: NOT_READ, state: "NOT_READ" });
assert.equal(rowOf(bareSections, "CONTRACT", "Spread contrattuale (stampato)").value, NOT_READ);
assert.equal(rowOf(bareSections, "TECHNICAL", "Potenza disponibile").state, "NOT_READ");

// Conditions without an end date are not a contract without an end date.
const openConditions = parseBillReading({ ...reading, scadenzaCondizioni: "tempo indeterminato", scadenzaContratto: "", assenti: [{ campo: "scadenzaContratto", motivo: "non stampato" }] });
const openSections = billReadSections(billOf(toStructuredBill({ reading: openConditions, checks: [], reread: false })));
assert.equal(rowOf(openSections, "CONTRACT", "Scadenza condizioni economiche").value, "Condizioni economiche a tempo indeterminato");
assert.equal(rowOf(openSections, "CONTRACT", "Scadenza contratto").value, NOT_IN_BILL);

// 7. Other bill types: a household summary bill (no detail rows) and a gas bill.
const household = parseBillReading({ ...reading, tipoCliente: "DOMESTICO", tipoClienteStampato: "Domestico residente", tensioneStampata: "", dettaglio: [], scontrino: reading.scontrino, pcvMensile: "", assenti: [] });
const householdSections = billReadSections(billOf(toStructuredBill({ reading: household, checks: [], reread: false })));
assert.equal(rowOf(householdSections, "SUPPLY", "Tipologia cliente").value, "Domestico residente");
assert.equal(rowOf(householdSections, "TECHNICAL", "Tensione di alimentazione").value, "Bassa tensione (BT)");
assert.equal(rowOf(householdSections, "ECONOMICS", "Accise e IVA").value, "254,49 €", "without detail rows the printed 'Accise e IVA' is shown as printed");
assert.equal(rowOf(householdSections, "ECONOMICS", "Oneri generali di sistema").state, "ABSENT");
const gas = parseBillReading({ ...reading, vettore: "GAS", pod: "", pdr: "01234567890123", consumoFatturato: "120", consumoSmc: "120", consumoF1: "", consumoF2: "", consumoF3: "", consumoAnnuo: "1.400", dettaglio: [], assenti: [] });
const gasSections = billReadSections(billOf(toStructuredBill({ reading: gas, checks: [], reread: false }), "GAS"), []);
assert.equal(rowOf(gasSections, "SUPPLY", "PDR").value, "01234567890123");
assert.equal(rowOf(gasSections, "TECHNICAL", "Consumo complessivo fatturato").value, "120 Smc");
assert.equal(rowOf(gasSections, "TECHNICAL", "Consumo F1"), undefined);
assert.equal(rowOf(gasSections, "TECHNICAL", "Potenza impegnata"), undefined);
// A bill read before the structured reading existed shows no sections, as before.
assert.deepEqual(billReadSections({ fields: {}, structuredBill: null, analystReview: review(null), resolvedVector: "EE" }), []);

assert.equal(italianDecimal(2672.07), "2.672,07");
assert.equal(italianDecimal(29306), "29.306");
assert.equal(italianDecimal(-0.01), "-0,01");

// 8. The screen: sections in "Dati letti", the seven confirmable fields and the offers step unchanged.
const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
// Tony (10/11/2026, visibilità per ruolo): the screen reads the bill view every user who may open the bill receives.
assert.match(flow, /<BillReadDetails sections=\{billReadSections\(readBill\)\} calculated=\{calculatedFacts\(readBill\)\} \/>/);
assert.match(flow, /\{ name: "customerName", label: "Intestatario" \}, \{ name: "supplier", label: "Fornitore attuale" \}/);
assert.match(flow, /<BillSummary context=\{quote\.context\} bill=\{quote\.bill\} \/>/);
assert.match(flow, /label: `Spread sul \$\{index\} \(calcolato\)`/, "the calculated spread stays labelled as calculated");
// Tony (10/11/2026, "semplificazione"): the printed spread first; calculated price type, structure, spread and PCV only when
// the bill does not print them (or prints a different PCV); the editable fields folded, opened when one is empty.
assert.match(flow, /\.\.\.\(printed\.spread \? \[\] : \[\{ label: `Spread sul \$\{index\} \(calcolato\)`/);
assert.match(flow, /\.\.\.\(printed\.priceType \? \[\] : \[\{ label: "Tipo di prezzo"/);
assert.match(flow, /\.\.\.\(printed\.priceStructure \? \[\] : \[\{ label: `Struttura del \$\{index\}`/);
assert.match(flow, /const pcvShown = pcv === null \? printed\.monthlyPcv === null : printed\.monthlyPcv === null \|\| Math\.abs\(printed\.monthlyPcv - pcv\) >= 0\.005;/);
assert.match(flow, /<details className="bill-read-correct" open=\{correctionOpen\} onToggle=\{\(event\) => setCorrectionOpen\(event\.currentTarget\.open\)\}>/);
assert.match(flow, /setCorrectionOpen\(FIELDS\.some\(\(field\) => !\(next\[field\.name\] \?\? ""\)\.trim\(\)\)\)/, "opened when a field to confirm is empty");
assert.match(flow, /if \(missing\.length\) \{ setCorrectionOpen\(true\);/, "and when the search finds one missing");
assert.equal((flow.match(/startReview\(document\);/g) ?? []).length, 3, "upload, archive and re-read open the review the same way");
assert.doesNotMatch(flow, /readingAbsent\?\.some/, "the 'not printed' reasons are said once, on their rows");
const component = await readFile("app/components/BillReadDetails.tsx", "utf8");
assert.match(component, /Valori calcolati o classificati dal simulatore/);
assert.match(component, /READ: "Letto", ABSENT: "Non presente", REVIEW: "Da verificare", CALCULATED: "Calcolato", NOT_READ: "Non letto"/);

console.log("bill-read-details OK");
