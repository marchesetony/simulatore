import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBillReading, BILL_READER_PROMPT } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { BILL_READER_SCHEMA } from "../app/lib/reading/bill-reader-schema.ts";
import { checkBillReading, printedComponentChecks, scontrinoAggregates } from "../app/lib/reading/bill-reader-checks.ts";
import { validateStructuredBillExtraction } from "../app/lib/ingestion/structured-bill.ts";
import { billReadingView } from "../app/lib/foundation/bill-reading-view.ts";
import { approveDocumentVersion, confirmBillFields, createManualCorrection, ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { reviewSubmission } from "../app/lib/ui/bill-review-submission.ts";
import { billForReading, billReadSections, NOT_IN_BILL, NOT_READ_SEPARATELY } from "../app/lib/ui/bill-read-details.ts";

// Tony (13/11/2026, "CORREZIONE LETTURA COMPONENTI ECONOMICHE", BPower 071808E ottobre 2026): the bill prints transport, system
// charges, excise and VAT apart, but "Dati letti" said "Non presente nella fattura". The reader now takes them as printed, with
// page and section, kept apart from the rows the engine reads; they are parts of "rete e oneri" and "Accise e IVA", never added
// to them. Synthetic data with the same amounts as the verified case; no real customer, POD or document.

const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const component = (etichetta, categoria, importo, pagina = 3, sezione = "Riepilogo degli importi fatturati") => ({ etichetta, categoria, importo, sezione, pagina });
const COMPONENTS = [
  component("Spesa per il trasporto e la gestione del contatore", "TRASPORTO_RETE", "6,69"),
  component("Spesa per oneri di sistema", "ONERI_SISTEMA", "3,95"),
  component("Accise", "ACCISE", "0,13", 4, "Imposte"),
  component("IVA 10%", "IVA", "6,31", 4, "Imposte"),
];
const base = {
  tipoDocumento: "BOLLETTA_SINTETICA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.P.A.", intestatario: "CLIENTE DI PROVA", pod: "IT000E00000001", tipoClienteStampato: "Altri usi", tensioneStampata: "220 V",
  potenzaImpegnataKw: "1,5", periodoStampato: "Ottobre 2026", periodoDal: "2026-10-01", periodoAl: "2026-10-31",
  consumoFatturato: "10", consumoF1: "3", consumoF2: "4", consumoF3: "3", totaleBolletta: "35,00",
  offertaNome: "OFFERTA DI PROVA", offertaCodice: "CODICEPROVA02", tipologiaOfferta: "VARIABILE", indice: "PUN", spread: "0,025000 €/kWh", pcvMensile: "15,00",
  scontrino: [
    sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "3,42", { quantita: "10", unita: "kWh", prezzoMedio: "0,342", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "CONSUMI", "2,92", { prezzoMedio: "0,292000", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "0,50", { prezzoMedio: "0,050000", unitaPrezzo: "€/kWh" }),
    sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "18,74", { quantita: "1", unita: "mesi", prezzoMedio: "18,74", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "FISSA", "15,00", { prezzoMedio: "15,00", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "3,74", { prezzoMedio: "3,74", unitaPrezzo: "€/mese" }),
    sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "6,40", { quantita: "1,5", unita: "kW", prezzoMedio: "4,266667", unitaPrezzo: "€/kW/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "6,40", { prezzoMedio: "4,266667", unitaPrezzo: "€/kW/mese" }),
    sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "6,44"),
    sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "35,00"),
  ],
  dettaglio: [],
  assenti: [{ campo: "dettaglio", motivo: "non stampato: bolletta sintetica" }],
};
const withComponents = parseBillReading({ ...base, componentiStampate: COMPONENTS });
const without = parseBillReading(base);

// 1. The reader is asked for the amounts printed apart, also without quantity × price, never calculated.
assert.ok(BILL_READER_SCHEMA.required.includes("componentiStampate"));
assert.deepEqual(BILL_READER_SCHEMA.properties.componentiStampate.items.properties.categoria.enum, ["TRASPORTO_RETE", "ONERI_SISTEMA", "ACCISE", "IVA"]);
assert.match(BILL_READER_PROMPT, /sezioni informative/);
assert.match(BILL_READER_PROMPT, /Non calcolarlo, non ricavarlo per differenza/);
assert.deepEqual(without.componentiStampate, [], "a reading without the list keeps working");

// 2. Coherence: transport + system charges = rete e oneri (10,64), excise + VAT = Accise e IVA (6,44).
assert.deepEqual(scontrinoAggregates(withComponents.scontrino), { networkAndSystem: 0.5 + 3.74 + 6.4, taxes: 6.44 });
assert.deepEqual(checkBillReading(withComponents), [], "the verified case adds up");
// Tony (13/11/2026, "CORREZIONE MIRATA LETTORE AI"): a reading that does not return the components is incomplete (expectation
// changed from "no check" by this requested behaviour).
assert.deepEqual(checkBillReading(without).map((check) => check.code), ["COMPONENTS_FIELD_MISSING"], "a reading without the components is reported");
const wrongOneri = parseBillReading({ ...base, componentiStampate: COMPONENTS.map((row) => row.categoria === "ONERI_SISTEMA" ? { ...row, importo: "4,95" } : row) });
assert.deepEqual(checkBillReading(wrongOneri).map((check) => check.code), ["COMPONENTS_NETWORK_SYSTEM"]);
const tooLarge = parseBillReading({ ...base, componentiStampate: [component("Oneri di sistema", "ONERI_SISTEMA", "11,00")] });
assert.ok(checkBillReading(tooLarge).map((check) => check.code).includes("COMPONENTS_NETWORK_SYSTEM"), "one part larger than its total");
const wrongVat = parseBillReading({ ...base, componentiStampate: COMPONENTS.map((row) => row.categoria === "IVA" ? { ...row, importo: "6,41" } : row) });
assert.deepEqual(checkBillReading(wrongVat).map((check) => check.code), ["COMPONENTS_TAXES"]);
assert.deepEqual(printedComponentChecks({ network: null, system: 3.95, excise: null, vat: null }, { networkAndSystem: 10.64, taxes: null }), [], "one part within its total is fine");
// A quota potenza printed without "di cui" is all network.
assert.equal(scontrinoAggregates([sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "5,93"), sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "1,00")]).networkAndSystem, 5.93);

// 3. Mapping: category, amount, original description, page, section and provenance; nothing in the engine's rows.
const bill = toStructuredBill({ reading: withComponents, checks: [], reread: false });
const plainBill = toStructuredBill({ reading: without, checks: [], reread: false });
assert.deepEqual(bill.printedComponents, [
  { category: "NETWORK", label: "Spesa per il trasporto e la gestione del contatore", rawAmount: "6,69", amount: 6.69, section: "Riepilogo degli importi fatturati", page: 3, source: "DOCUMENT_READING" },
  { category: "SYSTEM_CHARGES", label: "Spesa per oneri di sistema", rawAmount: "3,95", amount: 3.95, section: "Riepilogo degli importi fatturati", page: 3, source: "DOCUMENT_READING" },
  { category: "EXCISE", label: "Accise", rawAmount: "0,13", amount: 0.13, section: "Imposte", page: 4, source: "DOCUMENT_READING" },
  { category: "VAT", label: "IVA 10%", rawAmount: "6,31", amount: 6.31, section: "Imposte", page: 4, source: "DOCUMENT_READING" },
]);
assert.deepEqual(bill.economicChargeLines, plainBill.economicChargeLines, "the calculation reads exactly the same rows: 3,95 is not added to 10,64");
assert.equal(bill.economicChargeLines.some((line) => ["ASOS", "ARIM", "EXCISE", "VAT"].includes(line.code)), false);
assert.deepEqual(plainBill.printedComponents, []);
const odd = toStructuredBill({ reading: parseBillReading({ ...base, componentiStampate: [component("Bollo", "BOLLO", "2,00"), component("IVA", "IVA", ""), component("IVA", "IVA", "n.d.")] }), checks: [], reread: false });
assert.deepEqual(odd.printedComponents, [], "an unknown category or an unreadable amount is left out, never guessed");
validateStructuredBillExtraction(bill);
validateStructuredBillExtraction({ ...bill, printedComponents: undefined });
assert.throws(() => validateStructuredBillExtraction({ ...bill, printedComponents: [{ ...bill.printedComponents[0], source: "CALCULATED" }] }), /printedComponents\.0/, "only values read from the document");
assert.throws(() => validateStructuredBillExtraction({ ...bill, printedComponents: [{ ...bill.printedComponents[0], category: "OTHER" }] }), /printedComponents\.0/);
assert.deepEqual(billReadingView(bill).printedComponents, bill.printedComponents, "every user who may open the bill sees them");

// 4-5. Reading, review, approval and saving keep the components and leave the original values untouched.
const plain = (value) => value.replace(/ /g, " ");
const economics = (shown) => Object.fromEntries(billReadSections(billForReading(shown)).find((section) => section.id === "ECONOMICS").rows.filter((row) => !row.group).map((row) => [row.label, { value: plain(row.value), state: row.state, note: row.note ? plain(row.note) : undefined }]));
const root = await mkdtemp(path.join(os.tmpdir(), "printed-components-"));
try {
  const tenant = "tenant_prova-c";
  const repository = new LocalBillRepository(root);
  const ingest = (structured, name) => ingestBill({ tenantId: tenant, fileName: name, contentType: "application/pdf", bytes: new Uint8Array(Buffer.from(`%PDF-1.7 ${name}`, "latin1")), maxBytes: 100_000, storage: new LocalDocumentStorage(root), repository, audit: { async record() {} }, structuredExtractor: { async extract() { return structured; } } });
  const document = await ingest(bill, "prova-c.pdf");
  assert.deepEqual(document.versions[0].structuredBill.printedComponents, bill.printedComponents, "saved with the reading");
  const corrected = createManualCorrection({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, field: "supplier", value: "VENDITORE CORRETTO S.P.A.", at: "2026-11-13T10:00:00.000Z" });
  assert.deepEqual(corrected.versions.at(-1).structuredBill.printedComponents, bill.printedComponents, "kept by a manual correction");
  await repository.save(corrected);
  assert.deepEqual((await repository.get(tenant, corrected.id)).versions.at(-1).structuredBill.printedComponents, bill.printedComponents, "a saved correction keeps them");
  const publicBill = toPublicDocument(document);
  const FIELDS = ["customerName", "supplier", "pod", "billingPeriod", "billedConsumption", "totalAmount"];
  const submission = reviewSubmission(FIELDS, Object.fromEntries(FIELDS.map((field) => [field, publicBill.fields[field]?.value ?? ""])), publicBill.fields);
  const confirmed = confirmBillFields({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, fields: submission.confirm, at: "2026-11-13T10:01:00.000Z" });
  const approved = approveDocumentVersion({ document: confirmed, tenantId: tenant, versionId: confirmed.currentVersionId, at: "2026-11-13T10:02:00.000Z" });
  await repository.save(approved);
  const stored = await repository.get(tenant, approved.id);
  const approvedVersion = stored.versions.find((item) => item.versionId === stored.currentApprovedVersionId);
  assert.deepEqual(approvedVersion.structuredBill.printedComponents, bill.printedComponents, "kept by approval and after saving");
  assert.deepEqual(approvedVersion.structuredBill.economicChargeLines, bill.economicChargeLines, "the original rows are untouched");
  assert.deepEqual(stored.versions[0].structuredBill, document.versions[0].structuredBill, "the first reading is untouched");

  // 6-7. "Dati letti": the printed values, each component as read with its page, the aggregates once.
  const shown = economics(toPublicDocument(stored));
  assert.deepEqual(shown["Vendita"].value, "17,92 €");
  assert.deepEqual([shown["Rete e oneri di sistema"].value, shown["Rete e oneri di sistema"].state], ["10,64 €", "READ"]);
  assert.deepEqual([shown["Rete e trasporto"].value, shown["Rete e trasporto"].state], ["6,69 €", "READ"]);
  assert.match(shown["Rete e trasporto"].note, /^Stampato a pagina 3, Riepilogo degli importi fatturati: "Spesa per il trasporto e la gestione del contatore" 6,69$/);
  assert.deepEqual([shown["Oneri di sistema"].value, shown["Oneri di sistema"].state], ["3,95 €", "READ"]);
  assert.deepEqual([shown["Accise"].value, shown["Accise"].state], ["0,13 €", "READ"]);
  assert.match(shown["Accise"].note, /pagina 4, Imposte/);
  assert.deepEqual([shown["IVA"].value, shown["IVA"].state], ["6,31 €", "READ"]);
  assert.deepEqual([shown["Totale fattura"].value, shown["Totale fattura"].note], ["35,00 €", undefined], "17,92 + 10,64 + 6,44 = 35,00: nothing counted twice");
  assert.equal(Object.values(shown).some((row) => row.value === "14,59 €" || row.value === "16,59 €"), false, "3,95 is never added to 10,64");
  assert.equal(Object.values(shown).some((row) => row.value === NOT_IN_BILL), false);
  // Simulator rows (the comparison grouping) are computed exactly as before: the components change nothing there.
  const comparison = (structured) => JSON.stringify(toPublicDocument({ ...stored, versions: stored.versions.map((item) => ({ ...item, structuredBill: structured })) }).analystReview?.economics ?? null);
  assert.ok(JSON.parse(comparison(approvedVersion.structuredBill))?.economicAnalysis?.totals, "the comparison economics exist");
  assert.equal(comparison(approvedVersion.structuredBill), comparison({ ...approvedVersion.structuredBill, printedComponents: undefined }), "economics for the comparison unchanged");

  // 8-9. A bill that prints no separate components: "Non letto separatamente", or "Non presente nella fattura" only when the
  // reader says so; the printed "Accise e IVA" stays as printed.
  const plainShown = economics(toPublicDocument(await ingest(plainBill, "prova-d.pdf")));
  for (const label of ["Rete e trasporto", "Oneri di sistema", "Accise", "IVA"]) assert.deepEqual([plainShown[label].value, plainShown[label].state], [NOT_READ_SEPARATELY, "NOT_READ"], label);
  assert.deepEqual([plainShown["Accise e IVA"].value, plainShown["Accise e IVA"].state], ["6,44 €", "READ"]);
  assert.deepEqual([plainShown["Rete e oneri di sistema"].value, plainShown["Totale fattura"].value], ["10,64 €", "35,00 €"]);
  const declared = toStructuredBill({ reading: parseBillReading({ ...base, assenti: [{ campo: "componentiStampate.ACCISE", motivo: "non stampate separate: solo 'Accise e IVA'" }] }), checks: [], reread: false });
  const declaredShown = economics(toPublicDocument(await ingest(declared, "prova-e.pdf")));
  assert.deepEqual([declaredShown["Accise"].value, declaredShown["Accise"].state, declaredShown["Accise"].note], [NOT_IN_BILL, "ABSENT", "non stampate separate: solo 'Accise e IVA'"]);
  assert.equal(declaredShown["IVA"].value, NOT_READ_SEPARATELY, "only the category the reader declared");

  // A part that does not add up is shown as read but "Da verificare", never corrected.
  const wrongShown = economics(toPublicDocument(await ingest(toStructuredBill({ reading: wrongOneri, checks: checkBillReading(wrongOneri), reread: false }), "prova-f.pdf")));
  assert.deepEqual([wrongShown["Oneri di sistema"].value, wrongShown["Oneri di sistema"].state], ["4,95 €", "REVIEW"]);
  assert.match(wrongShown["Oneri di sistema"].note, /^Da verificare: Trasporto e rete 6,69 € \+ oneri di sistema 4,95 € = 11,64 € ma rete e oneri stampato è 10,64 €/);
  assert.equal(wrongShown["Rete e trasporto"].state, "REVIEW");

  // Tony (14/11/2026, "semplificazione visualizzazione costi", caso BPower 071808E riletto): the six ASOS/ARIM amounts printed on
  // page 5, accise and IVA on page 4, transport declared not printed apart. In view: Vendita 17,92, Rete e trasporto 6,69
  // calculated (asterisk), Oneri 3,95 read, Accise 0,13, IVA 6,31, Totale 35,00; aggregates and formula in the details.
  const oneri = [["ASOS - quota potenza", "1,85"], ["ASOS - quota per consumi", "0,32"], ["ASOS - quota fissa", "1,08"], ["ARIM - quota potenza", "0,43"], ["ARIM - quota per consumi", "0,02"], ["ARIM - quota fissa", "0,25"]].map(([label, amount]) => component(`Componente ${label}`, "ONERI_SISTEMA", amount, 5, "Oneri generali di sistema"));
  const reread = parseBillReading({ ...base, componentiStampate: [...oneri, component("Imposte erariali", "ACCISE", "0,13", 4, "Imposte"), component("IVA vendite 22%", "IVA", "6,31", 4, "Imposte")], assenti: [...base.assenti, { campo: "componentiStampate.TRASPORTO_RETE", motivo: "non stampato separatamente" }] });
  const rereadBill = toPublicDocument(await ingest(toStructuredBill({ reading: reread, checks: checkBillReading(reread), reread: false }), "prova-g.pdf"));
  const costs = billReadSections(billForReading(rereadBill)).find((section) => section.id === "ECONOMICS").rows;
  const inView = costs.filter((row) => !row.secondary);
  assert.deepEqual(inView.map((row) => [row.label, plain(row.value), row.state]), [["Vendita", "17,92 €", "READ"], ["Rete e trasporto", "6,69 €", "CALCULATED"], ["Oneri di sistema", "3,95 €", "READ"], ["Accise", "0,13 €", "READ"], ["IVA", "6,31 €", "READ"], ["Totale fattura", "35,00 €", "READ"]]);
  assert.match(inView[1].note, /^Calcolata: rete e oneri stampati meno gli oneri di sistema stampati$/, "never attributed to the reading");
  assert.match(plain(inView[2].note), /^Somma di 6 importi stampati \(pagina 5, Oneri generali di sistema: "Componente ASOS - quota potenza" 1,85;/);
  const details = costs.filter((row) => row.secondary && !row.group).map((row) => [row.label, plain(row.value), plain(row.note ?? "")]);
  assert.deepEqual(details, [["Rete e oneri di sistema", "10,64 €", "Quadro sintetico, come stampato (rete e oneri insieme) · rete e trasporto calcolata: 10,64 € − oneri di sistema 3,95 € = 6,69 €"], ["Accise e IVA", "6,44 €", "Quadro sintetico, come stampato (insieme)"]], "the printed aggregates kept in the details, not in the summary");
  assert.equal(costs.filter((row) => row.label === "Rete e trasporto" && !row.group).length, 1, "rete e trasporto once");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("bill-printed-components OK");
