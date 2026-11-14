import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approveDocumentVersion, confirmBillFields, createAnalystRefreshVersion, LocalBillRepository, requiredFieldNames, toPublicApprovedDocument, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { structuredBillFields } from "../app/lib/ingestion/structured-bill.ts";
import { parseBillReading } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";

// Tony (13/11/2026, "rilettura bollette approvate", soluzione A): a bill whose scontrino was read, approved too, can be read
// again with the existing "reread-analyst" operation. The new reading is a new version to verify, never approved on its own;
// the approved version, the history and the simulations made on it stay as they are. Synthetic data only.

const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const base = {
  tipoDocumento: "BOLLETTA_SINTETICA", vettore: "EE", tipoCliente: "DOMESTICO", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.R.L.", intestatario: "CLIENTE DI PROVA", pod: "IT000E00000001",
  tipoClienteStampato: "Domestico residente", potenzaImpegnataKw: "1,5", mercato: "MERCATO LIBERO",
  periodoStampato: "01/10/2026 - 31/10/2026", periodoDal: "2026-10-01", periodoAl: "2026-10-31",
  consumoFatturato: "10", consumoAnnuo: "1.200", totaleBolletta: "35,00",
  scontrino: [
    sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "3,42", { quantita: "10", unita: "kWh", prezzoMedio: "0,342", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la vendita", "DI_CUI_VENDITA", "CONSUMI", "2,92", { prezzoMedio: "0,292", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "0,50", { prezzoMedio: "0,05", unitaPrezzo: "€/kWh" }),
    sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "18,74", { quantita: "1", unita: "mesi" }),
    sc("di cui spesa per la vendita", "DI_CUI_VENDITA", "FISSA", "15,00", { prezzoMedio: "15,00", unitaPrezzo: "€/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "3,74", { prezzoMedio: "3,74", unitaPrezzo: "€/mese" }),
    sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "6,40", { quantita: "1,5", unita: "kW", prezzoMedio: "4,266667", unitaPrezzo: "€/kW/mese" }),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "6,40", { prezzoMedio: "4,266667", unitaPrezzo: "€/kW/mese" }),
    sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "6,44"),
    sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "35,00"),
  ],
  dettaglio: [],
  assenti: [{ campo: "dettaglio", motivo: "bolletta sintetica" }],
};
const firstReading = toStructuredBill({ reading: parseBillReading(base), checks: [], reread: false });
const tenantId = "tenant_reread-test";
const at = "2026-11-13T12:00:00.000Z";
const draft = (id) => ({
  id, tenantId, fileName: "sintetica.pdf", objectKey: `${tenantId}/${id}.pdf`, size: 100, createdAt: at, updatedAt: at,
  currentVersionId: `${id}-v1`, currentApprovedVersionId: null,
  versions: [{ versionId: `${id}-v1`, versionNumber: 1, supersedesVersionId: null, status: "REVIEW_REQUIRED", fields: structuredBillFields(firstReading), createdAt: at, origin: "INGESTION", structuredBill: firstReading }],
  provenance: [{ eventId: `e1-${id}`, type: "INGESTION", origin: "INGESTION", tenantId, documentId: id, sourceVersionId: null, resultVersionId: `${id}-v1`, field: null, previousValue: null, nextValue: null, at }],
  approvals: [],
});
// Stored and read back, as the repository normalizes a bill (lifecycle, retention).
const root = await mkdtemp(path.join(os.tmpdir(), "bill-reread-approved-"));
const repository = new LocalBillRepository(root);
const stored = async (document) => { await repository.save(document); return repository.get(tenantId, document.id); };
const confirmed = confirmBillFields({ document: await stored(draft("bill-approved")), tenantId, sourceVersionId: "bill-approved-v1", fields: [...requiredFieldNames], at });
const approved = approveDocumentVersion({ document: confirmed, tenantId, versionId: confirmed.currentVersionId, at });
assert.equal(approved.currentApprovedVersionId, approved.currentVersionId, "fixture: approved bill with the scontrino read");
assert.equal(toPublicDocument(approved).chargeLinesUnread, false, "fixture: the old condition would hide the reread");
const approvedId = approved.currentApprovedVersionId;
const before = JSON.stringify(approved.versions);

// The new reading (with the printed components, as the current reader returns them).
const secondReading = toStructuredBill({ reading: parseBillReading({ ...base, componentiStampate: [{ etichetta: "Oneri di sistema", categoria: "ONERI_SISTEMA", importo: "3,95", sezione: "riepilogo", pagina: 5 }] }), checks: [], reread: false });

// 1. Approved bill with a complete scontrino: a new version to verify, not approved, history and approval kept.
const reread = createAnalystRefreshVersion({ document: approved, tenantId, sourceVersionId: approved.currentVersionId, analyst: null, at, refine: () => secondReading });
assert.equal(reread.versions.length, approved.versions.length + 1);
assert.equal(JSON.stringify(reread.versions.slice(0, -1)), before, "earlier versions, with their confirmations, unchanged");
const latest = reread.versions.at(-1);
assert.equal(latest.status, "REVIEW_REQUIRED", "the new reading is to be reviewed");
assert.equal(latest.supersedesVersionId, approvedId);
assert.notEqual(reread.currentVersionId, approvedId);
assert.equal(reread.currentApprovedVersionId, approvedId, "no automatic approval: the approved version stays the approved one");
assert.deepEqual(reread.approvals, approved.approvals, "approval records kept");
assert.equal(latest.structuredBill.printedComponents?.length, 1, "the new reading is the stored one");
assert.ok(requiredFieldNames.every((name) => approved.versions.at(-1).fields[name]?.confirmed === true), "fixture: the approved version was confirmed by hand");
assert.ok(Object.values(latest.fields).every((field) => field.confirmed !== true), "the manual confirmations are not carried over: they must be checked again");
assert.equal(toPublicApprovedDocument(reread).currentVersionId, approvedId, "the approved view still shows the approved version");
// A second click on the same version is refused (the existing stale-version check).
assert.throws(() => createAnalystRefreshVersion({ document: reread, tenantId, sourceVersionId: approvedId, analyst: null, at, refine: () => secondReading }), /DOCUMENT_VERSION_STALE/);
assert.throws(() => createAnalystRefreshVersion({ document: approved, tenantId: "tenant_other", sourceVersionId: approved.currentVersionId, analyst: null, at, refine: () => secondReading }), /TENANT_ACCESS_DENIED/);

// 2. A bill not approved yet: same new version to verify, nothing approved.
const pending = createAnalystRefreshVersion({ document: await stored(draft("bill-pending")), tenantId, sourceVersionId: "bill-pending-v1", analyst: null, at, refine: () => secondReading });
assert.deepEqual([pending.versions.length, pending.currentApprovedVersionId, pending.versions.at(-1).status], [2, null, "REVIEW_REQUIRED"]);

// 3. Simulations and proposals: they read the approved version only, and the reread touches the bill record only.
const engine = await readFile("app/lib/calculation/bill-driven.ts", "utf8");
assert.match(engine, /const versionId = document\.currentApprovedVersionId \?\? fail\("SOURCE_BILL_NOT_APPROVED"\);/);
assert.match(engine, /if \(prepared\.context\.billVersionId !== input\.billVersionId\) fail\("SOURCE_BILL_VERSION_MISMATCH"\);/);
const route = await readFile("app/api/bills/[id]/route.ts", "utf8");
const block = route.slice(route.indexOf('if (operation?.operation === "reread-analyst")'), route.indexOf('return deny("BILL_OPERATION_INVALID", "Unsupported bill operation"'));
assert.match(block, /createAnalystRefreshVersion\(\{ document, tenantId, sourceVersionId: operation\.versionId, analyst: null, at: now, refine: \(\) => reading \}\)/);
assert.match(block, /repository\.saveIfCurrentVersion\(refreshed, operation\.versionId,/, "saved only if still the current version");
assert.doesNotMatch(block, /comparison|proposal|approve/i, "no comparison, proposal or approval touched");

// 4. Authorized and unauthorized users: server checks unchanged; read-only users do not get the button.
assert.match(route, /export async function PATCH[\s\S]*?const principal = await requestPrincipal\(request, "OPERATE"\);/);
const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
assert.match(flow, /const billReread = \(bill: BillDocumentModel\) => readonly \? null : <>/);
assert.match(flow, /\{analystRetry\(draft\) \?\? billReread\(draft\)\}/, "available in review when the scontrino was read; the warning keeps its own button otherwise");
assert.match(flow, /onClick=\{\(\) => void rereadAnalyst\(bill\.id\)\} disabled=\{Boolean\(pending\)\}/, "same operation, blocked while a reading is running");
assert.match(flow, /body: JSON\.stringify\(\{ operation: "reread-analyst", versionId: current\.currentVersionId \}\)/);
assert.match(flow, /Le correzioni manuali fatte in precedenza non vengono riportate: ricontrolla tutti i dati prima di confermare\./);
assert.match(flow, /Nuova lettura da verificare: controlla tutti i dati, comprese le correzioni fatte a mano in precedenza\./);

await rm(root, { recursive: true, force: true });
console.log("bill-reread-approved OK");
