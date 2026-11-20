import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { ingestBill, linkBillDetail, BillDetailLinkError, LocalBillRepository, LocalDocumentStorage, toPublicDocument, validateStoredDocument } from "../app/lib/foundation/real-bill.ts";
import { billDetailCoherence } from "../app/lib/foundation/bill-detail-link.ts";
import { classifyBillEconomicComponent } from "../app/lib/foundation/bill-economic-analysis.ts";
import { billForReading, billReadSections } from "../app/lib/ui/bill-read-details.ts";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";
import { areraNote } from "../app/lib/quote/offer-scontrino.ts";

// Tony (19/11/2026, "APPROVATO — PREVALENZA DETTAGLIO PER COMPONENTI, SINTETICA PER TOTALE"), caso di regressione 072248E:
// sintetica and fattura di dettaglio issued as two PDFs. Synthetic documents with the same amounts as the verified case; no real
// customer, POD, supplier or document number.

const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const comp = (etichetta, categoria, importo) => ({ etichetta, categoria, importo, sezione: categoria === "ONERI_SISTEMA" ? "Oneri generali di sistema" : "Imposte", pagina: 5 });
const d = (descrizione, voce, fascia, periodo, quantita, unita, prezzo, unitaPrezzo, importo, pagina = 2) => ({ descrizione, voce, fascia, periodo, quantita, unita, prezzo, unitaPrezzo, importo, pagina });
const OCT = "01/10/2026 - 31/10/2026";
const DETAIL = [
  d("Dispacciamento (quote variabili)", "DISPACCIAMENTO", "NESSUNA", "01/08/2026 - 31/08/2026", "1", "kWh", "-0,010000", "€/kWh", "-0,01", 1),
  d("Dispacciamento (quote variabili)", "DISPACCIAMENTO", "NESSUNA", "01/09/2026 - 30/09/2026", "1", "kWh", "-0,010000", "€/kWh", "-0,01", 2),
  d("Energia Attiva F1", "PREZZO_ENERGIA", "F1", OCT, "70", "kWh", "0,258394", "€/kWh", "18,09"),
  d("Energia Attiva F2", "PREZZO_ENERGIA", "F2", OCT, "40", "kWh", "0,277135", "€/kWh", "11,09"),
  d("Energia Attiva F3", "PREZZO_ENERGIA", "F3", OCT, "56", "kWh", "0,240884", "€/kWh", "13,49"),
  d("Perdite di rete F1", "PERDITE", "F1", OCT, "7", "kWh", "0,258394", "€/kWh", "1,81"),
  d("Perdite di rete F2", "PERDITE", "F2", OCT, "4", "kWh", "0,277135", "€/kWh", "1,11"),
  d("Perdite di rete F3", "PERDITE", "F3", OCT, "6", "kWh", "0,240884", "€/kWh", "1,45"),
  d("Corrispettivo mercato capacità (quote variabili)", "CAPACITA", "NESSUNA", OCT, "183", "kWh", "0,010423", "€/kWh", "1,91"),
  d("Dispacciamento (quote variabili)", "DISPACCIAMENTO", "NESSUNA", OCT, "183", "kWh", "0,009888", "€/kWh", "1,81"),
  d("Commercializzazione", "COMMERCIALIZZAZIONE_VARIABILE", "NESSUNA", OCT, "183", "kWh", "0,003324", "€/kWh", "0,61"),
  d("Sbilanciamento", "SBILANCIAMENTO", "NESSUNA", OCT, "183", "kWh", "0,005540", "€/kWh", "1,01"),
  d("QF", "PCV", "NESSUNA", OCT, "1", "POD/mese", "15,000000", "€/POD/mese", "15,00"),
  d("Trasporto (quote variabili)", "TRASPORTO_ENERGIA", "NESSUNA", OCT, "166", "kWh", "0,015422", "€/kWh", "2,56"),
  d("Trasporto (quote fisse)", "TRASPORTO_QUOTA_FISSA", "NESSUNA", OCT, "1", "POD/mese", "2,410000", "€/POD/mese", "2,41"),
  d("Trasporto (quote potenza)", "TRASPORTO_POTENZA", "NESSUNA", OCT, "3", "kW/mese", "2,599000", "€/kW/mese", "7,80"),
  d("Oneri di sistema (quote variabili)", "ONERI_ALTRI", "NESSUNA", OCT, "166", "kWh", "0,033494", "€/kWh", "5,56"),
  d("Oneri di sistema (quote fisse)", "ONERI_ALTRI", "NESSUNA", OCT, "1", "POD/mese", "1,330000", "€/POD/mese", "1,33"),
  d("Oneri di sistema (quote potenza)", "ONERI_ALTRI", "NESSUNA", OCT, "3", "kW/mese", "1,443333", "€/kW/mese", "4,33"),
  d("Imposte Erariali", "ACCISE", "NESSUNA", OCT, "166", "kWh", "0,012500", "€/kWh", "2,08"),
  d("Spese di sollecito", "ALTRE_PARTITE", "NESSUNA", OCT, "1", "POD/mese", "9,000000", "€/POD/mese", "9,00", 3),
];

const SINTETICA = {
  tipoDocumento: "BOLLETTA_SINTETICA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.P.A.", intestatario: "CLIENTE DI PROVA", pod: "IT000E00000001", tipoClienteStampato: "Altri usi", tensioneStampata: "220 V",
  potenzaImpegnataKw: "3", periodoStampato: "Ottobre 2026", periodoDal: "2026-10-01", periodoAl: "2026-10-31", dataEmissione: "2026-11-06", numeroDocumento: "000001P",
  consumoFatturato: "166", consumoF1: "70", consumoF2: "40", consumoF3: "56", totaleBolletta: "122,98",
  offertaNome: "OFFERTA DI PROVA", offertaCodice: "CODICEPROVA", tipologiaOfferta: "VARIABILE", indice: "PUN", spread: "0,025000 €/kWh", pcvMensile: "15,00",
  scontrino: [
    sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "60,50", { quantita: "166", unita: "kWh", prezzoMedio: "0,364458", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "CONSUMI", "51,10", { prezzoMedio: "0,307831", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "9,40", { prezzoMedio: "0,056627", unitaPrezzo: "€/kWh" }),
    sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "18,74", { quantita: "1", unita: "mesi", prezzoMedio: "18,74", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "FISSA", "15,00", { prezzoMedio: "15,00", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "3,74", { prezzoMedio: "3,74", unitaPrezzo: "€/mese" }),
    sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "12,13", { quantita: "3,0", unita: "kW per 1 mese", prezzoMedio: "4,043333", unitaPrezzo: "€/kW/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "12,13", { prezzoMedio: "4,043333", unitaPrezzo: "€/kW/mese" }),
    sc("Spese di sollecito", "ALTRE_PARTITE", "NESSUNA", "9,00"),
    sc("Totale ricalcoli", "RICALCOLI", "NESSUNA", "-0,02"),
    sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "22,63"),
    sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "122,98"),
  ],
  componentiStampate: [
    comp("Imposte erariali (primo scaglione): 166 kWh x 0,0125 €/kWh", "ACCISE", "2,08"), comp("IVA vendite 22%", "IVA", "20,55"),
    comp("Componente ASOS - quota potenza", "ONERI_SISTEMA", "3,51"), comp("Componente ASOS - quota per consumi", "ONERI_SISTEMA", "5,29"), comp("Componente ASOS - quota fissa", "ONERI_SISTEMA", "1,08"),
    comp("Componente ARIM - quota potenza", "ONERI_SISTEMA", "0,82"), comp("Componente ARIM - quota per consumi", "ONERI_SISTEMA", "0,27"), comp("Componente ARIM - quota fissa", "ONERI_SISTEMA", "0,25"),
  ],
  dettaglio: [], assenti: [],
};
// The fattura di dettaglio as a PDF of its own: no quadro sintetico, its total is the taxable amount (102,43).
const DETTAGLIO = { ...SINTETICA, tipoDocumento: "FATTURA_DETTAGLIO", totaleBolletta: "102,43", scontrino: [], componentiStampate: [], dettaglio: DETAIL };
const structured = (reading) => toStructuredBill({ reading: parseBillReading(reading), checks: [], reread: false });
const extractor = (bill) => ({ async extract() { return bill; } });
const pdf = (text) => new Uint8Array(Buffer.from(`%PDF-1.7 ${text}`, "latin1"));
const audit = () => { const events = []; return { events, async record(event) { events.push(event); } }; };
const analysisOf = (document) => toPublicDocument(document).analystReview.economics.economicAnalysis;
const off = (label, category, amount, code) => ({ label, category, sign: "CHARGE", amount: { amount, currency: "EUR" }, formulaInputs: { componentCode: code } });
const offerComponents = [
  off("BTA2 quota fissa distribuzione", "REGULATED_FIXED", 0.45, "NETWORK_FIXED"), off("BTA2 quota misura", "REGULATED_FIXED", 1.82, "METERING_FIXED"), off("BTA2 UC6 quota fissa", "REGULATED_FIXED", 0.14, "UC6_FIXED"),
  off("BTA2 ARIM quota fissa", "REGULATED_FIXED", 0.25, "ARIM"), off("BTA2 ASOS quota fissa", "REGULATED_FIXED", 1.08, "ASOS"),
  off("BTA2 quota potenza distribuzione", "REGULATED_POWER", 7.8, "NETWORK_POWER"), off("BTA2 ARIM quota potenza", "REGULATED_POWER", 0.82, "ARIM"), off("BTA2 ASOS quota potenza", "REGULATED_POWER", 3.51, "ASOS"),
  off("BTA2 energia distribuzione", "REGULATED_ENERGY", 0.11, "NETWORK_ENERGY"), off("BTA2 energia trasmissione", "REGULATED_ENERGY", 1.98, "TRANSMISSION_ENERGY"), off("BTA2 UC3", "REGULATED_ENERGY", 0.46, "UC3"), off("BTA2 UC6 energia", "REGULATED_ENERGY", 0.01, "UC6"),
  off("BTA2 ARIM energia", "REGULATED_ENERGY", 0.27, "ARIM"), off("BTA2 ASOS energia", "REGULATED_ENERGY", 5.29, "ASOS"),
];

const receiptOf = (analysis) => buildQuoteReceipt({ vector: "EE", offerSupplyCost: 67, analysis, domestic: false, validUntil: null, offerComponents });
const row = (receipt, key) => receipt.rows.find((item) => item.key === key);
// Amounts on screen use a non-breaking space before the euro sign: compared with plain spaces here.
const plain = (value) => typeof value === "string" ? value.replace(/\u00a0/g, " ") : value;
const economics = (document) => billReadSections(billForReading(toPublicDocument(document))).find((section) => section.id === "ECONOMICS").rows.map((item) => ({ ...item, value: plain(item.value), note: plain(item.note) }));

const root = await mkdtemp(path.join(os.tmpdir(), "detail-prevalence-"));
try {
  const storage = new LocalDocumentStorage(root);
  const repository = new LocalBillRepository(root);
  const ingest = async (reading, tenantId = "tenant_prova") => ingestBill({ tenantId, fileName: "sintetica.pdf", contentType: "application/pdf", bytes: pdf(`sintetica ${tenantId}`), maxBytes: 100000, storage, repository, audit: audit(), structuredExtractor: extractor(structured(reading)) });
  const link = (document, reading, bytes = pdf("dettaglio"), tenantId = document.tenantId, sink = audit()) => linkBillDetail({ tenantId, documentId: document.id, fileName: "dettaglio.pdf", contentType: "application/pdf", bytes, maxBytes: 100000, storage, repository, audit: sink, structuredExtractor: extractor(structured(reading)), actorId: "user_prova" });
  const rejected = async (promise, code) => { await assert.rejects(promise, (error) => error instanceof BillDetailLinkError && error.code === code); };

  // 1. Classification: the detail's "Oneri di sistema" rows are oneri generali, its "Trasporto" rows transport.
  assert.equal(classifyBillEconomicComponent("NETWORK_SYSTEM", "Oneri di sistema (quote variabili)"), "ARERA_SYSTEM_CHARGES");
  assert.equal(classifyBillEconomicComponent("NETWORK_SYSTEM", "Trasporto (quote variabili)"), "ARERA_NETWORK");
  assert.equal(classifyBillEconomicComponent("NETWORK_SYSTEM", "Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema"), "ARERA_NETWORK");

  // 2. Sintetica only: the transport derived by difference is not a billed amount, so no ARERA overcharge and no move.
  const sintetica = await ingest(SINTETICA);
  const onlySummary = receiptOf(analysisOf(sintetica));
  assert.equal(onlySummary.officialCheck.NETWORK.status, "NOT_VERIFIABLE");
  assert.equal(onlySummary.officialCheck.NETWORK.difference, null);
  assert.equal(onlySummary.officialCheck.NETWORK.official, 12.77);
  assert.match(onlySummary.officialCheck.NETWORK.reason, /trasporto non stampato separatamente/);
  assert.deepEqual(onlySummary.officialCheck.NETWORK.aggregateGaps, [{ quota: "CONSUMPTION", label: "quota per consumi", derived: 3.84, official: 2.56, gap: 1.28 }]);
  assert.equal(onlySummary.officialCheck.SYSTEM.status, "NOT_VERIFIABLE", "oneri assumed from ARERA are not verified against ARERA");
  assert.ok(!Object.values(onlySummary.officialCheck).some((check) => check.status === "DIFFERENCE"), "no ARERA overcharge from a derived value");
  assert.equal(row(onlySummary, "ENERGY").current, 66.1, "vendita as printed: nothing moved from the rete");
  assert.equal(row(onlySummary, "NETWORK").current, 14.05);
  assert.ok(!JSON.stringify(onlySummary.rows).includes("pagina sintetica mette"), "no compensation note");
  assert.equal(onlySummary.currentTotal, 114);
  assert.deepEqual(onlySummary.excluded, [{ label: "Ricalcoli e conguagli dei mesi precedenti", amount: -0.02 }, { label: "Spese di sollecito", amount: 9 }]);
  assert.equal(onlySummary.summaryDetail, undefined);
  assert.match(areraNote(onlySummary), /Trasporto della bolletta non verificabile/);
  assert.doesNotMatch(areraNote(onlySummary), /in più di ARERA/);
  const summaryRows = economics(sintetica);
  const derived = summaryRows.find((item) => item.label === "Rete e oneri meno oneri (calcolata, non è il trasporto stampato)");
  assert.equal(derived?.value, "14,05 €");
  assert.equal(derived?.state, "CALCULATED");
  assert.ok(!summaryRows.some((item) => item.label === "Rete e trasporto"), "no row presenting the derived value as the transport");
  assert.ok(!summaryRows.some((item) => item.group === "SIMULATOR" && item.value === "25,27 €"), "no rete e oneri shown as transport");
  // The transport printed apart in the bill is checked on its own amount.
  const printedTransport = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 67, analysis: analysisOf(sintetica), domestic: false, validUntil: null, offerComponents, printedNetwork: 12.77 });
  assert.equal(printedTransport.officialCheck.NETWORK.status, "VERIFIED");

  // 3. Link the fattura di dettaglio to the registered sintetica.
  const storedBefore = (await repository.get("tenant_prova", sintetica.id)).versions[0].structuredBill;
  const linkAudit = audit();
  const linked = await link(sintetica, DETTAGLIO, pdf("dettaglio"), "tenant_prova", linkAudit);
  assert.equal(linked.outcome, "LINKED");
  assert.ok(linked.checks.every((check) => check.outcome === "OK"), JSON.stringify(linked.checks));
  assert.deepEqual(linkAudit.events.map((event) => [event.type, event.outcome]), [["DETAIL_LINK", "ALLOWED"]]);
  const reloaded = await repository.get("tenant_prova", sintetica.id);
  assert.equal(reloaded.detailDocument.fileName, "dettaglio.pdf");
  assert.equal(reloaded.detailDocument.actorId, "user_prova");
  assert.deepEqual(reloaded.versions[0].structuredBill, storedBefore, "the sintetica's reading is not changed");
  assert.equal(reloaded.versions.length, 1);
  assert.deepEqual(validateStoredDocument(JSON.parse(JSON.stringify(reloaded))).detailDocument, reloaded.detailDocument);
  assert.equal((await storage.read("tenant_prova", reloaded.detailDocument.linkId)).length, pdf("dettaglio").length, "the detail is stored under its own id");
  assert.equal(toPublicDocument(reloaded).detailDocument.fileName, "dettaglio.pdf");
  assert.equal(toPublicDocument(reloaded).detailDocument.objectKey, undefined, "no storage location in the public document");

  // 4. With the detail: detail prevails for the split, sintetica for the total; the ARERA flag is gone without compensations.
  const withDetail = receiptOf(analysisOf(reloaded));
  assert.deepEqual(withDetail.officialCheck.NETWORK, { status: "VERIFIED", official: 12.77, difference: 0, reason: null });
  assert.deepEqual(withDetail.officialCheck.SYSTEM, { status: "VERIFIED", official: 11.22, difference: 0, reason: null });
  assert.equal(row(withDetail, "ENERGY").current, 67.38);
  assert.equal(row(withDetail, "NETWORK").current, 12.77);
  assert.equal(row(withDetail, "SYSTEM").current, 11.22);
  assert.equal(row(withDetail, "TAXES").current, 22.63);
  assert.equal(withDetail.currentTotal, 114);
  const excludedTotal = withDetail.excluded.reduce((total, item) => total + item.amount, 0);
  assert.equal(Math.round((withDetail.currentTotal + excludedTotal) * 100) / 100, 122.98, "the sintetica's total is kept");
  assert.deepEqual(withDetail.excluded, [{ label: "Ricalcoli e conguagli dei mesi precedenti", amount: -0.02 }, { label: "Spese di sollecito", amount: 9 }]);
  const recalculations = analysisOf(reloaded).components.filter((line) => line.classification === "RICALCOLI" && line.includedInReconciliation && !line.aggregate);
  assert.deepEqual(recalculations.map((line) => [line.period, line.amount]), [["01/08/2026 - 31/08/2026", "-0,01"], ["01/09/2026 - 30/09/2026", "-0,01"]]);
  const consumption = withDetail.quotas.find((quota) => quota.key === "CONSUMPTION");
  assert.equal(consumption.current, 60.5, "variable total 60,50");
  assert.equal(consumption.currentSeller, 52.38, "variable vendita from the detail");
  assert.equal(Math.round((consumption.current - consumption.currentSeller) * 100) / 100, 8.12, "variable rete e oneri from the detail");
  assert.equal(withDetail.summaryDetail.status, "DETAIL_PREVAILS");
  assert.deepEqual(withDetail.summaryDetail.detail, { seller: 67.38, network: 12.77, system: 11.22 });
  assert.deepEqual(withDetail.summaryDetail.summary, { seller: 66.1, networkAndSystem: 25.27 });
  assert.deepEqual(withDetail.summaryDetail.quotas, [{ quota: "CONSUMPTION", label: "quota per consumi", summarySeller: 51.1, detailSeller: 52.38, summaryNetworkAndSystem: 9.4, detailNetworkAndSystem: 8.12 }]);
  assert.match(withDetail.summaryDetail.note, /1,28 € della quota per consumi; prevalgono le voci di dettaglio, il totale resta quello della sintetica/);
  assert.ok(!JSON.stringify(withDetail).includes("pagina sintetica mette"), "no artificial compensation");
  const detailRows = economics(reloaded);
  const value = (label) => detailRows.find((item) => item.label === label && item.group !== "SIMULATOR");
  assert.equal(value("Vendita").value, "67,38 €");
  assert.match(value("Vendita").note, /quadro sintetico 66,10 €/);
  assert.equal(value("Rete e trasporto").value, "12,77 €");
  assert.equal(value("Rete e trasporto").state, "READ");
  assert.equal(value("Oneri di sistema").value, "11,22 €");
  assert.equal(value("Rete e oneri di sistema").value, "23,99 €");
  assert.match(value("Rete e oneri di sistema").note, /quadro sintetico 25,27 €/);
  assert.equal(value("Ripartizione diversa tra sintetica e dettaglio").value, "1,28 €");
  assert.match(value("Ripartizione diversa tra sintetica e dettaglio").note, /vendita 51,10 € in sintetica, 52,38 € in dettaglio; rete e oneri 9,40 € in sintetica, 8,12 € in dettaglio/);
  assert.equal(value("Totale fattura").value, "122,98 €");
  assert.ok(!detailRows.some((item) => item.label === "Rete e oneri meno oneri (calcolata, non è il trasporto stampato)"));

  // 5. The same file again is a no-op; another file is refused while one is linked.
  const filesBefore = (await readdir(root, { recursive: true })).length;
  const again = await link(reloaded, DETTAGLIO);
  assert.equal(again.outcome, "ALREADY_LINKED");
  assert.equal((await readdir(root, { recursive: true })).length, filesBefore, "nothing stored twice");
  await rejected(link(reloaded, DETTAGLIO, pdf("altro dettaglio")), "DETAIL_ALREADY_LINKED");

  // 6. Documents not shown to be the same invoice are never associated, and nothing is stored.
  const refused = async (change, code, message) => {
    const bill = await ingest(SINTETICA);
    const files = (await readdir(root, { recursive: true })).length;
    const sink = audit();
    await assert.rejects(link(bill, { ...DETTAGLIO, ...change }, pdf(`dettaglio ${message}`), bill.tenantId, sink), (error) => error instanceof BillDetailLinkError && error.code === "DETAIL_NOT_COHERENT" && error.checks.some((check) => check.code === code && check.outcome === "FAILED"), message);
    assert.equal((await repository.get(bill.tenantId, bill.id)).detailDocument, undefined, message);
    assert.equal((await readdir(root, { recursive: true })).length, files, message);
    assert.deepEqual(sink.events.map((event) => [event.type, event.outcome]), [["DETAIL_LINK", "DENIED"]], message);
  };
  await refused({ pod: "IT000E00000002" }, "SUPPLY_POINT", "POD diverso");
  await refused({ periodoDal: "2026-09-01", periodoAl: "2026-09-30", periodoStampato: "Settembre 2026" }, "BILLING_PERIOD", "periodo diverso");
  await refused({ numeroDocumento: "000002P" }, "INVOICE_NUMBER", "numero documento diverso");
  await refused({ dataEmissione: "2026-11-07" }, "ISSUE_DATE", "data di emissione diversa");
  await refused({ fornitore: "ALTRO VENDITORE S.R.L." }, "SUPPLIER", "fornitore diverso");
  await refused({ dettaglio: DETAIL.map((item) => item.descrizione === "Energia Attiva F1" ? { ...item, importo: "19,09" } : item) }, "AMOUNTS", "importi diversi");
  await refused({ dettaglio: [] }, "DETAIL_LINES", "nessuna voce di dettaglio");
  // A document number printed on only one of the two is not a contradiction: it is reported as not determinable.
  const unnumbered = billDetailCoherence(structured({ ...SINTETICA, numeroDocumento: "" }), structured(DETTAGLIO));
  assert.equal(unnumbered.coherent, true);
  assert.equal(unnumbered.checks.find((check) => check.code === "INVOICE_NUMBER").outcome, "NOT_DETERMINABLE");

  // 7. Tenant isolation: a bill of another tenant is not found, whatever its id.
  await rejected(link(sintetica, DETTAGLIO, pdf("dettaglio"), "tenant_altro"), "DOCUMENT_NOT_FOUND");

  // 8. One PDF with sintetica and dettaglio whose detail does not add up to the sintetica: no association, sintetica kept.
  const mismatched = await ingest({ ...SINTETICA, dettaglio: DETAIL.map((item) => item.descrizione === "Energia Attiva F1" ? { ...item, importo: "19,09" } : item) });
  const incoherent = receiptOf(analysisOf(mismatched));
  assert.equal(incoherent.summaryDetail.status, "INCOHERENT");
  assert.equal(row(incoherent, "ENERGY").current, 66.1);
  assert.ok(!JSON.stringify(incoherent).includes("pagina sintetica mette"));
  // The same PDF holding both, coherent: same result as the linked detail.
  const both = await ingest({ ...SINTETICA, dettaglio: DETAIL });
  assert.deepEqual(receiptOf(analysisOf(both)).officialCheck, withDetail.officialCheck);
  assert.deepEqual(receiptOf(analysisOf(both)).summaryDetail, withDetail.summaryDetail);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("bill-detail-prevalence OK");
