import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { recognizedDocumentType, toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { checkBillReading, printedComponentSum, withoutPrintedTotals } from "../app/lib/reading/bill-reader-checks.ts";
import { validateStructuredBillExtraction } from "../app/lib/ingestion/structured-bill.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { billForReading, billReadSections } from "../app/lib/ui/bill-read-details.ts";
import { buildQuoteReceipt, comparisonAnalysis } from "../app/lib/quote/receipt.ts";

// Tony (20/11/2026, "AUTORIZZAZIONE CORREZIONE LOCALE NORA", ELIOS EE20365/2026): ASOS 10,82 € and ARIM 0,15 € printed on one
// page and "Totale oneri generali di sistema" 10,97 € on another are oneri for 10,97 €, never 21,94 €. Never add an analytic
// row to its own subtotal; set a row aside only on category, period, nature and the documented relation between the parts and
// the total, never on equal amounts alone; two autonomous charges of the same amount both stay. Synthetic data: the amounts of
// the verified case, no real customer, POD or document number.

const row = (etichetta, categoria, importo, pagina = 3, sezione = "Oneri generali di sistema") => ({ etichetta, categoria, importo, sezione, pagina });
const sum = (rows, category) => Math.round(printedComponentSum(rows, category) * 100) / 100;

// 1. ELIOS: detail on page 3, total on page 6.
const elios = [
  row("Componente ASOS a copertura dei costi per il sostegno delle fonti rinnovabili", "ONERI_SISTEMA", "10,82"),
  row("Componente ARIM a copertura di altri oneri", "ONERI_SISTEMA", "0,15"),
  row("Totale oneri generali di sistema", "ONERI_SISTEMA", "10,97", 6, "Elementi di dettaglio"),
  row("Totale tariffa per l'uso della rete elettrica", "TRASPORTO_RETE", "13,27", 6, "Elementi di dettaglio"),
];
assert.equal(sum(elios, "ONERI_SISTEMA"), 10.97, "10,97 is the total of ASOS and ARIM, not one more charge");
assert.equal(sum(elios, "TRASPORTO_RETE"), 13.27, "a total printed without its parts stays");

// 2. Subtotal and detail in the same invoice, same page.
const transport = [
  row("Quota fissa", "TRASPORTO_RETE", "1,92", 4, "Trasporto"), row("Quota potenza", "TRASPORTO_RETE", "5,93", 4, "Trasporto"), row("Quota energia", "TRASPORTO_RETE", "1,35", 4, "Trasporto"),
  row("Subtotale trasporto e gestione del contatore", "TRASPORTO_RETE", "9,20", 4, "Trasporto"),
];
assert.equal(sum(transport, "TRASPORTO_RETE"), 9.2);

// 3. Equal amounts, independent charges: both stay; equality alone never removes a row.
assert.equal(sum([row("ASOS", "ONERI_SISTEMA", "0,15"), row("ARIM", "ONERI_SISTEMA", "0,15")], "ONERI_SISTEMA"), 0.3);
assert.equal(sum([row("Componente A", "ONERI_SISTEMA", "5,00"), row("Componente B", "ONERI_SISTEMA", "5,00"), row("Componente C", "ONERI_SISTEMA", "10,00")], "ONERI_SISTEMA"), 20, "10,00 equals 5+5 but is not printed as their total");
assert.equal(sum([row("Accisa", "ACCISE", "1,00", 3, "Imposte"), row("Accisa", "ACCISE", "1,00", 3, "Imposte")], "ACCISE"), 2, "two equal rows on the same page are two charges");
assert.equal(sum([row("IVA 10%", "IVA", "5,72", 3, "Riepilogo IVA"), row("IVA 22% su altre partite", "IVA", "5,72", 5, "Altre partite")], "IVA"), 11.44, "same amount, different nature: both stay");

// 4. The same section repeated on another page is counted once; a total repeated is counted once.
const repeated = [
  row("Componente ASOS", "ONERI_SISTEMA", "10,82", 3), row("Componente ARIM", "ONERI_SISTEMA", "0,15", 3),
  row("Componente ASOS", "ONERI_SISTEMA", "10,82", 7), row("Componente ARIM", "ONERI_SISTEMA", "0,15", 7),
];
assert.equal(sum(repeated, "ONERI_SISTEMA"), 10.97);
assert.equal(sum([row("Totale oneri di sistema", "ONERI_SISTEMA", "10,97", 2, "Riepilogo"), row("Totale oneri generali di sistema", "ONERI_SISTEMA", "10,97", 6)], "ONERI_SISTEMA"), 10.97);

// 5. Different periods: a total covers only the parts of its own printed period.
const periods = [
  row("Componente ASOS", "ONERI_SISTEMA", "10,82"), row("Componente ARIM", "ONERI_SISTEMA", "0,15"),
  row("Ricalcolo oneri dal 01/08/2026 al 31/08/2026", "ONERI_SISTEMA", "3,00", 5, "Ricalcoli"),
  row("Totale oneri dal 01/08/2026 al 31/08/2026", "ONERI_SISTEMA", "3,00", 5, "Ricalcoli"),
  row("Totale oneri generali di sistema", "ONERI_SISTEMA", "10,97", 6),
];
assert.equal(sum(periods, "ONERI_SISTEMA"), 13.97, "August 3,00 counted once, September 10,97 counted once");
assert.equal(sum([row("Componente ASOS", "ONERI_SISTEMA", "10,97"), row("Totale oneri settembre 2026", "ONERI_SISTEMA", "10,97", 6), row("Totale oneri agosto 2026", "ONERI_SISTEMA", "10,97", 6)], "ONERI_SISTEMA"), 32.91,
  "totals printed for other periods than their parts are not removed across periods: kept as printed (the printed-total check then asks to re-read)");
assert.equal(withoutPrintedTotals([{ a: 10.97, l: "Totale oneri", p: "Oneri" }], (x) => ({ amount: x.a, label: x.l, section: x.p, page: 6 })).length, 1, "a total alone stays");

// 6. One PDF with sintetica and dettaglio (ELIOS layout): no "rileggi" on the components, recognized as one PDF holding both.
const sc = (etichetta, tipo, quota, importo) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2 });
const dt = (descrizione, voce, importo) => ({ descrizione, voce, fascia: "NESSUNA", periodo: "", quantita: "", unita: "", prezzo: "", unitaPrezzo: "", importo, pagina: 6 });
const reading = parseBillReading({
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "DOMESTICO", livelloTensione: "BT", fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "CLIENTE DI PROVA",
  pod: "IT000E00000099", periodoDal: "2026-09-01", periodoAl: "2026-09-30", consumoFatturato: "92,42", consumoF1: "31,31", consumoF2: "22,03", consumoF3: "39,07", totaleBolletta: "62,90",
  scontrino: [
    sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "32,97"), sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "CONSUMI", "24,50"), sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "8,47"),
    sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "16,19"), sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "FISSA", "6,35"), sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "9,84"),
    sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "5,93"), sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "5,93"),
    sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "7,81"), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "62,90"),
  ],
  dettaglio: [dt("Asos - Quota fissa", "ONERI_ASOS", "7,92"), dt("Asos - Quota energia", "ONERI_ASOS", "2,90"), dt("Arim - Quota energia", "ONERI_ARIM", "0,15")],
  componentiStampate: [...elios, row("Accisa sull'energia elettrica", "ACCISE", "2,09", 3, "Imposte"), row("Aliquota ridotta 10%", "IVA", "5,72", 3, "Riepilogo IVA")],
});
assert.equal(recognizedDocumentType(reading), "BOLLETTA_COMPLETA");
assert.equal(checkBillReading(reading).some((check) => check.code === "COMPONENTS_NETWORK_SYSTEM"), false, "13,27 + 10,97 = 24,24, the printed rete e oneri");
const doubled = parseBillReading({ ...JSON.parse(JSON.stringify(reading)), componentiStampate: [...elios.slice(0, 2), row("Oneri generali di sistema", "ONERI_SISTEMA", "10,97", 6), elios[3]] });
assert.equal(checkBillReading(doubled).some((check) => check.code === "COMPONENTS_NETWORK_SYSTEM"), true, "without the word total the relation is not documented: the check still asks to re-read");
validateStructuredBillExtraction(toStructuredBill({ reading, checks: [], reread: false }));

// 7. The ELIOS case end to end (synthetic copy of the read amounts): "Dati letti" and the comparison.
const structured = JSON.parse(await readFile(new URL("./fixtures/elios-oneri-totale-sintetica.json", import.meta.url), "utf8"));
validateStructuredBillExtraction(structured);
const root = await mkdtemp(path.join(os.tmpdir(), "printed-totals-"));
try {
  const document = await ingestBill({ tenantId: "tenant_prova-t", fileName: "prova-t.pdf", contentType: "application/pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.7 prova-t", "latin1")), maxBytes: 100_000, storage: new LocalDocumentStorage(root), repository: new LocalBillRepository(root), audit: { async record() {} }, structuredExtractor: { async extract() { return structured; } } });
  assert.deepEqual(document.versions[0].structuredBill.printedComponents, structured.printedComponents, "the reading is stored as printed: nothing removed from the document");
  const shown = toPublicDocument(document);
  const rows = Object.fromEntries(billReadSections(billForReading(shown)).find((section) => section.id === "ECONOMICS").rows.filter((item) => !item.group).map((item) => [item.label, item]));
  const plain = (value) => value.replace(/ /g, " ");
  assert.equal(plain(rows["Oneri di sistema"].value), "10,97 €");
  assert.equal(rows["Oneri di sistema"].state, "READ");
  assert.equal(JSON.stringify(rows).includes("21,94"), false, "21,94 is shown nowhere");
  const analysis = comparisonAnalysis(shown.analystReview.economics);
  assert.deepEqual([analysis.totals.billTotal, analysis.totals.systemChargesTotal, analysis.totals.regulatedNetworkTotal, analysis.totals.reconciliationDifference], [62.9, 10.97, 9.2, 0], "ELIOS total 62,90 kept; oneri 10,97; ARERA transport 9,20");
  const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 30, analysis, printedNetwork: 13.27, domestic: true, validUntil: null, offerComponents: [], warnings: [] });
  const seller = receipt.rows.find((item) => item.key === "ENERGY");
  const commercialization = seller.details.find((item) => item.key === "COMMERCIALIZATION");
  assert.equal(commercialization.current, 4.07, "CVS 3,15 + quota variabile voci di trasporto 0,92 stay in the ELIOS cost");
  assert.equal(commercialization.label, "Commercializzazione: Quota variabile smart (CVS), Quota variabile voci di trasporto");
  assert.equal(commercialization.offer, null, "the 4,07 € are not carried into the simulated offer");
  assert.equal(receipt.currentTotal, 62.9);
  assert.equal(receipt.rows.find((item) => item.key === "SYSTEM").current, 10.97);
  assert.equal(receipt.rows.find((item) => item.key === "NETWORK").current, 9.2, "CVS and seller transport quota are never ARERA transport");
} finally { await rm(root, { recursive: true, force: true }); }

console.log("PASS printed totals: analytic rows never added to their own total; independent equal charges kept");
