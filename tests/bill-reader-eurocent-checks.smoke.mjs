import assert from "node:assert/strict";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { checkBillReading, unitPriceInEuro } from "../app/lib/reading/bill-reader-checks.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";

// Tony (10/11/2026, fattura EE20369/2026): the quantity × price check read prices in Eurocent as euro and flagged correct
// amounts ("1 × 49,020000 = 49.02 € ma l'importo letto è 0,49 €"). Synthetic bill: no real customer, POD or supplier data.

const scontrino = (etichetta, tipo, quota, importo) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2 });
const detail = (descrizione, voce, quantita, unita, prezzo, unitaPrezzo, importo, fascia = "NESSUNA") => ({ descrizione, voce, fascia, periodo: "", quantita, unita, prezzo, unitaPrezzo, importo, pagina: 3 });

const base = {
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "Venditore di prova", intestatario: "CLIENTE DI PROVA", pod: "IT000E00000000", tipoClienteStampato: "Altri usi", tensioneStampata: "380 V",
  potenzaImpegnataKw: "15", periodoStampato: "01/09/2026 - 30/09/2026", periodoDal: "2026-09-01", periodoAl: "2026-09-30",
  consumoFatturato: "100", consumoF1: "50", consumoF2: "20", consumoF3: "30", totaleBolletta: "10,00",
  scontrino: [scontrino("Quota fissa", "QUOTA_TOTALE", "FISSA", "10,00"), scontrino("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "10,00")],
};
const reading = (dettaglio) => parseBillReading({ ...base, dettaglio });
const productChecks = (dettaglio) => checkBillReading(reading(dettaglio)).filter((check) => check.code === "PRODUCT");

// The four rows of the verified case, in Eurocent: no false alarm.
const eurocentRows = [
  detail("Distribuzione fissa", "TRASPORTO_QUOTA_FISSA", "1", "mesi", "49,020000", "Eurocent/mese", "0,49"),
  detail("UC6 fissa", "TRASPORTO_QUOTA_FISSA", "1", "mesi", "14,020000", "Eurocent/mese", "0,14"),
  detail("ASOS fissa", "ONERI_ASOS", "1", "mesi", "110,280000", "Eurocent/mese", "1,10"),
  detail("ARIM fissa", "ONERI_ARIM", "1", "mesi", "25,690000", "Eurocent/mese", "0,26"),
];
assert.deepEqual(productChecks(eurocentRows), [], "Eurocent/mese prices are converted to euro before the check");

// Other cent spellings, per kWh and per month.
assert.deepEqual(productChecks([
  detail("Energia F1", "PREZZO_ENERGIA", "1.000", "kWh", "21,835", "c€/kWh", "218,35", "F1"),
  detail("Quota fissa", "TRASPORTO_QUOTA_FISSA", "2", "mesi", "182,0575", "centesimi di euro/mese", "3,64"),
  detail("Accisa", "ACCISE", "2.672", "kWh", "1,25", "cent€/kWh", "33,40"),
]), [], "c€/kWh, centesimi di euro/mese and cent€/kWh are cents");

// Euro prices keep working as before: €/kWh, €/mese, Euro/POD/mese, Euro/KWH.
assert.deepEqual(productChecks([
  detail("Energia F1", "PREZZO_ENERGIA", "1.791,00", "kWh", "0,218350", "Euro/KWH", "391,06", "F1"),
  detail("Commercializzazione", "PCV", "1", "mesi", "10,392500", "Euro/POD/mese", "10,39"),
  detail("Quota fissa vendita", "PCV", "1", "mesi", "10,39", "€/mese", "10,39"),
  detail("Trasmissione", "TRASPORTO_ENERGIA", "2.672,00", "kWh", "0,011900", "€/kWh", "31,80"),
]), [], "euro prices are not divided");

// A real error is still found, in euro and in cents.
const euroWrong = productChecks([detail("Energia F1", "PREZZO_ENERGIA", "1.000", "kWh", "0,218350", "€/kWh", "21,84", "F1")]);
assert.equal(euroWrong.length, 1, "a euro amount that does not match is still flagged");
const centWrong = productChecks([detail("ASOS fissa", "ONERI_ASOS", "1", "mesi", "110,280000", "Eurocent/mese", "110,28")]);
assert.equal(centWrong.length, 1, "an amount read as cents where euro were billed is still flagged");
assert.match(centWrong[0].message, /110,280000/, "the message quotes the price as printed");

// Monetary rounding: 0,4902 € billed as 0,49 €, 1,1028 € as 1,10 € (tolerance 2 cents or 0,5%, unchanged).
assert.equal(unitPriceInEuro(49.02, "Eurocent/mese") * 1, 0.4902);
assert.equal(unitPriceInEuro(0.21835, "€/kWh"), 0.21835);
assert.equal(unitPriceInEuro(0.21835, "Euro/KWH"), 0.21835);
assert.equal(unitPriceInEuro(10.3925, "Euro/POD/mese"), 10.3925);

// Power rows per kW per month are still skipped (the months are not in the quantity), in euro and in cents.
assert.deepEqual(productChecks([
  detail("Distribuzione potenza", "TRASPORTO_POTENZA", "15,0", "kW", "288,933333", "Eurocent/KW/mese", "43,34"),
  detail("Quota potenza", "TRASPORTO_POTENZA", "15,0", "kW", "4,492667", "€/kW/mese", "67,39"),
]), []);

// Value and unit read from the bill are kept as printed: the check does not rewrite them.
const bill = toStructuredBill({ reading: reading(eurocentRows), checks: checkBillReading(reading(eurocentRows)), reread: false });
const fixed = bill.economicChargeLines.find((line) => /Distribuzione fissa/.test(line.description));
assert.equal(fixed?.unitPrice, "49,020000");
assert.equal(fixed?.unit, "Eurocent/mese");
assert.equal(fixed?.amount, "0,49");
// Tony (13/11/2026): this fixture returns no printed components, which is now reported on its own; the Eurocent rows still
// raise no warning (expectation narrowed to the warnings this test is about).
assert.deepEqual(bill.readingChecks.filter((message) => !/^Componenti stampate/.test(message)), [], "no 'Da controllare' warning for the Eurocent rows");

console.log("bill-reader eurocent checks OK");
