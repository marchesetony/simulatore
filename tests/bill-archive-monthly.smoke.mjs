import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { documentKindOf, simulableText, archiveMonths, bulkConfirmText, bulkOutcomeText, bulkSummaryText, competenceMonths, documentsText, filterArchiveRows, groupArchiveRows, monthLabel, monthOf, periodText, totalText } from "../app/lib/ui/bill-archive-month.ts";
import { billArchiveRow, billDerivedRecords, deleteArchivedBill, deleteBillSelection, parseDeleteSelection } from "../app/lib/foundation/bill-archive.ts";
import { getBillInScope } from "../app/lib/foundation/bill-visibility.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { authorizePrincipal } from "../app/lib/auth/authorization.ts";
import { clearAuditRepository, registerAuditRepository } from "../app/lib/persistence/audit.ts";

// Tony (20/11/2026, "SIMULATORE EE — AVVIO FASE 2: ARCHIVIO BOLLETTE"): archive by month of the end of the consumption period,
// one record per invoice also when it covers several months, search and filters, deletion of one bill / a selection / a
// month with explicit confirmation and the real outcome of each, linked proposals block, sintetica + dettaglio + derived
// records deleted together, mandatory audit first, every company sees and deletes only its own bills. Synthetic data only.

const row = (id, over = {}) => ({ id, customerName: null, pod: null, supplier: null, invoiceNumber: null, periodStart: null, periodEnd: null, archiveMonth: null, competenceMonths: [], totalAmount: null, readingState: "APPROVED", documentKind: "SUMMARY", simulable: true, linkedProposals: 0, uploadedAt: "2026-11-01T00:00:00.000Z", ...over });
const withPeriod = (id, start, end, over = {}) => row(id, { periodStart: start, periodEnd: end, archiveMonth: monthOf(end), competenceMonths: competenceMonths(start, end), ...over });

// 1. Month of archive = month of the period end; a multi-month invoice is one record, found in every month it covers.
assert.equal(monthOf("2026-09-30"), "2026-09");
assert.deepEqual(competenceMonths("2026-07-01", "2026-09-30"), ["2026-07", "2026-08", "2026-09"]);
assert.deepEqual(competenceMonths("2026-11-15", "2027-01-14"), ["2026-11", "2026-12", "2027-01"], "across the year end");
assert.deepEqual(competenceMonths(null, "2026-09-30"), ["2026-09"], "start not read: only the archive month, nothing guessed");
assert.deepEqual(competenceMonths("2026-09-01", null), [], "end not read: no month at all");
assert.deepEqual(competenceMonths("2026-10-01", "2026-09-30"), ["2026-09"], "start after end (misread): only the end month");
const rows = [
  withPeriod("bim", "2026-07-01", "2026-08-31", { customerName: "Rossi Mario", pod: "IT001E12345678", invoiceNumber: "FT-2026/0901", totalAmount: "1.234,50", documentKind: "SUMMARY_WITH_DETAIL" }),
  withPeriod("ago", "2026-08-01", "2026-08-31", { customerName: "Bianchi Srl", pod: "IT001E99999999", invoiceNumber: "A-77", totalAmount: "88.10", linkedProposals: 2 }),
  withPeriod("lug", "2026-07-01", "2026-07-31", { customerName: "Verdi Anna", pod: "IT001E55555555", readingState: "TO_COMPLETE", documentKind: "DETAIL", simulable: false }),
  row("nolettura", { readingState: "READ_FAILED", documentKind: "UNKNOWN", simulable: false }),
];
const all = groupArchiveRows(rows);
assert.deepEqual(all.map((group) => [group.label, group.rows.map((item) => item.id)]), [["Agosto 2026", ["ago", "bim"]], ["Luglio 2026", ["lug"]], ["Periodo non letto", ["nolettura"]]], "each bill once, under its end month; unread period last");
assert.equal(all.flatMap((group) => group.rows).length, rows.length, "no duplicates");
const july = filterArchiveRows(rows, { month: "2026-07" });
assert.deepEqual(july.map((item) => item.id).sort(), ["bim", "lug"], "the July filter also finds the July-August bill filed in August");
assert.deepEqual(groupArchiveRows(july, "2026-07").map((group) => [group.label, group.rows.length]), [["Luglio 2026", 2]], "shown once under the month asked for");
assert.deepEqual(archiveMonths(rows), ["2026-08", "2026-07"]);
assert.equal(monthLabel("2026-12"), "Dicembre 2026");
console.log("ARCHIVE_BY_MONTH=PASS");

// 2. What is shown: read values, or "Non disponibile"; the printed total as printed, never recalculated.
assert.equal(totalText("1.234,50"), "1.234,50 €"); assert.equal(totalText("88.10"), "88,10 €"); assert.equal(totalText(null), "Non disponibile");
assert.equal(totalText("vedi allegato"), "vedi allegato", "not a number: shown as printed");
assert.equal(periodText(rows[0]), "01/07/2026 - 31/08/2026"); assert.equal(periodText(rows[3]), "Non disponibile");
assert.equal(documentsText("SUMMARY_WITH_DETAIL"), "Sintetica e dettagliata collegate"); assert.equal(documentsText("DETAIL"), "Dettagliata"); assert.equal(documentsText("UNKNOWN"), "Tipo non rilevato");
assert.match(simulableText(false), /resta in archivio/);
console.log("ARCHIVE_FIELDS_NOT_INVENTED=PASS");

// 3. Search by customer, POD (with or without spaces) and invoice number; filters by period and documents.
const ids = (filter) => filterArchiveRows(rows, filter).map((item) => item.id).sort();
assert.deepEqual(ids({ query: "rossi" }), ["bim"]);
assert.deepEqual(ids({ query: "IT001E 9999 9999" }), ["ago"], "POD typed with spaces");
assert.deepEqual(ids({ query: "ft-2026/0901" }), ["bim"]);
assert.deepEqual(ids({ query: "a-77" }), ["ago"]);
assert.deepEqual(ids({ periodFrom: "2026-08-15", periodTo: "2026-09-10" }), ["ago", "bim"], "periods overlapping the range");
assert.deepEqual(ids({ periodTo: "2026-07-15" }), ["bim", "lug"]);
assert.ok(!ids({ periodFrom: "2020-01-01" }).includes("nolettura"), "a bill without a read period never matches a period");
assert.deepEqual(ids({ documents: "SUMMARY_WITH_DETAIL" }), ["bim"]); assert.deepEqual(ids({ documents: "SUMMARY" }), ["ago"]); assert.deepEqual(ids({ documents: "DETAIL" }), ["lug"]); assert.deepEqual(ids({ documents: "UNKNOWN" }), ["nolettura"]);
assert.deepEqual(ids({ month: "2026-08", documents: "SUMMARY", query: "bianchi" }), ["ago"], "filters combine");
console.log("ARCHIVE_SEARCH_FILTERS=PASS");

// 4. Confirmation and outcomes: deletable and blocked told apart before and after.
assert.equal(bulkConfirmText([rows[0], rows[1], rows[2]]), "Eliminare definitivamente 2 bollette, con le fatture di dettaglio collegate e i dati estratti? L'operazione non si può annullare. 1 bolletta selezionata ha proposte collegate e non verrà eliminata.");
assert.equal(bulkSummaryText([{ id: "a", outcome: "DELETED" }, { id: "b", outcome: "LINKED_TO_PROPOSALS", linkedProposals: 2 }, { id: "c", outcome: "NOT_FOUND" }]), "Esito su 3 bollette: 1 eliminata, 1 bloccata, 1 non eliminata per altri motivi.");
assert.match(bulkOutcomeText({ id: "b", outcome: "LINKED_TO_PROPOSALS", linkedProposals: 2 }), /2 proposte collegate/);
assert.match(bulkOutcomeText({ id: "x", outcome: "NOT_COMPLETED" }), /resta in archivio/);
assert.throws(() => parseDeleteSelection({ ids: ["a"] }, 100), /BILL_DELETE_CONFIRMATION_REQUIRED/, "no explicit confirmation, nothing deleted");
assert.throws(() => parseDeleteSelection({ ids: [], confirmed: true }, 100), /BILL_DELETE_SELECTION_INVALID/);
assert.throws(() => parseDeleteSelection({ ids: ["../x"], confirmed: true }, 100), /BILL_DELETE_SELECTION_INVALID/);
assert.throws(() => parseDeleteSelection({ ids: Array.from({ length: 101 }, (_, index) => `b${index}`), confirmed: true }, 100), /TOO_LARGE/);
assert.deepEqual(parseDeleteSelection({ ids: ["a", "a", "b"], confirmed: true }, 100), ["a", "b"]);
console.log("ARCHIVE_DELETE_CONFIRMATION=PASS");

// 5. Server: deletion of one bill with dettaglio and derived records, audit first.
const tenant = "tenant_prova-a"; const otherTenant = "tenant_prova-b";
const at = "2026-11-20T10:00:00.000Z";
const principal = (userId, role, tenantId = tenant) => ({ userId, tenantId, role, sessionId: `s-${userId}`, issuedAt: at, expiresAt: "2026-11-20T11:00:00.000Z", source: "LOCAL_SYNTHETIC" });
const admin = principal("qa_admin", "ADMIN"); const director1 = principal("qa_dir1", "ANALYST"); const agent1 = principal("qa_ag1", "VIEWER");
const events = [];
let auditBroken = false;
registerAuditRepository({ async append(input) { if (auditBroken) throw new Error("AUDIT_DOWN"); events.push(input.payload); return input; }, async appendUnscoped(input) { events.push(input.payload); return input; }, async list() { return []; }, async get() { return null; }, async put(input) { return input; } });
const memoryRepo = (records) => { const store = new Map(records.map((item) => [`${item.tenantId}|${item.recordId}`, { version: 1, ...item }])); return { store, async list(tenantId) { return [...store.values()].filter((item) => item.tenantId === tenantId); }, async delete({ tenantId, recordId }) { if (!store.delete(`${tenantId}|${recordId}`)) throw new Error("PERSISTENCE_RECORD_NOT_FOUND"); } }; };
const derivedFor = (billId, tenantId = tenant) => ({ tenantId, payload: { result: { normalizedInput: { sourceBill: { billId, version: "v1" } } } } });
const doc = (id, over = {}) => ({ id, tenantId: tenant, lifecycleState: "ACTIVE", createdAt: at, currentApprovedVersionId: null, versions: [], ...over });
const memoryBills = (docs) => { const map = new Map(docs.map((item) => [`${item.tenantId}|${item.id}`, item])); return { map, async get(tenantId, id) { return map.get(`${tenantId}|${id}`) ?? null; }, async list(tenantId) { return [...map.values()].filter((item) => item.tenantId === tenantId); }, async delete(tenantId, id) { map.delete(`${tenantId}|${id}`); } }; };
const memoryStorage = (ids) => { const files = new Set(ids); return { files, removed: [], async remove(tenantId, id) { if (!files.delete(`${tenantId}|${id}`)) throw new Error("DOCUMENT_STORAGE_NOT_FOUND"); this.removed.push(id); } }; };
const setup = () => {
  const bills = memoryBills([doc("bill-1", { detailDocument: { linkId: "detail-1" } }), doc("bill-2"), doc("bill-linked"), doc("bill-foreign", { tenantId: otherTenant })]);
  const storage = memoryStorage([`${tenant}|bill-1`, `${tenant}|detail-1`, `${tenant}|bill-2`, `${tenant}|bill-linked`, `${otherTenant}|bill-foreign`]);
  const repositories = {
    billRepository: bills, documentStorage: storage,
    proposals: { async list(tenantId) { return [{ tenantId: tenant, payload: { proposal: { sourceBill: { billId: "bill-linked" } } } }, { tenantId: otherTenant, payload: { proposal: { sourceBill: { billId: "bill-2" } } } }].filter((item) => item.tenantId === tenantId); } },
    calculationResults: memoryRepo([{ recordId: "calc-1", ...derivedFor("bill-1") }, { recordId: "calc-2", ...derivedFor("bill-2") }, { recordId: "calc-x", ...derivedFor("bill-1", otherTenant) }]),
    comparisonResults: memoryRepo([{ recordId: "cmp-1", ...derivedFor("bill-1") }, { recordId: "cmp-1b", ...derivedFor("bill-1") }]),
    eligibilityOverrides: memoryRepo([{ recordId: "ovr-1", tenantId: tenant, payload: { billId: "bill-1" } }, { recordId: "ovr-2", tenantId: tenant, payload: { billId: "bill-linked" } }]),
  };
  return { bills, storage, repositories };
};
{
  const { bills, storage, repositories } = setup();
  assert.deepEqual(await billDerivedRecords(repositories, tenant, "bill-1"), { calculations: ["calc-1"], comparisons: ["cmp-1", "cmp-1b"], overrides: ["ovr-1"] });
  await deleteArchivedBill(admin, repositories, await bills.get(tenant, "bill-1"), "qa");
  assert.equal(await bills.get(tenant, "bill-1"), null, "bill record deleted");
  assert.deepEqual(storage.removed.sort(), ["bill-1", "detail-1"], "sintetica and dettaglio PDFs deleted together");
  assert.deepEqual([...repositories.calculationResults.store.keys()].sort(), [`${tenant}|calc-2`, `${otherTenant}|calc-x`], "only this bill's calculation removed; the other company's untouched");
  assert.equal(repositories.comparisonResults.store.size, 0);
  assert.deepEqual([...repositories.eligibilityOverrides.store.keys()], [`${tenant}|ovr-2`]);
  const deletedEvent = events.find((event) => event.action === "BILL_DELETED_BY_USER");
  assert.equal(deletedEvent.resourceId, "bill-1"); assert.equal(deletedEvent.metadata.withDetail, true); assert.equal(deletedEvent.metadata.derivedComparisons, 2);
  assert.ok(!JSON.stringify(events).includes("IT001E"), "no customer data in the audit");
}
{
  // Audit unavailable: nothing at all is deleted.
  const { bills, storage, repositories } = setup();
  auditBroken = true;
  await assert.rejects(deleteArchivedBill(admin, repositories, await bills.get(tenant, "bill-1"), "qa"), /AUDIT_DOWN/);
  auditBroken = false;
  assert.ok(await bills.get(tenant, "bill-1")); assert.equal(storage.removed.length, 0); assert.equal(repositories.comparisonResults.store.size, 2);
  // A step failing after the audit: the bill stays, NOT_COMPLETED is audited, the same deletion run again completes.
  const remove = storage.remove; let fail = true;
  storage.remove = async function (tenantId, id) { if (fail && id === "detail-1") throw new Error("DOCUMENT_STORAGE_ERROR"); return remove.call(this, tenantId, id); };
  await assert.rejects(deleteArchivedBill(admin, repositories, await bills.get(tenant, "bill-1"), "qa"), /DOCUMENT_STORAGE_ERROR/);
  assert.ok(await bills.get(tenant, "bill-1"), "the bill record is still there to retry");
  assert.ok(events.some((event) => event.action === "BILL_DELETE_NOT_COMPLETED" && event.resourceId === "bill-1" && event.outcome === "DENIED"));
  fail = false;
  await deleteArchivedBill(admin, repositories, await bills.get(tenant, "bill-1"), "qa");
  assert.equal(await bills.get(tenant, "bill-1"), null); assert.equal(storage.files.has(`${tenant}|detail-1`), false); assert.equal(storage.files.has(`${tenant}|bill-1`), false);
}
console.log("ARCHIVE_DELETE_INTEGRITY_AUDIT_FIRST=PASS");

// 6. Selection (or a month's bills): one outcome per bill; proposals block; another company's id is "not found" and stays.
{
  const { bills, repositories } = setup();
  const scope = { inScope: async (id) => (id === "bill-2-outside" ? null : bills.get(tenant, id)) };
  const results = await deleteBillSelection(admin, repositories, scope, ["bill-1", "bill-linked", "bill-foreign", "missing", "bill-2"], "qa");
  assert.deepEqual(results, [{ id: "bill-1", outcome: "DELETED" }, { id: "bill-linked", outcome: "LINKED_TO_PROPOSALS", linkedProposals: 1 }, { id: "bill-foreign", outcome: "NOT_FOUND" }, { id: "missing", outcome: "NOT_FOUND" }, { id: "bill-2", outcome: "DELETED" }], "a proposal of another company on bill-2 does not count");
  assert.ok(await bills.get(tenant, "bill-linked"), "bill with proposals kept"); assert.ok(repositories.eligibilityOverrides.store.has(`${tenant}|ovr-2`), "and its records too");
  assert.ok(await bills.get(otherTenant, "bill-foreign"), "the other company's bill is untouched");
  // One failure does not stop the others.
  const second = setup();
  const broken = { ...second.repositories, comparisonResults: { ...second.repositories.comparisonResults, async delete() { throw new Error("DB_DOWN"); } } };
  const mixed = await deleteBillSelection(admin, broken, { inScope: (id) => second.bills.get(tenant, id) }, ["bill-1", "bill-2"], "qa");
  assert.deepEqual(mixed.map((item) => item.outcome), ["NOT_COMPLETED", "DELETED"]);
  assert.ok(await second.bills.get(tenant, "bill-1"));
}
console.log("ARCHIVE_BULK_OUTCOMES=PASS");

// 7. Real branch and company scope (getBillInScope on the local repository), as the delete route runs it.
const root = await mkdtemp(path.join(os.tmpdir(), "bill-archive-monthly-"));
try {
  const repository = new LocalBillRepository(root); const storage = new LocalDocumentStorage(root);
  const membership = (id, userId, role, tenantId = tenant, managerUserId) => ({ id, userId, tenantId, role, status: "ACTIVE", permissions: ["tenant:read", "document:read"], groupIds: [], createdAt: at, updatedAt: at, ...(managerUserId ? { managerUserId } : {}) });
  const memberships = [membership("m1", "qa_admin", "TENANT_ADMIN"), membership("m2", "qa_dir1", "SALES_MANAGER"), membership("m3", "qa_ag1", "SALES_OPERATOR", tenant, "qa_dir1"), membership("m4", "qa_ag2", "SALES_OPERATOR"), membership("m5", "qa_adminb", "TENANT_ADMIN", otherTenant)];
  const record = (payload) => ({ schemaVersion: 1, recordId: payload.id, tenantId: payload.tenantId, version: 1, createdAt: at, updatedAt: at, payload });
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill-archive-monthly", "latin1"));
  const seed = async (ownerUserId, tenantId = tenant) => { const document = await ingestBill({ tenantId, fileName: "prova.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} }, extractor: { async extract() { throw new Error("BILL_EXTRACTION_REQUIRED_FIELD_MISSING"); } } }); const owned = { ...document, ownerUserId }; await repository.save(owned); return owned; };
  const empty = { async list() { return []; }, async delete() {} };
  const repositories = { billRepository: repository, documentStorage: storage, foundationMemberships: { async list(tenantId) { return memberships.filter((item) => item.tenantId === tenantId).map(record); } }, proposals: { async list() { return []; } }, calculationResults: empty, comparisonResults: empty, eligibilityOverrides: empty };
  const run = (who, ids) => deleteBillSelection(who, repositories, { inScope: (id) => getBillInScope(who, repositories, id) }, ids, "qa");
  const own = await seed("qa_ag1"); const otherBranch = await seed("qa_ag2"); const foreign = await seed("qa_adminb", otherTenant);
  // A read-failed bill: every value missing, nothing invented.
  const failedRow = billArchiveRow(await repository.get(tenant, own.id), 0, "2026-11-20");
  assert.equal(failedRow.readingState, "READ_FAILED"); assert.equal(failedRow.customerName, null); assert.equal(failedRow.pod, null); assert.equal(failedRow.totalAmount, null); assert.equal(failedRow.archiveMonth, null); assert.deepEqual(failedRow.competenceMonths, []);
  assert.equal(failedRow.documentKind, "UNKNOWN", "no reading, no kind: never guessed from the file name"); assert.equal(failedRow.simulable, false);
  assert.deepEqual(await run(director1, [otherBranch.id, foreign.id, own.id]), [{ id: otherBranch.id, outcome: "FORBIDDEN" }, { id: foreign.id, outcome: "NOT_FOUND" }, { id: own.id, outcome: "DELETED" }]);
  assert.ok(await repository.get(tenant, otherBranch.id)); assert.ok(await repository.get(otherTenant, foreign.id)); assert.equal(await repository.get(tenant, own.id), null);
  await assert.rejects(storage.read(tenant, own.id), "the PDF is gone with the record");
  assert.equal(authorizePrincipal(agent1, "WRITE").allowed, false, "an agent cannot reach the delete endpoint");
} finally { await rm(root, { recursive: true, force: true }); }
console.log("ARCHIVE_TENANT_BRANCH_ISOLATION=PASS");

// 8. Routes and screen: server checks before any read; one call for the selection; the old single endpoint shares the path.
const listRoute = await readFile("app/api/bills/archive/route.ts", "utf8");
assert.match(listRoute, /requestPrincipal\(request, "READ"\)/); assert.match(listRoute, /billInScope\(document, scope\)/); assert.match(listRoute, /document\.tenantId === principal\.tenantId/);
const deleteRoute = await readFile("app/api/bills/archive/delete/route.ts", "utf8");
assert.ok(deleteRoute.indexOf('requestPrincipal(request, "WRITE")') < deleteRoute.indexOf("parseDeleteSelection("), "permission checked before the body is even read");
assert.match(deleteRoute, /getBillInScope\(principal, repositories, id\)/);
const single = await readFile("app/api/bills/[id]/route.ts", "utf8");
assert.match(single, /await deleteArchivedBill\(principal, repositories, document, CORRELATION_ID\);/);
const panel = await readFile("app/components/BillArchivePanel.tsx", "utf8");
assert.match(panel, /requestJson<\{ readonly results: readonly BillBulkResult\[\] \}>\("\/api\/bills\/archive\/delete", \{ method: "POST", body: JSON\.stringify\(\{ ids: selectedRows\.map\(\(row\) => row\.id\), confirmed: true \}\) \}\)/);
assert.match(panel, /if \(!canDelete \|\| deleting \|\| !confirming/, "nothing is sent before the confirmation");
assert.match(panel, /Seleziona le bollette di/);
const shell = await readFile("app/components/OperationalShell.tsx", "utf8");
assert.match(shell, /section === "archive" \? <BillArchivePanel readonly=\{operateReadonly\} \/>/);
console.log("ARCHIVE_ROUTES_SCREEN=PASS");

// 9. Chiusura Fase 2 (Tony 20/11/2026), punto 1: the archive keeps every bill whatever its age; nothing is deleted only
// because it can no longer be quoted; the simulation window (QUOTE_WINDOW_MONTHS) is unchanged.
{
  const { approveDocumentVersion, createManualCorrection } = await import("../app/lib/foundation/real-bill.ts");
  const { runBillRetention } = await import("../app/lib/foundation/bill-retention.ts");
  const { QUOTE_WINDOW_MONTHS } = await import("../app/lib/calculation/quote-window.ts");
  assert.equal(QUOTE_WINDOW_MONTHS, 5, "simulation window unchanged");
  const root2 = await mkdtemp(path.join(os.tmpdir(), "bill-archive-retention-"));
  try {
    const repository = new LocalBillRepository(root2); const storage = new LocalDocumentStorage(root2);
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill-archive-retention", "latin1"));
    const seedPeriod = async (period) => {
      let document = await ingestBill({ tenantId: tenant, fileName: "vecchia.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} }, extractor: { async extract() { return { text: `Supplier: S; POD: IT001E12345678; Customer: C; Periodo: ${period}; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20`, pages: 1 }; } } });
      for (const [field, item] of Object.entries(document.versions.at(-1).fields)) document = createManualCorrection({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, field, value: field === "billingPeriod" ? item.value.replace(" - ", " al ").replace(/^/, "dal ") : `${item.value} verified`, at: "2026-10-01T00:00:00.000Z" });
      document = approveDocumentVersion({ document, tenantId: tenant, versionId: document.currentVersionId, at: "2026-10-01T00:01:00.000Z" });
      await repository.save(document); return document;
    };
    const old = await seedPeriod("01/01/2026 - 31/01/2026");
    const recent = await seedPeriod("01/10/2026 - 31/10/2026");
    const oldRow = billArchiveRow(await repository.get(tenant, old.id), 0, "2026-11-20");
    assert.equal(oldRow.archiveMonth, "2026-01", "a ten-month-old bill is still in the archive, under its month");
    assert.equal(oldRow.simulable, false, "marked as outside the simulation window");
    assert.equal(billArchiveRow(await repository.get(tenant, recent.id), 0, "2026-11-20").simulable, true);
    const run = await runBillRetention({ tenantId: tenant, repositories: { bills: repository, storage, audit: { async record() {} } }, now: "2027-12-31T00:00:00.000Z" });
    assert.equal(run.deleted, 0, "the nightly job deletes nothing by age");
    assert.ok(await repository.get(tenant, old.id)); assert.ok((await storage.read(tenant, old.id)).length > 0);
  } finally { await rm(root2, { recursive: true, force: true }); }
  const cron = await readFile("app/api/cron/bill-retention/route.ts", "utf8");
  assert.doesNotMatch(cron, /purgeOldBills\(/, "no age purge in the nightly job");
  assert.doesNotMatch(listRoute, /billTooOld/, "the archive list hides no bill by age");
  assert.match(await readFile("app/api/bills/route.ts", "utf8"), /!billTooOld\(document, now\)/, "the Nuova simulazione picker keeps its 4-month list, unchanged");
  assert.match(single, /requestPrincipal\(request, "WRITE"\)/); // single and multiple deletion by authorized users, unchanged
}
console.log("ARCHIVE_RETENTION_KEEPS_BILLS=PASS");

// 10. Punto 2: the kind of document from its content (quadro sintetico, detail lines), recorded with the reading.
{
  const { parseBillReading } = await import("../app/lib/reading/bill-reader.ts");
  const { recognizedDocumentType, toStructuredBill } = await import("../app/lib/reading/bill-reader-map.ts");
  const { normalizeStoredStructuredBillExtraction, validateStructuredBillExtraction } = await import("../app/lib/ingestion/structured-bill.ts");
  const sc = (etichetta, tipo, quota, importo) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2 });
  const line = (descrizione, voce, importo) => ({ descrizione, voce, fascia: "NESSUNA", periodo: "", quantita: "10", unita: "kWh", prezzo: "0,1", unitaPrezzo: "€/kWh", importo, pagina: 3 });
  const base = { tipoDocumento: "BOLLETTA_SINTETICA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT", fornitore: "VENDITORE DI PROVA", intestatario: "CLIENTE DI PROVA", pod: "IT000E00000009", periodoDal: "2026-10-01", periodoAl: "2026-10-31", consumoFatturato: "10", totaleBolletta: "10,00", scontrino: [sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "10,00"), sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "10,00")], dettaglio: [] };
  const detailRows = [line("Oneri ASOS", "ONERI_ASOS", "1,00"), line("Oneri ARIM", "ONERI_ARIM", "0,50")];
  const summary = parseBillReading(base);
  const detailOnly = parseBillReading({ ...base, scontrino: [], dettaglio: detailRows });
  const both = parseBillReading({ ...base, tipoDocumento: "BOLLETTA_COMPLETA", dettaglio: detailRows });
  assert.equal(recognizedDocumentType(summary), "BOLLETTA_SINTETICA");
  assert.equal(recognizedDocumentType(detailOnly), "FATTURA_DETTAGLIO", "detail lines without quadro sintetico: dettagliata, even if labelled sintetica");
  assert.equal(recognizedDocumentType(both), "BOLLETTA_COMPLETA");
  assert.equal(recognizedDocumentType({ ...both, tipoDocumento: "BOLLETTA_SINTETICA" }), "BOLLETTA_SINTETICA", "a sintetica printing a few detail lines stays sintetica");
  assert.equal(recognizedDocumentType(parseBillReading({ ...base, tipoDocumento: "NON_BOLLETTA", scontrino: [] })), null);
  const storedDetail = toStructuredBill({ reading: detailOnly, checks: [], reread: false });
  assert.equal(storedDetail.documentType, "FATTURA_DETTAGLIO", "recorded with the reading");
  assert.equal(normalizeStoredStructuredBillExtraction(JSON.parse(JSON.stringify(storedDetail))).documentType, "FATTURA_DETTAGLIO", "kept when read back from storage");
  assert.throws(() => validateStructuredBillExtraction({ ...storedDetail, documentType: "QUALSIASI" }), /documentType/);
  // The archive: a dettagliata uploaded as the only PDF is a dettagliata, whatever the file is called.
  const root3 = await mkdtemp(path.join(os.tmpdir(), "bill-archive-kind-"));
  try {
    const repository = new LocalBillRepository(root3); const storage = new LocalDocumentStorage(root3);
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill-archive-kind", "latin1"));
    const stored = await ingestBill({ tenantId: tenant, fileName: "bolletta_SINTETICA.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} }, extractor: { async extract() { throw new Error("BILL_EXTRACTION_REQUIRED_FIELD_MISSING"); } } });
    const withKind = (documentType, extra = {}) => ({ ...stored, ...extra, versions: stored.versions.map((version) => ({ ...version, structuredBill: { ...storedDetail, documentType } })) });
    assert.equal(billArchiveRow(withKind("FATTURA_DETTAGLIO"), 0, "2026-11-20").documentKind, "DETAIL", "file name says sintetica, content says dettagliata");
    assert.equal(billArchiveRow(withKind("BOLLETTA_SINTETICA"), 0, "2026-11-20").documentKind, "SUMMARY");
    assert.equal(billArchiveRow(withKind("BOLLETTA_COMPLETA"), 0, "2026-11-20").documentKind, "COMPLETE");
    assert.equal(billArchiveRow(withKind("BOLLETTA_SINTETICA", { detailDocument: { linkId: "x" } }), 0, "2026-11-20").documentKind, "SUMMARY_WITH_DETAIL", "sintetica with its verified dettagliata linked");
    assert.equal(billArchiveRow(stored, 0, "2026-11-20").documentKind, "UNKNOWN", "nothing read: not recognized, never guessed from the name");
  } finally { await rm(root3, { recursive: true, force: true }); }
  assert.equal(documentKindOf(undefined, false), "UNKNOWN");
  // The precedence rule is untouched: sintetica for the total, dettagliata for the components when linked and verified.
  const link = await readFile("app/lib/foundation/bill-detail-link.ts", "utf8");
  assert.match(link, /Totals and the quadro sintetico's own rows are the sintetica's: the detail contributes only its charge lines\./);
}
console.log("ARCHIVE_DOCUMENT_KIND=PASS");

clearAuditRepository();
console.log("bill archive monthly ok");
