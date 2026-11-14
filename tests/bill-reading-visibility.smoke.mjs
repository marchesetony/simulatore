import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { buildBillVisibilityScope, getBillInScope } from "../app/lib/foundation/bill-visibility.ts";
import { buildEffectiveBillFeaturePermissions, BILL_FEATURES, permissionPayload, sanitizeBillForFeatureAccess } from "../app/lib/foundation/bill-feature-permissions.ts";
import { billReadingView } from "../app/lib/foundation/bill-reading-view.ts";
import { authorizePrincipal } from "../app/lib/auth/authorization.ts";
import { billForReading, billReadSections } from "../app/lib/ui/bill-read-details.ts";

// Tony (10/11/2026, "visibilità dati bolletta per ruolo"): every commercial user who may consult a bill (company administrator,
// director, area manager, agent) sees the four sections of "Dati letti"; that grants no management, CTE or administration
// right, the reading's internals stay hidden and "Dettaglio tecnico" keeps guarding the full reading. Synthetic data only:
// the same synthetic bill as bill-read-details (no real customer, POD, address or supplier), in a temporary folder.

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

// Internals of the reading that must never reach a user without "Dettaglio tecnico".
const INTERNAL = {
  readingSources: [{ field: "pod", page: 1, text: "TESTO INTERNO DI PROVA" }],
  analystDiagnostic: { code: "DIAGNOSTICA_INTERNA", requestId: "req_interno", message: "messaggio interno" },
  scontrinoTranscript: "TRASCRIZIONE INTERNA",
  reader: "LETTORE_INTERNO",
  readingReread: true,
};
const readingWithInternals = { ...structuredBill, ...INTERNAL };

const tenant = "tenant_prova-a";
const otherTenant = "tenant_prova-b";
const at = "2026-11-10T10:00:00.000Z";
const principal = (userId, role, tenantId = tenant) => ({ userId, tenantId, role, sessionId: `s-${userId}`, issuedAt: at, expiresAt: "2026-11-10T11:00:00.000Z", source: "LOCAL_SYNTHETIC" });
const membership = (id, userId, role, managerUserId) => ({ id, userId, tenantId: tenant, role, status: "ACTIVE", permissions: ["tenant:read", "document:read"], groupIds: [], createdAt: at, updatedAt: at, ...(managerUserId ? { managerUserId } : {}) });
const memberships = [membership("m-adm", "ADMIN_1", "TENANT_ADMIN"), membership("m-dir", "DIRETTORE_1", "SALES_MANAGER"), membership("m-am", "AREA_1", "SALES_MANAGER"), membership("m-dir2", "DIRETTORE_2", "SALES_MANAGER"), membership("m-ag1", "AGENTE_1", "SALES_OPERATOR", "DIRETTORE_1"), membership("m-ag3", "AGENTE_3", "SALES_OPERATOR", "AREA_1"), membership("m-ag2", "AGENTE_2", "SALES_OPERATOR", "DIRETTORE_2")];
const record = (payload) => ({ schemaVersion: 1, recordId: payload.id, tenantId: payload.tenantId, version: 1, createdAt: at, updatedAt: at, payload });

const root = await mkdtemp(path.join(os.tmpdir(), "bill-reading-visibility-"));
const repository = new LocalBillRepository(root);
const storage = new LocalDocumentStorage(root);
const audit = { async record() {} };
const repositories = { billRepository: repository, foundationMemberships: { async list(tenantId) { return memberships.filter((item) => item.tenantId === tenantId).map(record); } } };
const upload = async (ownerUserId, tenantId = tenant) => {
  const document = await ingestBill({ tenantId, fileName: "prova.pdf", contentType: "application/pdf", bytes: new Uint8Array(Buffer.from(`%PDF-1.7 ${ownerUserId}`, "latin1")), maxBytes: 100_000, storage, repository, audit, structuredExtractor: { async extract() { return readingWithInternals; } } });
  const owned = { ...document, ownerUserId };
  await repository.save(owned);
  return owned;
};
// The steps of GET /api/bills/[id] and POST /api/bills: scope check first, then the same filter for both.
const accessOf = (who, records = []) => buildEffectiveBillFeaturePermissions(buildBillVisibilityScope(who, memberships), records, memberships);
const openFromArchive = async (who, id, records = []) => {
  const document = await getBillInScope(who, repositories, id);
  return document ? sanitizeBillForFeatureAccess(toPublicDocument(document), accessOf(who, records)) : null;
};
const fromUpload = (who, document, records = []) => sanitizeBillForFeatureAccess(toPublicDocument(document), accessOf(who, records));

// documentPriceRows comes with the reading itself; the other internals are added above.
const INTERNAL_KEYS = [...Object.keys(INTERNAL), "documentPriceRows", "monthlyBandEvidence", "detectedMonthlyBandEvidence", "monthlyBandDocumentEvidenceStatus"];
const assertNoInternals = (view, label) => {
  assert.ok(view, `${label}: bill view present`);
  for (const key of INTERNAL_KEYS) assert.equal(key in view, false, `${label}: ${key} is not sent`);
  assert.equal(view.supplyProfile && "asosClassEvidence" in view.supplyProfile, false, `${label}: supply-profile evidence is not sent`);
  assert.doesNotMatch(JSON.stringify(view), /TESTO INTERNO|DIAGNOSTICA_INTERNA|TRASCRIZIONE INTERNA|LETTORE_INTERNO/, `${label}: no internal text`);
};

try {
  const admin = principal("ADMIN_1", "ADMIN"); const director = principal("DIRETTORE_1", "ANALYST"); const areaManager = principal("AREA_1", "ANALYST");
  const agent = principal("AGENTE_1", "VIEWER"); const otherAgent = principal("AGENTE_2", "VIEWER"); const otherDirector = principal("DIRETTORE_2", "ANALYST");
  const bill = await upload("AGENTE_1");
  const areaBill = await upload("AGENTE_3");

  // The full reading, as the company administrator (all features) sees it: the reference for every other role.
  const full = await openFromArchive(admin, bill.id);
  const reference = billReadSections(billForReading(full));
  assert.equal(reference.length, 4);
  assert.deepEqual(reference.map((section) => section.id), ["SUPPLY", "TECHNICAL", "CONTRACT", "ECONOMICS"]);
  assert.ok(full.structuredBill, "the administrator keeps the full reading");
  assertNoInternals(full.billReading, "ADMIN");
  console.log("READING_ADMIN=PASS");

  // Director, area manager, agent: same four sections, same values, without "Dettaglio tecnico" and without any new right.
  for (const [label, who, id] of [["DIRECTOR", director, bill.id], ["AREA_MANAGER", areaManager, areaBill.id], ["AGENT", agent, bill.id]]) {
    const shown = await openFromArchive(who, id);
    assert.ok(shown, `${label}: may open the bill of their scope`);
    assert.equal(shown.structuredBill, null, `${label}: the full reading stays behind "Dettaglio tecnico"`);
    assert.equal(shown.regulatoryAudit, null, `${label}: regulatory detail stays hidden`);
    assert.deepEqual(shown.analystReview.provenance, [], `${label}: provenance stays hidden`);
    assert.deepEqual(shown.featurePermissions.features, Object.fromEntries(BILL_FEATURES.map((feature) => [feature, false])), `${label}: no feature is granted`);
    assertNoInternals(shown.billReading, label);
    const sections = billReadSections(billForReading(shown));
    const expected = id === bill.id ? reference : billReadSections(billForReading(await openFromArchive(admin, id)));
    assert.deepEqual(sections, expected, `${label}: the same four sections as the administrator`);
    const rows = sections.flatMap((section) => section.rows.map((row) => `${row.label}=${row.value}`)).join("\n");
    for (const expectedRow of [/^F1=1\.791 kWh$/m, /^F2=354 kWh$/m, /^F3=527 kWh$/m, /^Potenza impegnata=15/m, /^PCV=/m, /^Spread=/m, /^Fasce=/m, /^Totale fattura=1\.226,06/m]) assert.match(rows, expectedRow, `${label}: ${expectedRow}`);
    const view = billForReading(shown).structuredBill;
    assert.deepEqual(view.economicChargeLines, full.structuredBill.economicChargeLines, `${label}: economic components for the calculated values (PCV, price structure)`);
    assert.deepEqual(view.extendedFacts, full.structuredBill.extendedFacts, `${label}: printed facts (offer, index, spread)`);
    assert.deepEqual(view.f1Consumption, full.structuredBill.f1Consumption);
    assert.deepEqual(shown.currentSpread ?? null, full.currentSpread ?? null, `${label}: same spread from the GME PUN`);
    console.log(`READING_${label}=PASS`);
  }
  // Seeing the data grants nothing: the roles' rights are those of the authorization rules, unchanged.
  for (const [who, role] of [[agent, "VIEWER"], [director, "ANALYST"]]) assert.equal(who.role, role);
  assert.equal(authorizePrincipal(agent, "WRITE").allowed, false, "an agent still cannot manage bills (delete, approve, CTE)");
  assert.equal(authorizePrincipal(agent, "ADMIN").allowed, false, "an agent still cannot administer");
  assert.equal(authorizePrincipal(director, "ADMIN").allowed, false, "a director still cannot administer");
  assert.equal(authorizePrincipal(director, "WRITE").allowed, true, "a director keeps what they had");
  console.log("READING_GRANTS_NOTHING=PASS");

  // "Dettaglio tecnico" still works as before: granted, the full reading is sent; explicitly denied, it is not.
  const grant = permissionPayload({ tenantId: tenant, feature: "BILL_TECHNICAL_DETAILS", targetType: "USER", targetId: "AGENTE_1", enabled: true, changedByUserId: "ADMIN_1", changedAt: at });
  const granted = await openFromArchive(agent, bill.id, [grant]);
  assert.ok(granted.structuredBill?.readingSources, "with the feature the full reading (internals included) is sent, as before");
  assert.deepEqual(billReadSections(billForReading(granted)), reference);
  console.log("TECHNICAL_DETAIL_FEATURE_UNCHANGED=PASS");

  // No access: another agent, a director of another branch, another tenant, a document that does not exist.
  assert.equal(await openFromArchive(otherAgent, bill.id), null, "an agent without access to the bill gets nothing");
  console.log("READING_NO_ACCESS=PASS");
  assert.equal(await openFromArchive(otherDirector, bill.id), null, "outside the commercial branch: nothing");
  console.log("READING_OUTSIDE_BRANCH=PASS");
  const foreign = await upload("AGENTE_X", otherTenant);
  assert.equal(await openFromArchive(admin, foreign.id), null, "another tenant's bill is not found, not even by the administrator");
  assert.equal(await openFromArchive(principal("ADMIN_B", "ADMIN", otherTenant), bill.id), null, "and the other tenant does not see ours");
  assert.equal(await openFromArchive(admin, "documento-inesistente"), null);
  console.log("READING_OTHER_TENANT=PASS");

  // New upload and archive: the same sections for the same user.
  for (const who of [admin, director, agent]) {
    assert.deepEqual(billReadSections(billForReading(fromUpload(who, bill))), billReadSections(billForReading(await openFromArchive(who, bill.id))));
  }
  assert.deepEqual(billReadSections(billForReading(fromUpload(agent, bill))), reference);
  const routes = await Promise.all(["app/api/bills/route.ts", "app/api/bills/[id]/route.ts", "app/api/bills/[id]/retry/route.ts"].map((file) => readFile(path.join(process.cwd(), file), "utf8")));
  for (const source of routes) assert.match(source, /sanitizeBillForFeatureAccess\(/, "every route that returns a bill goes through the same filter");
  const flow = await readFile(path.join(process.cwd(), "app/components/QuickQuoteFlow.tsx"), "utf8");
  assert.match(flow, /const readBill = draft \? billForReading\(draft\) : null;/);
  assert.match(flow, /<BillReadDetails sections=\{billReadSections\(readBill\)\} calculated=\{calculatedFacts\(readBill\)\} \/>/, "the sections and the calculated values read the bill view");
  console.log("READING_UPLOAD_AND_ARCHIVE=PASS");

  assert.equal(billReadingView(null), null);
  assert.equal(billReadingView(undefined), null);
  console.log("bill reading visibility OK");
} finally {
  await rm(root, { recursive: true, force: true });
}
