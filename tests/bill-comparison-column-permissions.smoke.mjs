import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { buildBillVisibilityScope, getBillInScope } from "../app/lib/foundation/bill-visibility.ts";
import { buildEffectiveBillFeaturePermissions, BILL_FEATURES, sanitizeBillForFeatureAccess } from "../app/lib/foundation/bill-feature-permissions.ts";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { buildQuoteReceipt, comparisonAnalysis } from "../app/lib/quote/receipt.ts";

// Tony (12/11/2026, "CORREZIONE CONFRONTO ECONOMICO, FASE A"): in the comparison the original bill's column showed "Quota
// consumi 0,00" and "Altre partite 971,57" for users without the technical detail, because the server empties the bill's
// priced lines for them. The column must show the bill's own quotas (consumi 889,98 = vendita 711,96 + rete e oneri 178,02,
// fissa 14,20, potenza 67,39, accise e IVA 254,49, totale 1.226,06) for the administrator and for authorised director and
// agent alike, without new permissions, without the technical reading, without "Altre partite" absorbing known quotas and
// with tenant and branch isolation unchanged. Synthetic data only (same synthetic bill as bill-reading-visibility).

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

const receiptOf = (view) => buildQuoteReceipt({ vector: "EE", offerSupplyCost: 700, analysis: comparisonAnalysis(view.analystReview.economics), domestic: false, validUntil: null, offerComponents: [] });
// "Altre voci" may appear only for the offer side here (the synthetic offer has no component): the bill side must be 0.
const otherCurrent = (receipt) => receipt.quotas.find((quota) => quota.key === "OTHER")?.current ?? 0;
const quotas = (receipt) => Object.fromEntries(receipt.quotas.filter((quota) => quota.key !== "OTHER").map((quota) => [quota.key, { current: quota.current, seller: quota.currentSeller }]));
const EXPECTED = {
  CONSUMPTION: { current: 889.98, seller: 711.96 },
  FIXED: { current: 14.2, seller: 10.39 },
  POWER: { current: 67.39, seller: 0 },
  EXCISE: { current: 33.4, seller: null },
  VAT: { current: 221.09, seller: null },
};
const NOT_FOR_COMPARISON = ["BILL_TOTAL", "AMOUNT_DUE", "PRIOR_BALANCE", "TAX_SUBTOTAL"];

try {
  const admin = principal("ADMIN_1", "ADMIN"); const director = principal("DIRETTORE_1", "ANALYST"); const areaManager = principal("AREA_1", "ANALYST");
  const agent = principal("AGENTE_1", "VIEWER"); const otherAgent = principal("AGENTE_2", "VIEWER"); const otherDirector = principal("DIRETTORE_2", "ANALYST");
  const bill = await upload("AGENTE_1");
  const areaBill = await upload("AGENTE_3");

  // The administrator: full reading, the comparison column follows the quadro sintetico.
  const full = await openFromArchive(admin, bill.id);
  assert.ok(full.structuredBill, "the administrator keeps the full reading");
  assert.equal(full.analystReview.economics.comparisonComponents, undefined, "with the detail visible no separate list is sent");
  const reference = receiptOf(full);
  assert.equal(reference.status, "COMPLETE");
  assert.deepEqual(quotas(reference), EXPECTED, "ADMIN: quote della fattura come stampate");
  assert.equal(otherCurrent(reference), 0, "ADMIN: no Altre partite on the bill side");
  assert.equal(reference.currentTotal, 1226.06, "ADMIN: totale originale");
  assert.equal(Math.round((reference.quotas.find((q) => q.key === "CONSUMPTION").current - reference.quotas.find((q) => q.key === "CONSUMPTION").currentSeller) * 100) / 100, 178.02, "ADMIN: rete e oneri quota consumi");
  const consumptionDetail = Object.fromEntries(reference.quotas.find((q) => q.key === "CONSUMPTION").details.map((d) => [d.key, d.current]));
  assert.equal(Math.round(Object.values(consumptionDetail).reduce((a, b) => a + (b ?? 0), 0) * 100) / 100, 889.98, "ADMIN: the details add up to the printed quota");
  assert.equal(consumptionDetail.SELLER_PRINTED, 273.57, "ADMIN: the vendita the detail does not name stays inside the quota");
  console.log("COMPARISON_ADMIN=PASS");

  // Before the fix: the emptied lines alone left the quotas at 0 and the whole supply in "Altre partite".
  const agentView = await openFromArchive(agent, bill.id);
  const emptied = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 700, analysis: agentView.analystReview.economics.economicAnalysis, domestic: false, validUntil: null, offerComponents: [] });
  assert.equal(emptied.quotas.find((quota) => quota.key === "CONSUMPTION").current, 0);
  assert.equal(emptied.quotas.find((quota) => quota.key === "OTHER").current, 971.57);
  console.log("COMPARISON_BEFORE_FIX_REPRODUCED=PASS");

  const adminLines = new Map(full.analystReview.economics.economicAnalysis.components.map((line) => [line.lineId, line]));
  for (const [label, who, id] of [["DIRECTOR", director, bill.id], ["AREA_MANAGER", areaManager, areaBill.id], ["AGENT", agent, bill.id]]) {
    const shown = await openFromArchive(who, id);
    assert.ok(shown, `${label}: may open the bill of their scope`);
    // No new permission and no technical reading.
    assert.deepEqual(shown.featurePermissions.features, Object.fromEntries(BILL_FEATURES.map((feature) => [feature, false])), `${label}: no feature is granted`);
    assert.equal(shown.structuredBill, null, `${label}: full reading still hidden`);
    assert.deepEqual(shown.analystReview.economics.economicAnalysis.components, [], `${label}: technical lines still hidden`);
    assert.deepEqual(shown.analystReview.economics.chargeLines, [], `${label}: charge lines still hidden`);
    assert.deepEqual(shown.analystReview.provenance, [], `${label}: provenance still hidden`);
    // Only the priced lines the comparison needs, without raw text, evidence, subtotals or balances.
    const lines = shown.analystReview.economics.comparisonComponents;
    assert.ok(lines.length > 0, `${label}: comparison lines sent`);
    for (const line of lines) {
      assert.equal(line.aggregate, false, `${label}: no aggregate line`);
      assert.equal(NOT_FOR_COMPARISON.includes(line.classification), false, `${label}: no totals or balances`);
      assert.equal(line.documentEvidence, "", `${label}: no document evidence`);
      for (const key of ["rawDescription", "rawValue", "rawUnit", "rawQuantity", "rawUnitPrice", "rawAmount", "rawPeriod"]) assert.equal(line[key], "", `${label}: ${key} empty`);
      const original = adminLines.get(line.lineId);
      if (id === bill.id) {
        assert.ok(original, `${label}: the line exists in the bill`);
        assert.deepEqual([line.description, line.quantity, line.unitPrice, line.unit, line.amount, line.classification, line.group], [original.description, original.quantity, original.unitPrice, original.unit, original.amount, original.classification, original.group], `${label}: unit price and amount as on the bill`);
      }
    }
    assert.doesNotMatch(JSON.stringify(shown), /TESTO INTERNO|DIAGNOSTICA_INTERNA|TRASCRIZIONE INTERNA|LETTORE_INTERNO/, `${label}: no internal text`);
    // The same column as the administrator's.
    const receipt = receiptOf(shown);
    assert.deepEqual(quotas(receipt), EXPECTED, `${label}: quote della fattura come stampate`);
    assert.equal(otherCurrent(receipt), 0, `${label}: no Altre partite on the bill side`);
    assert.equal(receipt.currentTotal, 1226.06, `${label}: totale originale`);
    if (id === bill.id) assert.deepEqual(receipt.quotas, reference.quotas, `${label}: identical to the administrator`);
    console.log(`COMPARISON_${label}=PASS`);
  }

  // Isolation unchanged: outside the branch, another agent, another tenant get nothing at all.
  assert.equal(await openFromArchive(otherAgent, bill.id), null);
  assert.equal(await openFromArchive(otherDirector, bill.id), null);
  const foreign = await upload("AGENTE_X", otherTenant);
  assert.equal(await openFromArchive(admin, foreign.id), null);
  assert.equal(await openFromArchive(principal("ADMIN_B", "ADMIN", otherTenant), bill.id), null);
  console.log("COMPARISON_ISOLATION=PASS");

  // The comparison screen passes the bill through comparisonAnalysis everywhere it builds the bill column.
  const flow = await readFile(path.join(process.cwd(), "app/components/QuickQuoteFlow.tsx"), "utf8");
  assert.equal((flow.match(/analysis: comparisonAnalysis\(bill\.analystReview\.economics\)/g) ?? []).length, 2);
  assert.match(flow, /billOutsideComparison\(comparisonAnalysis\(bill\.analystReview\.economics\),/);
  assert.doesNotMatch(flow, /analysis: bill\.analystReview\.economics\.economicAnalysis/);
  console.log("COMPARISON_FLOW_WIRED=PASS");
  console.log("bill comparison column OK");
} finally {
  await rm(root, { recursive: true, force: true });
}
