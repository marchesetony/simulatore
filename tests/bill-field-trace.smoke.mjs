// Tony (25/11/2026, attività 01 "Affidabilità della lettura bollette"): each field says LETTO / CALCOLATO / STIMATO / ASSENTE,
// apart from how far it can be trusted; absent is never zero (documented zero, absent, not applicable, not interpretable); the
// indispensable fields not verified stop definitive proposals. Synthetic data only: no real customer, POD or supplier.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { checkBillReading } from "../app/lib/reading/bill-reader-checks.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { structuredBillFields } from "../app/lib/ingestion/structured-bill.ts";
import { assertDefinitiveBillFields, traceBillFields } from "../app/lib/reading/bill-field-trace.ts";
import { approveDocumentVersion, billFieldTraceOf, confirmBillFields, ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../app/lib/foundation/real-bill.ts";

const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const HOUSEHOLD = {
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "DOMESTICO", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "MARIO PROVA", codiceFiscalePartitaIva: "PRVMRA80A01H501U", pod: "IT001E12345678",
  tipoClienteStampato: "Domestico residente", potenzaImpegnataKw: "3", potenzaDisponibileKw: "3,3",
  periodoStampato: "01/09/2026 - 30/09/2026", periodoDal: "2026-09-01", periodoAl: "2026-09-30",
  consumoFatturato: "300", consumoF1: "100", consumoF2: "100", consumoF3: "100", consumoAnnuo: "3.600", totaleBolletta: "100,00",
  pcvMensile: "8,50", spread: "0,015 €/kWh",
  scontrino: [sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "100,00", { quantita: "300", unita: "kWh" }), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "100,00")],
  dettaglio: [],
  fonti: [{ campo: "intestatario", pagina: 1, testo: "MARIO PROVA" }, { campo: "consumoFatturato", pagina: 2, testo: "300 kWh" }],
  assenti: [],
};
const read = (overrides = {}) => {
  const reading = parseBillReading({ ...HOUSEHOLD, ...overrides });
  return { reading, structured: toStructuredBill({ reading, checks: checkBillReading(reading), reread: false }) };
};
/** The bill fields as stored after reading; `confirmed` lists the ones the operator confirmed. */
const fieldsOf = (structured, confirmed = []) => Object.fromEntries(Object.entries(structuredBillFields(structured)).map(([name, field]) => [name, { ...field, confirmed: confirmed.includes(name) }]));
const ALL = ["supplier", "pod", "customerName", "billingPeriod", "annualConsumption", "billedConsumption", "totalAmount"];
const trace = (overrides = {}, confirmed = []) => { const { structured } = read(overrides); return traceBillFields({ structuredBill: structured, fields: fieldsOf(structured, confirmed) }); };
const field = (result, key) => result.fields.find((item) => item.key === key);
const codes = (result) => result.issues.map((item) => item.code);
const open = (result) => result.openIssues.map((item) => item.code);

// 1. Complete household bill: read fields are LETTO with their page; the PDR does not apply; nothing stops the proposal.
{
  const result = trace();
  assert.equal(result.vector, "EE");
  assert.deepEqual([field(result, "intestatario").provenance, field(result, "intestatario").page, field(result, "intestatario").method], ["LETTO", 1, "LETTURA_AI"]);
  assert.equal(field(result, "intestatario").reliability, "DA_VERIFICARE", "read by the AI, not yet confirmed");
  assert.deepEqual([field(result, "pdr").presence, field(result, "pdr").indispensable], ["NON_APPLICABILE", false]);
  assert.equal(field(result, "consumoTotale").reliability, "COERENTE", "F1 + F2 + F3 add up to the total");
  assert.equal(field(result, "tipoCliente").value, "Domestico");
  assert.equal(field(result, "residenza").value, "Residente");
  assert.equal(result.definitiveAllowed, true, open(result).join());
  const confirmed = trace({}, ALL);
  assert.equal(field(confirmed, "intestatario").reliability, "VERIFICATO_OPERATORE");
}
console.log("COMPLETE=PASS");

// 2. Missing fields: ASSENTE with the reader's reason, never a number; indispensable ones block, optional ones do not.
{
  const result = trace({ intestatario: "", potenzaImpegnataKw: "", potenzaDisponibileKw: "", consumoFatturato: "", consumoF1: "", consumoF2: "", consumoF3: "", pcvMensile: "", spread: "",
    scontrino: [sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "100,00")], assenti: [{ campo: "intestatario", motivo: "non stampato nella pagina letta" }] });
  assert.deepEqual([field(result, "intestatario").provenance, field(result, "intestatario").presence, field(result, "intestatario").value, field(result, "intestatario").note], ["ASSENTE", "ASSENTE", "", "non stampato nella pagina letta"]);
  assert.equal(field(result, "consumoTotale").value, "", "absent consumption is not zero");
  for (const code of ["HOLDER_MISSING", "CONSUMPTION_MISSING", "POWER_COMMITTED_MISSING"]) assert.ok(open(result).includes(code), code);
  assert.equal(result.definitiveAllowed, false);
  assert.throws(() => assertDefinitiveBillFields(result), /SOURCE_BILL_FIELDS_UNVERIFIED/);
  assert.equal(field(result, "pcv"), undefined, "an optional value not printed is not an error");
  assert.ok(!result.issues.some((item) => item.field === "pcv" || item.field === "spread"));
}
console.log("MISSING=PASS");

// 3. Real zeros: a printed 0 kWh is a documented zero (never "not read"), the reader is not sent back for it.
{
  const zero = { consumoFatturato: "0", consumoF1: "0", consumoF2: "0", consumoF3: "0", scontrino: [sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "100,00", { quantita: "0", unita: "kWh" }), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "100,00")] };
  const { reading, structured } = read(zero);
  assert.ok(!checkBillReading(reading).some((check) => check.code === "CONSUMPTION_MISSING"), "a printed zero is not missing");
  assert.equal(structured.billedConsumption.value, 0);
  const result = traceBillFields({ structuredBill: structured, fields: fieldsOf(structured) });
  assert.deepEqual([field(result, "consumoTotale").presence, field(result, "consumoTotale").provenance], ["ZERO_DOCUMENTATO", "LETTO"]);
  assert.ok(codes(result).includes("CONSUMPTION_ZERO"));
  assert.equal(result.definitiveAllowed, true, open(result).join());
  // A printed zero total without bands stays 0 (before 25/11 it became "not read"); alone, the operator confirms it.
  const { structured: totalOnly } = read({ ...zero, consumoF1: "", consumoF2: "", consumoF3: "" });
  assert.deepEqual([totalOnly.billedConsumption.status, totalOnly.billedConsumption.value], ["FOUND", 0]);
  const alone = traceBillFields({ structuredBill: totalOnly, fields: fieldsOf(totalOnly) });
  assert.ok(open(alone).includes("CONSUMPTION_ZERO"));
  assert.equal(traceBillFields({ structuredBill: totalOnly, fields: fieldsOf(totalOnly, ALL) }).definitiveAllowed, true);
  // A zero total contradicted by the scontrino's quota: the quota's kWh are used (as before), and the gap is to confirm.
  const { structured: quotaWins } = read({ ...zero, consumoF1: "", consumoF2: "", consumoF3: "", scontrino: [sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "100,00", { quantita: "250", unita: "kWh" }), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "100,00")] });
  assert.deepEqual([quotaWins.billedConsumption.value, quotaWins.readingDerived[0].method], [250, "QUOTA_CONSUMI_SCONTRINO"]);
  // Gas: zero Smc printed is not missing either; absent is.
  const gas = { vettore: "GAS", pod: "", pdr: "12345678901234", consumoSmc: "0", consumoFatturato: "0", consumoF1: "", consumoF2: "", consumoF3: "" };
  assert.ok(!checkBillReading(parseBillReading({ ...HOUSEHOLD, ...gas })).some((check) => check.code === "CONSUMPTION_MISSING"));
  assert.ok(checkBillReading(parseBillReading({ ...HOUSEHOLD, ...gas, consumoSmc: "", consumoFatturato: "" })).some((check) => check.code === "CONSUMPTION_MISSING"));
}
console.log("ZEROS=PASS");

// 4. Incoherent data: bands that do not give the total, type against printed use. They block until confirmed or read again.
{
  const result = trace({ consumoF1: "100", consumoF2: "100", consumoF3: "150" });
  assert.ok(open(result).includes("BANDS_SUM"));
  assert.equal(field(result, "consumoTotale").reliability, "INCOERENTE");
  const confirmed = trace({ consumoF1: "100", consumoF2: "100", consumoF3: "150" }, ALL);
  assert.equal(confirmed.definitiveAllowed, true, "the operator confirmed the consumption against the bill");
  assert.equal(field(confirmed, "consumoTotale").reliability, "VERIFICATO_OPERATORE");
  // The total printed as 0 with bands that sum to 300: the value used is F1 + F2 + F3, CALCOLATO, and the gap stays reported.
  const derived = trace({ consumoFatturato: "0" });
  assert.deepEqual([field(derived, "consumoTotale").provenance, field(derived, "consumoTotale").method], ["CALCOLATO", "FORMULA"]);
  assert.match(field(derived, "consumoTotale").note, /F1 \+ F2 \+ F3/);
  assert.ok(open(derived).includes("BANDS_SUM"));
  // Type read as household but printed "Altri usi": blocked, no confirmation can settle it without a new reading.
  const conflict = trace({ tipoClienteStampato: "Altri usi" }, ALL);
  assert.ok(open(conflict).includes("CUSTOMER_TYPE_CONFLICT"));
  assert.equal(conflict.definitiveAllowed, false);
  const period = trace({ periodoStampato: "", periodoDal: "2026-09-30", periodoAl: "2026-09-01" }, ALL);
  assert.ok(open(period).includes("PERIOD_INVALID"), "inverted dates are refused when read, and stay blocking");
  assert.equal(field(period, "periodo").presence, "NON_INTERPRETABILE");
}
console.log("INCOHERENT=PASS");

// 5. Wrong POD: wrong shape blocks; letters where digits belong (O/0) must be confirmed against the bill.
{
  const short = trace({ pod: "IT001E1234567" }, ALL);
  assert.ok(open(short).includes("POD_FORMAT")); assert.equal(field(short, "pod").reliability, "INCOERENTE");
  const ambiguous = trace({ pod: "IT001E1234567O" });
  assert.ok(open(ambiguous).includes("POD_AMBIGUOUS"));
  assert.equal(trace({ pod: "IT001E1234567O" }, ALL).definitiveAllowed, true, "confirmed by the operator");
  assert.ok(open(trace({ pod: "" })).includes("POD_MISSING"));
  const gas = trace({ vettore: "GAS", pod: "", pdr: "1234567890123", consumoSmc: "500", consumoFatturato: "500", consumoF1: "", consumoF2: "", consumoF3: "", potenzaImpegnataKw: "" }, ALL);
  assert.deepEqual([gas.vector, open(gas).includes("PDR_FORMAT"), field(gas, "pod").presence], ["GAS", true, "NON_APPLICABILE"]);
  assert.equal(field(gas, "potenzaImpegnata"), undefined, "power does not apply to gas");
}
console.log("POD=PASS");

// 6. Consumption not reconciled with the scontrino: reported on the total, confirmed by the operator.
{
  const result = trace({ scontrino: [sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "100,00", { quantita: "400", unita: "kWh" }), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "100,00")] });
  assert.ok(open(result).includes("CONSUMPTION_VS_SCONTRINO"));
  const total = trace({ scontrino: [sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "90,00", { quantita: "300", unita: "kWh" }), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "100,00")] });
  assert.ok(open(total).includes("SCONTRINO_TOTAL"), "scontrino rows do not give the bill total");
  assert.equal(field(total, "totaleBolletta").reliability, "INCOERENTE");
}
console.log("RECONCILIATION=PASS");

// 7. Absent or implausible power: committed power blocks (network quotas), available/max are optional.
{
  const absent = trace({ potenzaImpegnataKw: "", potenzaDisponibileKw: "" }, ALL);
  assert.ok(open(absent).includes("POWER_COMMITTED_MISSING"));
  assert.equal(field(absent, "potenzaImpegnata").presence, "ASSENTE");
  assert.equal(field(absent, "potenzaDisponibile").presence, "ASSENTE");
  const below = trace({ potenzaImpegnataKw: "6", potenzaDisponibileKw: "3,3" }, ALL);
  assert.ok(codes(below).includes("POWER_AVAILABLE_BELOW_COMMITTED")); assert.equal(below.definitiveAllowed, true, "a warning, not a block");
  assert.ok(open(trace({ potenzaImpegnataKw: "0" }, ALL)).includes("POWER_COMMITTED_INVALID"));
  // Tony (26/11/2026): a committed power printed in the supply data (as stored by earlier readers) is a documentary source: no
  // block when the reader's own field is empty. The available power alone never stands in for it.
  const { structured } = read({ potenzaImpegnataKw: "" });
  const fromFacts = { ...structured, extendedFacts: [...structured.extendedFacts, { code: "POWER_COMMITTED", value: "4,5", unit: "kW", status: "FOUND" }] };
  const recovered = traceBillFields({ structuredBill: fromFacts, fields: fieldsOf(fromFacts, ALL) });
  assert.deepEqual([field(recovered, "potenzaImpegnata").provenance, field(recovered, "potenzaImpegnata").value, recovered.definitiveAllowed], ["LETTO", "4,5 kW", true]);
  assert.match(field(recovered, "potenzaImpegnata").note, /dati di fornitura/);
  const fromProfile = { ...structured, supplyProfile: { ...structured.supplyProfile, powerCommitted: { rawValue: "6 kW", normalizedValue: null, status: "FOUND" } } };
  assert.equal(traceBillFields({ structuredBill: fromProfile, fields: fieldsOf(fromProfile, ALL) }).definitiveAllowed, true);
  assert.ok(open(traceBillFields({ structuredBill: structured, fields: fieldsOf(structured, ALL) })).includes("POWER_COMMITTED_MISSING"), "available 3,3 kW alone does not replace the committed power");
}
console.log("POWER=PASS");

// 8. Ambiguous OCR numbers: never turned into a smaller number, kept as "not interpretable".
{
  const { structured } = read({ consumoF1: "1O0", potenzaImpegnataKw: "3l5" });
  assert.equal(structured.f1Consumption.status, "NOT_FOUND", "1O0 is not 10");
  assert.deepEqual(structured.readingUninterpretable.map((item) => item.field).sort(), ["consumoF1", "potenzaImpegnataKw"]);
  const result = traceBillFields({ structuredBill: structured, fields: fieldsOf(structured, ALL) });
  assert.equal(field(result, "consumoF1").presence, "NON_INTERPRETABILE");
  assert.match(field(result, "consumoF1").note, /1O0/);
  assert.equal(field(result, "potenzaImpegnata").presence, "NON_INTERPRETABILE");
  assert.ok(codes(result).includes("BANDS_PARTIAL"));
  assert.equal(result.definitiveAllowed, false, "committed power not interpretable");
}
console.log("OCR=PASS");

// 9. Household and business documents; type estimated only from the tax code is uncertain and blocks.
{
  const business = trace({ tipoCliente: "ALTRI_USI", tipoClienteStampato: "Altri usi", intestatario: "AZIENDA PROVA SRL", codiceFiscalePartitaIva: "01234567890", potenzaImpegnataKw: "15", potenzaDisponibileKw: "16,5" }, ALL);
  assert.deepEqual([field(business, "tipoCliente").value, field(business, "tipoCliente").provenance, business.definitiveAllowed], ["Non domestico (business)", "LETTO", true]);
  assert.equal(field(business, "residenza"), undefined);
  const estimated = trace({ tipoCliente: "NON_DETERMINABILE", tipoClienteStampato: "" }, ALL);
  assert.deepEqual([field(estimated, "tipoCliente").provenance, field(estimated, "tipoCliente").reliability], ["STIMATO", "INCOERENTE"]);
  assert.ok(open(estimated).includes("CUSTOMER_TYPE_ESTIMATED"));
  assert.ok(estimated.uncertainFields.includes("Tipo cliente"));
  // P1 (Elios): "Domestico non residente" printed in one phrase gives the use and the residence.
  const nonResident = trace({ tipoCliente: "NON_DETERMINABILE", tipoClienteStampato: "Domestico non residente" }, ALL);
  assert.deepEqual([field(nonResident, "tipoCliente").value, field(nonResident, "tipoCliente").provenance, field(nonResident, "residenza").value], ["Domestico", "CALCOLATO", "Non residente"]);
  const { structured } = read({ tipoClienteStampato: "Domestico non residente" });
  assert.equal(structured.supplyProfile.domesticResidenceStatus.normalizedValue, "NON_RESIDENT");
  assert.equal(read({ tipoClienteStampato: "Domestico" }).structured.supplyProfile.domesticResidenceStatus.normalizedValue, "UNKNOWN", "nothing derived when the residence is not printed");
  const unknown = trace({ tipoCliente: "NON_DETERMINABILE", tipoClienteStampato: "", codiceFiscalePartitaIva: "" }, ALL);
  assert.ok(open(unknown).includes("CUSTOMER_TYPE_UNKNOWN"));
  assert.ok(codes(trace({ codiceFiscalePartitaIva: "PRVMRA80A01" })).includes("TAX_ID_FORMAT"));
}
console.log("CUSTOMER_TYPE=PASS");

// 10. Annual consumption: read, or estimated and labelled; never written as declared.
{
  assert.equal(field(trace(), "consumoAnnuo").provenance, "LETTO");
  const estimated = trace({ consumoAnnuo: "" });
  assert.deepEqual([field(estimated, "consumoAnnuo").provenance, field(estimated, "consumoAnnuo").value], ["STIMATO", "3600 kWh"]);
  assert.match(field(estimated, "consumoAnnuo").note, /CONSUMO ANNUO STIMATO/);
}
console.log("ANNUAL=PASS");

// 11. Bills stored before the structured reading and stored readings: traced from what is stored, nothing re-read.
{
  const legacyFields = Object.fromEntries(ALL.map((name) => [name, { value: name === "billingPeriod" ? "2026-09-01 - 2026-09-30" : name === "pod" ? "IT001E12345678" : "1", confidence: 1, source: "embedded-text", confirmed: true }]));
  const legacy = traceBillFields({ structuredBill: null, fields: legacyFields, vector: "EE" });
  assert.equal(legacy.structuredReading, false);
  assert.ok(codes(legacy).includes("LEGACY_READING"));
  assert.equal(legacy.definitiveAllowed, true, "approved legacy bills keep working");
  const root = await mkdtemp(path.join(os.tmpdir(), "field-trace-"));
  try {
    const tenantId = "tenant_prova-a";
    const { structured } = read({ consumoF3: "150" });
    const document = await ingestBill({ tenantId, fileName: "prova.pdf", contentType: "application/pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.7 prova", "latin1")), maxBytes: 100_000, storage: new LocalDocumentStorage(root), repository: new LocalBillRepository(root), audit: { async record() {} }, structuredExtractor: { async extract() { return structured; } } });
    const shown = toPublicDocument(document);
    assert.equal(shown.fieldTrace.definitiveAllowed, false);
    assert.ok(shown.fieldTrace.openIssues.some((item) => item.code === "BANDS_SUM"));
    assert.ok(!JSON.stringify(shown.fieldTrace).includes("MARIO PROVA\",\"page\":1,\"text"), "no source text copied into the trace");
    const confirmed = confirmBillFields({ document, tenantId, sourceVersionId: document.currentVersionId, fields: ALL, at: "2026-11-25T10:00:00.000Z" });
    const approved = approveDocumentVersion({ document: confirmed, tenantId, versionId: confirmed.currentVersionId, at: "2026-11-25T10:01:00.000Z" });
    const version = approved.versions.find((item) => item.versionId === approved.currentApprovedVersionId);
    assert.equal(billFieldTraceOf(version).definitiveAllowed, true, "approval confirms the consumption the operator checked");
    assert.equal(version.structuredBill.billedConsumption.value, 300, "the stored reading is not changed by the trace");
  } finally { await rm(root, { recursive: true, force: true }); }
}
console.log("STORED=PASS");
console.log("bill-field-trace: ok");
