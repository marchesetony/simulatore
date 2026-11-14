import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { checkBillReading } from "../app/lib/reading/bill-reader-checks.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { productCheckResolved, withCurrentReadingChecks } from "../app/lib/reading/stored-reading-checks.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { buildEffectiveBillFeaturePermissions, sanitizeBillForFeatureAccess } from "../app/lib/foundation/bill-feature-permissions.ts";
import { buildBillVisibilityScope } from "../app/lib/foundation/bill-visibility.ts";

// Tony (11/11/2026, "correzione avvisi storici Eurocent"): a bill read before 28591ae keeps in its stored checks four false
// quantity × price warnings on prices printed in Eurocent. When the bill is shown again, the warning is hidden only if the
// charge line saved with the bill now adds up; real errors, warnings without a verifiable line and every other warning stay;
// the stored bill is never changed and no reader is called. Synthetic data only: no real customer, POD or supplier.

const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const dt = (descrizione, voce, quantita, unita, prezzo, unitaPrezzo, importo) => ({ descrizione, voce, fascia: "NESSUNA", periodo: "", quantita, unita, prezzo, unitaPrezzo, importo, pagina: 3 });

const reading = parseBillReading({
  tipoDocumento: "BOLLETTA_COMPLETA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "AZIENDA DI PROVA SPA", pod: "IT000E00000000",
  tipoClienteStampato: "altri usi", tensioneStampata: "380,0 V", potenzaImpegnataKw: "15,0",
  periodoStampato: "01/09/2026 - 30/09/2026", periodoDal: "2026-09-01", periodoAl: "2026-09-30",
  consumoFatturato: "100", consumoF1: "50", consumoF2: "20", consumoF3: "30", totaleBolletta: "20,00",
  scontrino: [sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "20,00", { quantita: "1", unita: "mesi" }), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "20,00")],
  dettaglio: [
    dt("Distribuzione elettrica - Corrispettivo fisso - Periodo 01/09/2026-30/09/2026", "TRASPORTO_QUOTA_FISSA", "1", "mesi", "49,020000", "Eurocent/mese", "0,49"),
    dt("UC6 - Componente fissa - Periodo 01/09/2026-30/09/2026", "TRASPORTO_QUOTA_FISSA", "1", "mesi", "14,020000", "Eurocent/mese", "0,14"),
    dt("Asos - Quota fissa", "ONERI_ASOS", "1", "mesi", "110,280000", "Eurocent/mese", "1,10"),
    dt("Arim - Quota fissa", "ONERI_ARIM", "1", "mesi", "25,690000", "Eurocent/mese", "0,26"),
    // A real error: 2 × 30 Eurocent is 0,60 €, not 6,00 €.
    dt("Quota errata", "TRASPORTO_QUOTA_FISSA", "2", "mesi", "30,000000", "Eurocent/mese", "6,00"),
    // Two lines with the same label and numbers but different units: the match is uncertain.
    dt("Quota doppia", "ALTRO_VENDITA", "1", "mesi", "50,000000", "Eurocent/mese", "0,50"),
    dt("Quota doppia", "ALTRO_VENDITA", "1", "mesi", "50,000000", "€/mese", "0,50"),
  ],
  assenti: [], fonti: [], valoriFormula: [],
});
// The text the check wrote before 28591ae (price read as euro), as stored on the bills read then.
const old = (label, quantity, price, amount) => `"${label}": ${quantity} × ${price} = ${(Number(quantity) * Number(price.replace(",", "."))).toFixed(2)} € ma l'importo letto è ${amount} €.`;
const geremia = [
  old("Distribuzione elettrica - Corrispettivo fisso - Periodo 01/09/2026-30/09/2026", "1", "49,020000", "0,49"),
  old("UC6 - Componente fissa - Periodo 01/09/2026-30/09/2026", "1", "14,020000", "0,14"),
  old("Asos - Quota fissa", "1", "110,280000", "1,10"),
  old("Arim - Quota fissa", "1", "25,690000", "0,26"),
];
assert.equal(geremia[0], `"Distribuzione elettrica - Corrispettivo fisso - Periodo 01/09/2026-30/09/2026": 1 × 49,020000 = 49.02 € ma l'importo letto è 0,49 €.`);
const realError = old("Quota errata", "2", "30,000000", "6,00");
const ambiguous = old("Quota doppia", "1", "50,000000", "0,50");
const noLine = old("Riga non salvata", "1", "10,000000", "0,10");
const changedAmount = `"Asos - Quota fissa": 1 × 110,280000 = 110.28 € ma l'importo letto è 1,20 €.`;
const other = "F1 50 + F2 20 + F3 31 non dà il consumo fatturato 100 kWh: rileggi i consumi per fascia e il totale.";
const storedChecks = [...geremia, realError, ambiguous, noLine, changedAmount, other];
const structured = { ...toStructuredBill({ reading, checks: [], reread: true }), readingChecks: storedChecks };

// The current check, on the same reading, raises only the real error (and the uncertain euro line): no reader is needed.
assert.deepEqual(checkBillReading(reading).filter((check) => check.code === "PRODUCT").map((check) => check.message.split('"')[1]), ["Quota errata", "Quota doppia"]);

// 1. The four GEREMIA-like warnings are hidden; every other warning stays, in its order.
const lines = structured.economicChargeLines;
for (const message of geremia) assert.equal(productCheckResolved(message, lines), true, message);
for (const message of [realError, ambiguous, noLine, changedAmount, other]) assert.equal(productCheckResolved(message, lines), false, message);
const shown = withCurrentReadingChecks(structured);
assert.deepEqual(shown.readingChecks, [realError, ambiguous, noLine, changedAmount, other]);
assert.equal(structured.readingChecks.length, 9, "the stored reading object is not changed");
// Not "every warning containing Eurocent": a line without a unit, or with a different label, is not verifiable.
assert.equal(productCheckResolved(geremia[2], lines.map((line) => line.description === "Asos - Quota fissa" ? { ...line, unit: "" } : line)), false);
assert.equal(productCheckResolved(geremia[2], lines.filter((line) => line.description !== "Asos - Quota fissa")), false);
// No stored checks, or none resolved: the same object comes back.
assert.equal(withCurrentReadingChecks({ ...structured, readingChecks: [other] }).readingChecks.length, 1);
const noChecks = { ...structured, readingChecks: undefined };
assert.equal(withCurrentReadingChecks(noChecks), noChecks);

// 2. An archived bill: the same rule on every opening, for the full reading and for the commercial roles' view; the stored
// bill (repository and file on disk) stays byte for byte as saved.
const at = "2026-11-11T10:00:00.000Z";
const agentMembership = { id: "m-ag", userId: "AGENTE_PROVA", tenantId: "tenant_prova", role: "SALES_OPERATOR", status: "ACTIVE", permissions: ["tenant:read", "document:read"], groupIds: [], createdAt: at, updatedAt: at };
const agentPrincipal = { userId: "AGENTE_PROVA", tenantId: "tenant_prova", role: "VIEWER", sessionId: "s-agente", issuedAt: at, expiresAt: "2026-11-11T11:00:00.000Z", source: "LOCAL_SYNTHETIC" };
const agentAccess = buildEffectiveBillFeaturePermissions(buildBillVisibilityScope(agentPrincipal, [agentMembership]), [], [agentMembership]);
const root = await mkdtemp(path.join(os.tmpdir(), "bill-eurocent-stored-"));
try {
  const repository = new LocalBillRepository(root);
  const storage = new LocalDocumentStorage(root);
  const document = await ingestBill({ tenantId: "tenant_prova", fileName: "prova.pdf", contentType: "application/pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.7 prova", "latin1")), maxBytes: 100_000, storage, repository, audit: { async record() {} }, structuredExtractor: { async extract() { return structured; } } });
  const files = async () => { const out = {}; const walk = async (dir) => { for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await walk(full); else out[full] = (await readFile(full)).toString("base64"); } }; await walk(root); return out; };
  const before = await files();
  for (let opening = 0; opening < 2; opening += 1) {
    const stored = await repository.get("tenant_prova", document.id);
    assert.deepEqual(stored.versions[0].structuredBill.readingChecks, storedChecks, "the stored checks are kept as read");
    const shownDocument = toPublicDocument(stored);
    assert.deepEqual(shownDocument.structuredBill.readingChecks, [realError, ambiguous, noLine, changedAmount, other]);
    // Same values on screen: only the warnings change.
    assert.deepEqual({ ...shownDocument.structuredBill, readingChecks: null }, { ...stored.versions[0].structuredBill, readingChecks: null });
    const agent = sanitizeBillForFeatureAccess(shownDocument, agentAccess);
    assert.equal(agent.structuredBill, null);
    assert.deepEqual(agent.billReading.readingChecks, [realError, ambiguous, noLine, changedAmount, other]);
  }
  assert.deepEqual(await files(), before, "nothing is written when the bill is shown");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("bill-reader eurocent stored checks OK");
