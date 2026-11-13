import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { buildBillAnalystReview } from "../app/lib/foundation/bill-analyst-review.ts";
import { billReadSections, italianDecimal, NOT_IN_BILL, NOT_READ, printedContractValues, segmentRepeatsUse } from "../app/lib/ui/bill-read-details.ts";
import { BANDS_SUM_TOLERANCE_KWH } from "../app/lib/reading/bill-reader-checks.ts";

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
assert.deepEqual(rowOf(sections, "SUPPLY", "Fornitore"), { label: "Fornitore", value: "VENDITORE DI PROVA S.R.L.", state: "READ" });
assert.equal(rowOf(sections, "SUPPLY", "POD").value, "IT000E00000000");
assert.equal(rowOf(sections, "SUPPLY", "Uso").value, "altri usi");
assert.equal(rowOf(sections, "SUPPLY", "Mercato").value, "MERCATO LIBERO");
assert.equal(rowOf(sections, "SUPPLY", "Periodo").value, "01/09/2026 - 30/09/2026");
assert.equal(rowOf(sections, "SUPPLY", "Indirizzo"), undefined, "the reader does not read the address: no row is invented");

// B. Caratteristiche tecniche, with the precision printed.
assert.equal(rowOf(sections, "TECHNICAL", "Tensione").value, "380,0 V · bassa tensione (BT)");
assert.equal(rowOf(sections, "TECHNICAL", "Potenza impegnata").value, "15,0 kW");
assert.equal(rowOf(sections, "TECHNICAL", "Potenza massima").value, "15,0 kW");
// 2. Missing data: declared not printed by the reader.
assert.deepEqual(rowOf(sections, "TECHNICAL", "Potenza disponibile"), { label: "Potenza disponibile", value: NOT_IN_BILL, state: "ABSENT", note: "non stampato", secondary: true });
// 6. F0, F1, F2, F3 kept as read. Tony (10/11, "semplificazione"): the sum is not a second total, its gap is a discreet note.
// Tony (11/11/2026, "visualizzazione consumi"): kWh shown without decimals, mathematically rounded; the data keep the value.
assert.equal(rowOf(sections, "TECHNICAL", "Consumo totale (F0)").value, "2.672 kWh");
// Tony (11/11/2026, "pulizia finale"): a gap within the tolerance of the reading check (1 kWh) is not written next to F0; it
// stays on the value (on demand). A gap above the tolerance stays in view as a warning.
assert.match(rowOf(sections, "TECHNICAL", "Consumo totale (F0)").note, /F1 \+ F2 \+ F3 = 2\.672 kWh, scostamento 0,01 kWh entro la tolleranza \(calcolato\)/);
assert.equal(rowOf(sections, "TECHNICAL", "Consumo totale (F0)").noteShown, undefined, "a gap within the tolerance is not in view");
assert.equal(BANDS_SUM_TOLERANCE_KWH, 1, "the tolerance of the reading check is unchanged");
const farBands = { ...structuredBill, f3Consumption: { ...structuredBill.f3Consumption, value: 530.62 } };
const farF0 = rowOf(billReadSections(billOf(farBands)), "TECHNICAL", "Consumo totale (F0)");
assert.equal(farF0.noteShown, true, "a gap above the tolerance stays in view");
assert.match(farF0.note, /^Attenzione: F1 \+ F2 \+ F3 = 2\.676 kWh, scostamento di 4,01 kWh dal consumo totale, oltre la tolleranza di 1 kWh \(calcolato\)$/);
assert.equal(farF0.value, "2.672 kWh", "F0 is shown rounded, never replaced by the sum");
const atTolerance = { ...structuredBill, f3Consumption: { ...structuredBill.f3Consumption, value: 527.61 } };
assert.equal(rowOf(billReadSections(billOf(atTolerance)), "TECHNICAL", "Consumo totale (F0)").noteShown, undefined, "1 kWh exactly is within the tolerance, as in the reading check");
const noTotal = { ...structuredBill, billedConsumption: { ...structuredBill.billedConsumption, status: "NOT_FOUND", value: null } };
assert.equal(rowOf(billReadSections(billOf(noTotal)), "TECHNICAL", "Consumo totale (F0)").noteShown, true, "without a printed total the sum of the bands stays in view");
assert.equal(rowOf(sections, "TECHNICAL", "F1").value, "1.791 kWh");
assert.equal(rowOf(sections, "TECHNICAL", "F2").value, "354 kWh");
assert.equal(rowOf(sections, "TECHNICAL", "F3").value, "527 kWh", "526,62 rounds up");
// The gap keeps two decimals (a consistency check, Tony 11/11/2026), also when the bands are printed with one.
const oneDecimal = { ...structuredBill, f3Consumption: { ...structuredBill.f3Consumption, value: 526.7 } };
assert.match(rowOf(billReadSections(billOf(oneDecimal)), "TECHNICAL", "Consumo totale (F0)").note, /F1 \+ F2 \+ F3 = 2\.672 kWh, scostamento 0,09 kWh entro la tolleranza/);
// The total is the printed F0, never the sum of the rounded bands: 1.791 + 354 + 527 = 2.672 here, but a bill whose rounded
// bands add up to 1 kWh more still shows its own total.
const roundedApart = { ...structuredBill, billedConsumption: { ...structuredBill.billedConsumption, value: 2671.6 }, f1Consumption: { ...structuredBill.f1Consumption, value: 1790.5 }, f2Consumption: { ...structuredBill.f2Consumption, value: 354.5 }, f3Consumption: { ...structuredBill.f3Consumption, value: 526.6 } };
const roundedApartRows = billReadSections(billOf(roundedApart));
assert.deepEqual(["Consumo totale (F0)", "F1", "F2", "F3"].map((label) => rowOf(roundedApartRows, "TECHNICAL", label).value), ["2.672 kWh", "1.791 kWh", "355 kWh", "527 kWh"]);
assert.equal(roundedApart.billedConsumption.value, 2671.6, "the reading keeps the full value");
assert.equal(rowOf(sections, "TECHNICAL", "Somma F1 + F2 + F3"), undefined, "no second consumption total");
const matching = { ...structuredBill, f3Consumption: { ...structuredBill.f3Consumption, value: 526.61 } };
assert.equal(rowOf(billReadSections(billOf(matching)), "TECHNICAL", "Consumo totale (F0)").note, undefined, "no note when F1+F2+F3 matches");
assert.equal(structuredBill.billedConsumption.value, 2672.07, "the billed total is not altered");
assert.deepEqual([structuredBill.f1Consumption.value, structuredBill.f2Consumption.value, structuredBill.f3Consumption.value], [1791.02, 354.44, 526.62]);
assert.equal(rowOf(sections, "TECHNICAL", "Consumo annuo").value, "29.306 kWh");

// C. Contratto. 4. The printed spread is shown as printed; the PCV as printed with its unit.
assert.equal(rowOf(sections, "CONTRACT", "Offerta").value, "OFFERTA DI PROVA · codice CODICEPROVA01");
assert.equal(rowOf(sections, "CONTRACT", "Decorrenza condizioni").value, "01/05/2026");
assert.equal(rowOf(sections, "CONTRACT", "Scadenza contratto").value, "Contratto a tempo indeterminato");
assert.deepEqual(rowOf(sections, "CONTRACT", "Scadenza condizioni"), { label: "Scadenza condizioni", value: NOT_IN_BILL, state: "ABSENT", note: "stampato 'n.d.' nel Box: nessuna data" });
assert.equal(rowOf(sections, "CONTRACT", "Prezzo").value, "a prezzo variabile");
assert.equal(rowOf(sections, "CONTRACT", "Fasce").value, "a fasce");
assert.equal(rowOf(sections, "CONTRACT", "Indice").value, "PUN");
assert.deepEqual(rowOf(sections, "CONTRACT", "Spread"), { label: "Spread", value: "0,012 €/kWh", state: "READ" });
const pcv = rowOf(sections, "CONTRACT", "PCV");
assert.equal(pcv.state, "READ");
// Tony (11/11/2026, "pulizia finale"): the monthly amount with two decimals; the printed unit price under "Altri dettagli".
assert.equal(pcv.value, "10,39 €/mese");
assert.equal(pcv.secondary, undefined);
assert.deepEqual(rowOf(sections, "CONTRACT", "PCV stampata (valore unitario)"), { label: "PCV stampata (valore unitario)", value: "10,392500 €/POD/mese · importo 10,39 €", state: "READ", note: "Commercializzazione e vendita", secondary: true });
const factPcv = parseBillReading({ ...reading, dettaglio: reading.dettaglio.filter((line) => line.voce !== "PCV") });
const factPcvBill = toStructuredBill({ reading: factPcv, checks: [], reread: false });
const factPcvRows = billReadSections(billOf(factPcvBill)).flatMap((item) => item.rows).filter((item) => /PCV/.test(item.label)).map(plain);
assert.deepEqual(factPcvRows.map((item) => `${item.label}=${item.value}${item.secondary ? " (dettagli)" : ""}`), ["PCV=10,39 €/mese", "PCV stampata (valore unitario)=10,392500 €/mese (dettagli)"], "the printed PCV without a detail row, rounded the same way");
// A PCV that is not monthly (or more than one PCV line) stays as printed, with no rounding.
const perKwhPcv = parseBillReading({ ...reading, dettaglio: reading.dettaglio.map((line) => line.voce === "PCV" ? { ...line, quantita: "2.672,07", unita: "kWh", prezzo: "0,003900", unitaPrezzo: "Euro/KWH", importo: "10,42" } : line) });
const perKwhRows = billReadSections(billOf(toStructuredBill({ reading: perKwhPcv, checks: [], reread: false }))).flatMap((item) => item.rows).filter((item) => /PCV/.test(item.label)).map(plain);
assert.deepEqual(perKwhRows.map((item) => `${item.label}=${item.value}`), ["PCV=0,003900 €/kWh · importo 10,42 €"]);
assert.equal(printedContractValues(billOf(structuredBill)).monthlyPcv, 10.3925, "the PCV in the data and in the comparison keeps its printed precision");
assert.equal(rowOf(sections, "CONTRACT", "Quota variabile smart (CVS)").value, "0,007713 €/kWh · importo 20,61 €");
assert.equal(rowOf(sections, "CONTRACT", "Quota variabile voci di trasporto").value, "0,010000 €/kWh · importo 26,72 €");

// D. Economics. 5. Printed values and the simulator's grouping are separate and labelled.
const economics = section(sections, "ECONOMICS").rows;
assert.equal(rowOf(sections, "ECONOMICS", "Vendita").value, "722,35 €");
assert.equal(rowOf(sections, "ECONOMICS", "Rete e oneri di sistema").value, "249,22 €");
const network = rowOf(sections, "ECONOMICS", "Rete e trasporto");
assert.equal(network.value, "134,30 €");
assert.equal(network.state, "CALCULATED", "the network share is a difference: labelled calculated");
assert.equal(rowOf(sections, "ECONOMICS", "Oneri di sistema").value, "114,92 €");
assert.equal(rowOf(sections, "ECONOMICS", "Accise").value, "33,40 €");
assert.equal(rowOf(sections, "ECONOMICS", "IVA").value, "221,09 €");
assert.deepEqual(rowOf(sections, "ECONOMICS", "Totale fattura"), { label: "Totale fattura", value: "1.226,06 €", state: "READ" }, "the components add up: the total once, no note");
assert.equal(rowOf(sections, "ECONOMICS", "Somma delle componenti stampate"), undefined, "the total is not repeated");
// 8. The simulator's grouping only where it differs from what the bill prints, always labelled.
const normalized = economics.filter((item) => item.group === "SIMULATOR").map(plain);
assert.deepEqual(normalized.map((item) => item.label), ["Vendita", "Rete e trasporto"], "equal groupings (oneri, accise e IVA) are not repeated");
assert.ok(normalized.every((item) => item.state === "CALCULATED" && /^in fattura \d/.test(item.note)));
// 1, 2, 7. No value shown twice: one row per label in the whole screen.
// Tony (10/11/2026, "ottimizzazione grafica"): the four compact sections, short labels, the bill's values once; the
// simulator's different groupings listed apart in their own block.
assert.deepEqual(sections.map((item) => item.title), ["Fornitura", "Consumi e potenza", "Contratto attuale", "Costi della bolletta"]);
const labels = sections.flatMap((entry) => entry.rows.filter((item) => item.group !== "SIMULATOR").map((item) => item.label));
assert.deepEqual(labels.filter((label, index) => labels.indexOf(label) !== index), []);
for (const label of ["Intestatario", "Fornitore", "POD", "Periodo", "Totale fattura", "Consumo totale (F0)"]) assert.equal(labels.filter((item) => item === label).length, 1, label);
// No information lost: the secondary values are still in their section, under "Altri dettagli".
const secondary = (id) => section(sections, id).rows.filter((item) => item.secondary).map((item) => `${item.label}=${plain(item).value}`);
assert.deepEqual(secondary("SUPPLY"), ["Mercato=MERCATO LIBERO"]);
// Tony (13/11/2026, "tensione visibile"): the supply voltage is always in view next to the powers (expectation changed: a
// low-voltage supply used to be under "Altri dettagli").
assert.deepEqual(secondary("TECHNICAL"), [`Potenza disponibile=${NOT_IN_BILL}`], "an unprinted available power is secondary");
const technicalLabels = section(sections, "TECHNICAL").rows.filter((item) => !item.secondary).map((item) => item.label);
assert.equal(technicalLabels.indexOf("Tensione") + 1, technicalLabels.indexOf("Potenza impegnata"), "voltage right before the powers");
assert.deepEqual(rowOf(sections, "TECHNICAL", "Tensione"), { label: "Tensione", value: "380,0 V · bassa tensione (BT)", state: "READ" }, "printed value and BT class kept");
assert.deepEqual(secondary("CONTRACT"), [`Attivazione=${NOT_READ}`, "Decorrenza condizioni=01/05/2026", "PCV stampata (valore unitario)=10,392500 €/POD/mese · importo 10,39 €"]);
// Tony (11/11/2026, "pulizia finale"): the economic summary in view holds the bill's values only; rete as a difference and
// oneri as a sum of the detail rows are under "Altri dettagli".
assert.deepEqual(secondary("ECONOMICS"), ["Rete e trasporto=134,30 €", "Oneri di sistema=114,92 €"], "calculated economic values one click away");
assert.ok(section(sections, "ECONOMICS").rows.filter((item) => !item.secondary && item.group !== "SIMULATOR").every((item) => item.state === "READ"), "only printed values in the economic summary");
for (const label of ["Intestatario", "Fornitore", "POD", "Periodo", "Consumo totale (F0)", "F1", "F2", "F3", "Potenza impegnata", "Potenza massima", "Prezzo", "Fasce", "Indice", "Spread", "PCV", "Scadenza condizioni", "Scadenza contratto", "Vendita", "Rete e oneri di sistema", "Accise", "IVA", "Totale fattura"]) {
  const found = sections.flatMap((entry) => entry.rows).find((item) => item.label === label && item.group !== "SIMULATOR");
  assert.ok(found && !found.secondary, `${label} is in view`);
}
// A zero commercial charge goes under "Altri dettagli"; a medium-voltage supply keeps its tension in view.
const zeroLines = structuredBill.economicChargeLines.map((line) => /smart/i.test(`${line.rawDescription ?? ""} ${line.description}`) ? { ...line, amount: "0", rawAmount: "0,00", unitPrice: "0", rawUnitPrice: "0,000000" } : line);
const zeroRow = rowOf(billReadSections(billOf({ ...structuredBill, economicChargeLines: zeroLines })), "CONTRACT", "Quota variabile smart (CVS)");
assert.equal(zeroRow.secondary, true, "a zero charge is not in view");
assert.equal(rowOf(sections, "CONTRACT", "Quota variabile smart (CVS)").secondary, undefined, "a charge with an amount stays in view");
const mv = { ...structuredBill, voltageLevel: { ...structuredBill.voltageLevel, value: "MV" }, supplyProfile: { ...structuredBill.supplyProfile, nominalVoltage: { ...structuredBill.supplyProfile.nominalVoltage, rawValue: "15.000 V" } } };
assert.equal(rowOf(billReadSections(billOf(mv)), "TECHNICAL", "Tensione").secondary, undefined, "medium voltage stays in view");
// 5, 6. What the bill prints for the contract, so the screen adds a calculated value only where it is missing or different.
assert.deepEqual(printedContractValues(billOf(structuredBill)), { priceType: "a prezzo variabile", priceStructure: "a fasce", spread: "0,012 €/kWh", monthlyPcv: 10.3925 });

// 3. Read and calculated are never mixed: every calculated row says so.
// The simulator's groupings are under their own heading ("Classificazione del simulatore, dove diversa dalla fattura").
for (const item of sections.flatMap((entry) => entry.rows)) if (item.state === "CALCULATED" && item.group !== "SIMULATOR") assert.match(item.note ?? "", /Calcolat|Somma|classificazione|Raggruppamento|Dedott/i, item.label);

// 3. "Da verificare" only when the data mark it.
const uncertain = { ...structuredBill, f2Consumption: { ...structuredBill.f2Consumption, status: "NEEDS_REVIEW" } };
const uncertainRow = rowOf(billReadSections(billOf(uncertain)), "TECHNICAL", "F2");
assert.equal(uncertainRow.state, "REVIEW");
assert.equal(uncertainRow.value, "354 kWh", "the value stays as read, shown without decimals");
assert.equal(rowOf(sections, "TECHNICAL", "F2").state, "READ");

// 2. Not read and not declared absent: "Non letto", never "Non presente nella fattura".
const bare = parseBillReading({ ...reading, potenzaMassimaPrelevataKw: "", mercato: "", spread: "", assenti: [] });
const bareSections = billReadSections(billOf(toStructuredBill({ reading: bare, checks: [], reread: false })));
assert.deepEqual(rowOf(bareSections, "TECHNICAL", "Potenza massima"), { label: "Potenza massima", value: NOT_READ, state: "NOT_READ" });
assert.equal(rowOf(bareSections, "CONTRACT", "Spread").value, NOT_READ);
assert.equal(rowOf(bareSections, "TECHNICAL", "Potenza disponibile").state, "NOT_READ");

// Conditions without an end date are not a contract without an end date.
const openConditions = parseBillReading({ ...reading, scadenzaCondizioni: "tempo indeterminato", scadenzaContratto: "", assenti: [{ campo: "scadenzaContratto", motivo: "non stampato" }] });
const openSections = billReadSections(billOf(toStructuredBill({ reading: openConditions, checks: [], reread: false })));
assert.equal(rowOf(openSections, "CONTRACT", "Scadenza condizioni").value, "Condizioni economiche a tempo indeterminato");
assert.equal(rowOf(openSections, "CONTRACT", "Scadenza contratto").value, NOT_IN_BILL);

// 7. Other bill types: a household summary bill (no detail rows) and a gas bill.
const household = parseBillReading({ ...reading, tipoCliente: "DOMESTICO", tipoClienteStampato: "Domestico residente", tensioneStampata: "", dettaglio: [], scontrino: reading.scontrino, pcvMensile: "", assenti: [] });
const householdSections = billReadSections(billOf(toStructuredBill({ reading: household, checks: [], reread: false })));
assert.equal(rowOf(householdSections, "SUPPLY", "Uso").value, "Domestico residente");
// Tony (11/11/2026, "pulizia finale"): the segment moves under "Altri dettagli" only when it repeats the printed use.
const householdBill = billOf(toStructuredBill({ reading: household, checks: [], reread: false }));
assert.equal(segmentRepeatsUse(householdBill, "RESIDENTIAL"), true, "Domestico → Consumer repeats the use");
assert.equal(segmentRepeatsUse(householdBill, "NON_RESIDENTIAL"), false, "a segment different from the use stays in view");
assert.equal(segmentRepeatsUse(billOf(structuredBill), "NON_RESIDENTIAL"), true, "altri usi → Business repeats the use");
assert.equal(segmentRepeatsUse(billOf(structuredBill), "RESIDENTIAL"), false);
assert.equal(segmentRepeatsUse(billOf(structuredBill), null), false, "an undetermined segment stays in view");
const noUse = parseBillReading({ ...reading, tipoClienteStampato: "", tipoCliente: "ALTRI_USI" });
assert.equal(segmentRepeatsUse(billOf(toStructuredBill({ reading: noUse, checks: [], reread: false })), "NON_RESIDENTIAL"), false, "without a printed use the segment stays in view");
assert.equal(rowOf(householdSections, "TECHNICAL", "Tensione").value, "Bassa tensione (BT)");
assert.equal(rowOf(householdSections, "TECHNICAL", "Tensione").secondary, undefined, "in view also without the volts");
// Not printed and not classified: nothing invented, the row stays in view as not printed or not read.
const noVoltage = parseBillReading({ ...reading, tensioneStampata: "", livelloTensione: "NON_DETERMINABILE", assenti: [{ campo: "tensioneStampata", motivo: "non stampata" }] });
const noVoltageRow = rowOf(billReadSections(billOf(toStructuredBill({ reading: noVoltage, checks: [], reread: false }))), "TECHNICAL", "Tensione");
assert.deepEqual([noVoltageRow.value, noVoltageRow.secondary], [NOT_IN_BILL, undefined]);
const unreadVoltage = parseBillReading({ ...reading, tensioneStampata: "", livelloTensione: "NON_DETERMINABILE", assenti: [] });
const unreadVoltageRow = rowOf(billReadSections(billOf(toStructuredBill({ reading: unreadVoltage, checks: [], reread: false }))), "TECHNICAL", "Tensione");
assert.deepEqual([unreadVoltageRow.value, unreadVoltageRow.secondary], [NOT_READ, undefined], "no voltage is invented");
assert.equal(rowOf(householdSections, "ECONOMICS", "Accise e IVA").value, "254,49 €", "without detail rows the printed 'Accise e IVA' is shown as printed");
// Tony (13/11/2026, BPower 071808E): system charges the reading did not take apart are "Non letto separatamente", not
// "Non presente nella fattura" (expectation changed from "ABSENT" by this requested behaviour).
assert.deepEqual([rowOf(householdSections, "ECONOMICS", "Oneri di sistema").state, rowOf(householdSections, "ECONOMICS", "Oneri di sistema").value], ["NOT_READ", "Non letto separatamente"]);
const gas = parseBillReading({ ...reading, vettore: "GAS", pod: "", pdr: "01234567890123", consumoFatturato: "120", consumoSmc: "120", consumoF1: "", consumoF2: "", consumoF3: "", consumoAnnuo: "1.400", dettaglio: [], assenti: [] });
const gasSections = billReadSections(billOf(toStructuredBill({ reading: gas, checks: [], reread: false }), "GAS"), []);
assert.equal(rowOf(gasSections, "SUPPLY", "PDR").value, "01234567890123");
assert.equal(rowOf(gasSections, "TECHNICAL", "Consumo totale (F0)").value, "120 Smc");
assert.equal(rowOf(gasSections, "TECHNICAL", "F1"), undefined);
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
// Tony (10/11/2026, "ottimizzazione grafica"): the calculated values carry the legend's asterisk, in the section they belong to.
assert.match(flow, /section: "CONTRACT" as const, label: `Spread sul \$\{index\}`/, "the calculated spread is a calculated fact of the contract");
assert.match(flow, /section: "CONTRACT" as const, secondary: true, label: "PUN GME del mese di riferimento"/, "the GME PUN stays, under Altri dettagli");
// Tony (10/11/2026, "semplificazione"): the printed spread first; calculated price type, structure, spread and PCV only when
// the bill does not print them (or prints a different PCV); the editable fields folded, opened when one is empty.
assert.match(flow, /\.\.\.\(printed\.spread \? \[\] : \[\{ section: "CONTRACT" as const, label: `Spread sul \$\{index\}`/);
assert.match(flow, /\.\.\.\(printed\.priceType \? \[\] : \[\{ section: "CONTRACT" as const, label: "Tipo di prezzo"/);
assert.match(flow, /\.\.\.\(printed\.priceStructure \? \[\] : \[\{ section: "CONTRACT" as const, label: `Struttura del \$\{index\}`/);
assert.match(flow, /const pcvShown = pcv === null \? printed\.monthlyPcv === null : printed\.monthlyPcv === null \|\| Math\.abs\(printed\.monthlyPcv - pcv\) >= 0\.005;/);
assert.match(flow, /<details className="bill-read-correct" open=\{correctionOpen\} onToggle=\{\(event\) => setCorrectionOpen\(event\.currentTarget\.open\)\}>/);
// Tony (12/11/2026, "CONSUMO ANNUO STIMATO"): the annual consumption is optional, so an empty one does not open the form.
assert.match(flow, /setCorrectionOpen\(reviewSubmission\(FIELDS\.map\(\(field\) => field\.name\), next, document\.fields\)\.missing\.length > 0\)/, "opened when a field to confirm is empty");
assert.match(flow, /if \(missing\.length\) \{ setCorrectionOpen\(true\);/, "and when the search finds one missing");
assert.equal((flow.match(/startReview\(document\);/g) ?? []).length, 3, "upload, archive and re-read open the review the same way");
assert.doesNotMatch(flow, /readingAbsent\?\.some/, "the 'not printed' reasons are said once, on their rows");
const component = await readFile("app/components/BillReadDetails.tsx", "utf8");
assert.match(component, /calcolato dal simulatore · gli altri valori sono quelli stampati in fattura/, "one legend instead of a label on every row");
assert.match(component, /<span className="visually-hidden"> \(calcolato dal simulatore\)<\/span>/, "the asterisk is read out by screen readers");
assert.match(component, /<summary>Altri dettagli \(\{more\.length\}\)<\/summary>/, "secondary values one click away");
// Tony (11/11/2026, "pulizia finale"): the simulator's different classification folded under its own heading.
assert.match(component, /<details className="bill-read-simulator">\s*<summary>Classificazione del simulatore: differenze dalla fattura \(\{simulator\.length\}\)<\/summary>/);
assert.match(flow, /\{ section: "SUPPLY", \.\.\.\(segmentRepeatsUse\(bill, type\) \? \{ secondary: true \} : \{\}\), label: "Segmento cliente"/, "the segment under Altri dettagli when it repeats the use");
assert.match(component, /review && !note \? <small className="bill-read-note">da verificare<\/small>/, "an uncertain value still says so");

console.log("bill-read-details OK");
