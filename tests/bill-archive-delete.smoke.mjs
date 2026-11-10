import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { billDeleteDecision, proposalsFromBill } from "../app/lib/foundation/bill-delete.ts";
import { getBillInScope } from "../app/lib/foundation/bill-visibility.ts";
import { deleteBillPermanently } from "../app/lib/foundation/bill-retention.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { authorizePrincipal } from "../app/lib/auth/authorization.ts";
import { BillDeleteError, requestBillDelete, deleteReportText, canDeleteBills, deleteConfirmText, deleteResultOf, deleteSelectedBills, deleteSummaryText, DELETE_RESULT_LABEL, pendingBillEntry, approvedBillEntry, archiveEntryLabel, searchArchive } from "../app/lib/ui/bill-archive.ts";

// Tony (10/11/2026, "archivio compatto e cancellazione selettiva", fasi A+B): DELETE /api/bills/[id] says what really
// happened to each document (deleted / not found / outside the branch / linked to a proposal), the screen deletes only
// after a dedicated confirmation and lists the outcome per document. Synthetic data in a temporary folder only.

const tenant = "tenant_prova-a";
const otherTenant = "tenant_prova-b";
const at = "2026-11-10T10:00:00.000Z";
const principal = (userId, role, tenantId = tenant) => ({ userId, tenantId, role, sessionId: `s-${userId}`, issuedAt: at, expiresAt: "2026-11-10T11:00:00.000Z", source: "LOCAL_SYNTHETIC" });
const membership = (id, userId, role, managerUserId) => ({ id, userId, tenantId: tenant, role, status: "ACTIVE", permissions: ["tenant:read", "document:read"], groupIds: [], createdAt: at, updatedAt: at, ...(managerUserId ? { managerUserId } : {}) });
const memberships = [membership("m-adm", "ADMIN_1", "TENANT_ADMIN"), membership("m-dir1", "DIRETTORE_1", "SALES_MANAGER"), membership("m-dir2", "DIRETTORE_2", "SALES_MANAGER"), membership("m-ag1", "AGENTE_1", "SALES_OPERATOR", "DIRETTORE_1"), membership("m-ag2", "AGENTE_2", "SALES_OPERATOR", "DIRETTORE_2")];
const record = (payload, tenantId = tenant) => ({ schemaVersion: 1, recordId: payload.id, tenantId, version: 1, createdAt: at, updatedAt: at, payload });
const proposal = (billId, tenantId = tenant) => ({ tenantId, payload: { proposalId: `p-${billId}`, proposalFingerprint: "x", proposal: { sourceBill: { billId, version: "v1" } } } });

const root = await mkdtemp(path.join(os.tmpdir(), "bill-archive-delete-"));
const repository = new LocalBillRepository(root);
const storage = new LocalDocumentStorage(root);
const audit = { async record() {} };
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill-archive-delete-smoke", "latin1"));
const seed = async (ownerUserId, tenantId = tenant) => {
  const document = await ingestBill({ tenantId, fileName: "prova.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, extractor: { async extract() { throw new Error("BILL_EXTRACTION_REQUIRED_FIELD_MISSING"); } } });
  const owned = { ...document, ownerUserId };
  await repository.save(owned);
  return owned;
};
// The route's own steps (app/api/bills/[id]/route.ts, DELETE), run on the synthetic repository.
const deleteAs = async (who, id, proposals = []) => {
  const repositories = { billRepository: repository, foundationMemberships: { async list(tenantId) { return memberships.filter((item) => item.tenantId === tenantId).map(record); } } };
  const stored = await repository.get(who.tenantId, id);
  const document = stored ? await getBillInScope(who, repositories, id) : null;
  const linkedProposals = document ? proposalsFromBill(proposals, who.tenantId, document.id) : 0;
  const decision = billDeleteDecision({ tenantId: who.tenantId, stored, inScope: document !== null, linkedProposals });
  if (decision.outcome !== "ALLOWED" || !document) return { status: decision.status, outcome: decision.outcome, code: decision.code };
  await deleteBillPermanently({ tenantId: who.tenantId, documentId: document.id, repositories: { bills: repository, storage, audit } });
  return { status: 200, outcome: "DELETED", deleted: true };
};

try {
  const admin = principal("ADMIN_1", "ADMIN"); const director1 = principal("DIRETTORE_1", "ANALYST"); const agent1 = principal("AGENTE_1", "VIEWER");

  // 1. Existing and authorized: deleted, record gone.
  const own = await seed("AGENTE_1");
  assert.deepEqual(await deleteAs(director1, own.id), { status: 200, outcome: "DELETED", deleted: true });
  assert.equal(await repository.get(tenant, own.id), null);
  console.log("BILL_DELETE_AUTHORIZED=PASS");

  // 2. Missing document (and the same one deleted a second time): 404, never a fictitious success.
  assert.deepEqual(await deleteAs(admin, "documento-inesistente"), { status: 404, outcome: "NOT_FOUND", code: "DOCUMENT_NOT_FOUND" });
  assert.deepEqual(await deleteAs(admin, own.id), { status: 404, outcome: "NOT_FOUND", code: "DOCUMENT_NOT_FOUND" });
  assert.equal(billDeleteDecision({ tenantId: tenant, stored: { tenantId: tenant, lifecycleState: "DELETED" }, inScope: true, linkedProposals: 0 }).outcome, "NOT_FOUND");
  console.log("BILL_DELETE_NOT_FOUND=PASS");

  // 3. Another tenant: answers like a missing document (nothing revealed) and stays.
  const foreign = await seed("ADMIN_X", otherTenant);
  assert.deepEqual(await deleteAs(admin, foreign.id), { status: 404, outcome: "NOT_FOUND", code: "DOCUMENT_NOT_FOUND" });
  assert.ok(await repository.get(otherTenant, foreign.id));
  assert.equal(billDeleteDecision({ tenantId: tenant, stored: { tenantId: otherTenant, lifecycleState: "ACTIVE" }, inScope: false, linkedProposals: 0 }).code, "DOCUMENT_NOT_FOUND");
  console.log("BILL_DELETE_OTHER_TENANT=PASS");

  // 4. Same tenant, outside the commercial branch: 403, document kept.
  const otherBranch = await seed("AGENTE_2");
  assert.deepEqual(await deleteAs(director1, otherBranch.id), { status: 403, outcome: "FORBIDDEN", code: "BILL_DELETE_FORBIDDEN" });
  assert.ok(await repository.get(tenant, otherBranch.id));
  console.log("BILL_DELETE_OUTSIDE_BRANCH=PASS");

  // 5. User without deletion rights: the server refuses WRITE to an agent before reading any document; the UI hides it.
  assert.equal(authorizePrincipal(agent1, "WRITE").allowed, false);
  assert.equal(authorizePrincipal(director1, "WRITE").allowed, true);
  assert.equal(authorizePrincipal(admin, "WRITE").allowed, true);
  assert.equal(canDeleteBills("VIEWER"), false); assert.equal(canDeleteBills("ANALYST"), true); assert.equal(canDeleteBills("ADMIN"), true); assert.equal(canDeleteBills(undefined), false);
  const route = await readFile("app/api/bills/[id]/route.ts", "utf8");
  const deleteRoute = route.slice(route.indexOf("export async function DELETE"), route.indexOf("const INTERNAL_TO_PUBLIC_CODE"));
  assert.match(deleteRoute, /requestPrincipal\(request, "WRITE"\)/);
  assert.ok(deleteRoute.indexOf("billDeleteDecision(") < deleteRoute.indexOf("deleteBillPermanently("), "the decision comes before any deletion");
  assert.doesNotMatch(deleteRoute, /if \(!document\) return Response\.json\(\{ deleted: true \}/, "no fictitious success any more");
  assert.match(deleteRoute, /return Response\.json\(\{ deleted: true, id: document\.id, outcome: "DELETED" \}/);
  assert.match(route, /if \(code === "BILL_DELETE_FORBIDDEN"\) return 403;/);
  const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
  const picker = await readFile("app/components/BillArchivePicker.tsx", "utf8");
  assert.match(flow, /canDelete=\{canDelete && !readonly\} selected=\{selectedBills\}/);
  assert.match(flow, /requestJson<\{ readonly role\?: string \| null \}>\("\/api\/foundation\/context"\)\.then\(\(context\) => setCanDelete\(canDeleteBills\(context\.role\)\)\)\.catch\(\(\) => setCanDelete\(false\)\)/, "the controls follow the role verified by the server; on error they stay hidden");
  assert.match(flow, /const \[canDelete, setCanDelete\] = useState\(false\);/);
  assert.match(flow, /\{canDelete && !readonly && selectedEntries\.length \? <div className="bill-archive-delete"/);
  assert.match(flow, /\{canDelete && !readonly && archive\.length \? <details className="quote-bill-manage">/, "the old delete panel is also hidden from who cannot delete");
  assert.match(picker, /\{selection\.canDelete \? <input type="checkbox"/);
  console.log("BILL_DELETE_NO_PERMISSION=PASS");

  // 6. Multiple selection with different outcomes: every document reported, one failure does not stop the others.
  const entries = ["a-ok", "b-missing", "c-branch", "d-proposal", "e-network", "f-ok"].map((id) => pendingBillEntry({ id, status: "REVIEW_REQUIRED", fileName: `${id}.pdf`, currentApprovedVersionId: null, fields: { customerName: { value: `CLIENTE ${id}` }, pod: { value: "IT000E00000001" } }, normalized: null, analystReview: { receipt: { invoiceNumber: { value: id === "a-ok" ? "FT-0001" : null } } } }));
  const calls = [];
  const answers = { "b-missing": { code: "DOCUMENT_NOT_FOUND" }, "c-branch": { code: "BILL_DELETE_FORBIDDEN" }, "d-proposal": { code: "BILL_LINKED_TO_PROPOSALS" }, "e-network": new TypeError("fetch failed") };
  const reports = await deleteSelectedBills(entries, async (id) => { calls.push(id); if (answers[id]) throw answers[id]; return { deleted: true, id, outcome: "DELETED" }; });
  assert.deepEqual(calls, ["a-ok", "b-missing", "c-branch", "d-proposal", "e-network", "f-ok"], "one call per selected document, in order");
  assert.deepEqual(reports.map((report) => report.result), ["DELETED", "NOT_FOUND", "FORBIDDEN", "LINKED_TO_PROPOSALS", "ERROR", "DELETED"]);
  assert.equal(deleteSummaryText(reports), "2 di 6 bollette cancellate; 4 non cancellate: vedi il dettaglio.");
  assert.equal(deleteSummaryText(reports.slice(0, 1)), "1 bolletta cancellata.");
  assert.match(reports[0].label, /Fattura FT-0001 · ID aok/);
  assert.equal(DELETE_RESULT_LABEL.FORBIDDEN, "non cancellata: fuori dal tuo ramo commerciale");
  assert.equal(deleteResultOf({ deleted: true }, null), "ERROR", "an old-style answer without the outcome is not taken as a deletion");
  assert.equal(deleteResultOf(null, { code: "ROLE_INSUFFICIENT" }), "NOT_AUTHORIZED");
  assert.equal(deleteConfirmText(3), "Cancellare definitivamente 3 bollette selezionate? L'operazione non si può annullare.");
  assert.equal(deleteConfirmText(1), "Cancellare definitivamente 1 bolletta selezionata? L'operazione non si può annullare.");
  assert.match(flow, /<strong>\{deleteConfirmText\(selectedEntries\.length\)\}<\/strong>/);
  assert.match(flow, /deleteSelectedBills\(selectedEntries, \(id\) => requestBillDelete\(id\)\)/, "multiple deletion reuses the single-document endpoint");
  assert.match(flow, /\{report\.label\}: \{deleteReportText\(report\)\}/, "each document shows its own outcome");
  const deleteSelectedBody = flow.slice(flow.indexOf("const deleteSelected = async"), flow.indexOf("// Tony (31/10): \"serve un tasto cancella le bollette\""));
  assert.doesNotMatch(deleteSelectedBody, /deleteAllBills|"\/api\/bills", \{ method: "DELETE" \}/, "\"Cancella tutte\" is not used");
  console.log("BILL_DELETE_MULTIPLE_OUTCOMES=PASS");

  // 7. Bill linked to a proposal: kept (409), so the proposal stays visible to directors and agents.
  const linked = await seed("AGENTE_1");
  assert.deepEqual(await deleteAs(admin, linked.id, [proposal(linked.id), proposal("altra-bolletta"), proposal(linked.id, otherTenant)]), { status: 409, outcome: "LINKED_TO_PROPOSALS", code: "BILL_LINKED_TO_PROPOSALS" });
  assert.ok(await repository.get(tenant, linked.id));
  assert.equal(proposalsFromBill([proposal(linked.id), proposal(linked.id), proposal(linked.id, otherTenant), { tenantId: tenant, payload: { proposal: null } }], tenant, linked.id), 2);
  console.log("BILL_DELETE_LINKED_PROPOSAL=PASS");

  // Opzione C (Tony 10/11/2026): the 409 carries the number of linked proposals, the screen says to delete them first,
  // and the client only ever calls the existing DELETE /api/bills/[id]: never a proposal deletion, never an option to force it.
  const fetchCalls = [];
  const fakeFetch = (answers) => async (url, init) => { fetchCalls.push({ url, method: init.method }); const [status, body] = answers[decodeURIComponent(url.split("/").pop())]; return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  const optionAnswers = {
    "c-ok": [200, { deleted: true, id: "c-ok", outcome: "DELETED" }],
    "c-two": [409, { id: "c-two", outcome: "LINKED_TO_PROPOSALS", linkedProposals: 2, error: { code: "BILL_LINKED_TO_PROPOSALS" } }],
    "c-one": [409, { id: "c-one", outcome: "LINKED_TO_PROPOSALS", linkedProposals: 1, error: { code: "BILL_LINKED_TO_PROPOSALS" } }],
    "c-branch": [403, { id: "c-branch", outcome: "FORBIDDEN", error: { code: "BILL_DELETE_FORBIDDEN" } }],
    "c-tenant": [404, { id: "c-tenant", outcome: "NOT_FOUND", error: { code: "DOCUMENT_NOT_FOUND" } }],
    "c-agent": [403, { error: { code: "AUTHORIZATION_DENIED" } }],
    "c-broken": [500, null],
  };
  const optionEntries = Object.keys(optionAnswers).map((id) => pendingBillEntry({ id, status: "REVIEW_REQUIRED", fileName: `${id}.pdf`, currentApprovedVersionId: null, fields: { customerName: { value: `CLIENTE ${id}` }, pod: { value: "IT000E00000002" } }, normalized: null }));
  const optionFetch = fakeFetch(optionAnswers);
  const optionReports = await deleteSelectedBills(optionEntries, (id) => requestBillDelete(id, optionFetch));
  assert.deepEqual(fetchCalls, Object.keys(optionAnswers).map((id) => ({ url: `/api/bills/${id}`, method: "DELETE" })), "only the existing single-bill endpoint, no query option, no proposal endpoint");
  assert.ok(fetchCalls.every((call) => !/proposal|withProposals|\?/.test(call.url)), "no proposal is ever deleted from here");
  assert.deepEqual(optionReports.map((report) => report.result), ["DELETED", "LINKED_TO_PROPOSALS", "LINKED_TO_PROPOSALS", "FORBIDDEN", "NOT_FOUND", "NOT_AUTHORIZED", "ERROR"]);
  assert.equal(optionReports[1].linkedProposals, 2);
  assert.equal(optionReports[2].linkedProposals, 1);
  assert.equal(deleteReportText(optionReports[0]), "cancellata");
  assert.equal(deleteReportText(optionReports[1]), "non cancellata: ha 2 proposte collegate. Elimina prima le proposte dalla sezione «Proposte», poi cancella la bolletta");
  assert.equal(deleteReportText(optionReports[2]), "non cancellata: ha 1 proposta collegata. Elimina prima la proposta dalla sezione «Proposte», poi cancella la bolletta");
  assert.equal(deleteReportText(optionReports[3]), "non cancellata: fuori dal tuo ramo commerciale");
  assert.equal(deleteReportText(optionReports[5]), "non cancellata: il tuo ruolo non è abilitato");
  assert.equal(deleteReportText({ id: "x", label: "x", result: "LINKED_TO_PROPOSALS" }), "non cancellata: ha proposte collegate. Elimina prima le proposte dalla sezione «Proposte», poi cancella la bolletta", "without the number the text stays true");
  assert.equal(deleteSummaryText(optionReports), "1 di 7 bollette cancellate; 6 non cancellate: vedi il dettaglio.");
  await assert.rejects(requestBillDelete("c-two", optionFetch), (error) => error instanceof BillDeleteError && error.code === "BILL_LINKED_TO_PROPOSALS" && error.linkedProposals === 2);
  await assert.rejects(requestBillDelete("c-x", async () => ({ ok: false, status: 409, json: async () => ({ linkedProposals: -3, error: { code: "<script>" } }) })), (error) => error.code === "HTTP_409" && error.linkedProposals === null, "unexpected codes and counts are not trusted");
  // The server side of the same case: the 409 body reports the exact number and the bill stays.
  const routeSource = await readFile(path.join(process.cwd(), "app/api/bills/[id]/route.ts"), "utf8");
  assert.match(routeSource, /\.\.\.\(decision\.linkedProposals \? \{ linkedProposals: decision\.linkedProposals \} : \{\}\)/);
  const linkedTwo = await seed("AGENTE_1");
  assert.equal(billDeleteDecision({ tenantId: tenant, stored: await repository.get(tenant, linkedTwo.id), inScope: true, linkedProposals: proposalsFromBill([proposal(linkedTwo.id), proposal(linkedTwo.id), proposal(linkedTwo.id, otherTenant)], tenant, linkedTwo.id) }).linkedProposals, 2);
  assert.ok(await repository.get(tenant, linkedTwo.id), "the bill with proposals is still there");
  assert.doesNotMatch(flow, /withProposals|\/api\/proposal\/\$\{/, "the quick-quote screen never deletes proposals");
  assert.match(flow, /Le bollette da cui è stata creata una proposta non vengono cancellate/, "the confirmation says it before the click");
  console.log("BILL_DELETE_OPTION_C=PASS");

  // 8. Cancelling the confirmation deletes nothing: the delete runs only after the dedicated "Conferma" with confirmSelected set.
  assert.match(deleteSelectedBody, /if \(!canDelete \|\| readonly \|\| deletingSelected \|\| !confirmSelected \|\| !selectedEntries\.length\) return;/);
  assert.match(flow, /<button className="button compact secondary" type="button" onClick=\{\(\) => setConfirmSelected\(false\)\} disabled=\{deletingSelected\}>Annulla<\/button>/);
  assert.match(flow, /onClick=\{\(\) => \{ setDeleteReports\(\[\]\); setConfirmSelected\(true\); \}\}[^>]*>Cancella selezionate \(\{selectedEntries\.length\}\)/, "the first click only asks for confirmation");
  const untouched = []; await deleteSelectedBills([], async (id) => { untouched.push(id); });
  assert.deepEqual(untouched, []);
  console.log("BILL_DELETE_CANCEL=PASS");

  // Messa in sicurezza (Tony 10/11/2026): the legacy "Cancella tutte" is disabled in the screen and on the server.
  assert.doesNotMatch(flow, /deleteAllBills|confirmAll|Cancella tutte le bollette|"\/api\/bills", \{ method: "DELETE" \}/, "no button, handler or call for the legacy delete-all");
  const listRoute = await readFile("app/api/bills/route.ts", "utf8");
  const deleteAll = listRoute.slice(listRoute.indexOf("export async function DELETE("), listRoute.indexOf("export async function POST("));
  assert.ok(deleteAll.length > 0);
  assert.doesNotMatch(deleteAll, /deleteBillPermanently|billRepository|runtimeRepositories|documentStorage|\.delete\(|\.list\(/, "the handler reads and deletes nothing");
  assert.doesNotMatch(listRoute, /deleteBillPermanently/, "no deletion left in the list route");
  // Run the handler itself, with spies standing in for every dependency it could reach: answer 410, nothing touched.
  const touched = [];
  const body = deleteAll.slice(deleteAll.indexOf("{") + 1, deleteAll.lastIndexOf("}"));
  const handler = new Function("Response", "messageFor", "CORRELATION_ID", "noStoreHeaders", "runtimeRepositories", "deleteBillPermanently", `return (async () => {${body}})();`);
  const spy = (name) => () => { touched.push(name); throw new Error(`${name} must not be called`); };
  const legacy = await handler(Response, (code) => `msg:${code}`, "foundation-bills", { "cache-control": "no-store, private" }, spy("runtimeRepositories"), spy("deleteBillPermanently"));
  assert.equal(legacy.status, 410);
  assert.deepEqual(await legacy.json(), { deleted: 0, failed: 0, error: { code: "BILL_DELETE_ALL_DISABLED", message: "msg:BILL_DELETE_ALL_DISABLED", correlationId: "foundation-bills" } });
  assert.deepEqual(touched, []);
  // A direct request on real synthetic data: the bills stay (the handler has no access to them at all).
  const survivor = await seed("AGENTE_1");
  assert.ok(await repository.get(tenant, survivor.id), "the bill is still there after the refused delete-all");
  assert.match(listRoute, /case "BILL_DELETE_ALL_DISABLED":/);
  const client = await readFile("app/lib/ui/client.ts", "utf8");
  assert.match(client, /BILL_DELETE_ALL_DISABLED: "La cancellazione di tutte le bollette è disattivata/);
  // Single and selective deletion untouched by the change: the single route still decides and deletes per document.
  assert.match(deleteRoute, /billDeleteDecision\(/); assert.match(deleteRoute, /deleteBillPermanently\(\{ tenantId: principal\.tenantId, documentId: document\.id/);
  console.log("BILL_DELETE_ALL_DISABLED=PASS");

  // Protezione "Svuota archivio" (Tony 10/11/2026): command gone from the screen, POST /api/archive/purge refuses everything.
  const shellSource = await readFile("app/components/OperationalShell.tsx", "utf8");
  assert.doesNotMatch(shellSource, /<ArchivePurge|function ArchivePurge\(|requestJson\("\/api\/archive\/purge"|Svuota archivio bollette e CTE|Scrivi SVUOTA/, "the command is not available in the screen");
  assert.match(shellSource, /section === "cte" \? <><CteIngestionPanel readonly=\{readonly\} canAdjust=\{context\?\.role === "ADMIN"\} \/><\/> : null/, "the CTE archive panel is still shown");
  const purgeRoute = await readFile("app/api/archive/purge/route.ts", "utf8");
  assert.doesNotMatch(purgeRoute, /purgeCompanyArchive|runtimeRepositories|requestPrincipal|deleteBillPermanently|\.delete\(|\.remove\(/, "the endpoint reaches no repository and deletes nothing");
  assert.doesNotMatch(purgeRoute, /export async function (GET|PUT|PATCH|DELETE)/);
  const purgeBody = purgeRoute.slice(purgeRoute.indexOf("export async function POST(") , purgeRoute.length);
  const purgeHandler = new Function("Response", "HEADERS", "purgeCompanyArchive", "runtimeRepositories", `return (async () => {${purgeBody.slice(purgeBody.indexOf("{") + 1, purgeBody.lastIndexOf("}"))}})();`);
  const purgeTouched = [];
  const purgeSpy = (name) => () => { purgeTouched.push(name); throw new Error(`${name} must not be called`); };
  const refused = await purgeHandler(Response, { "cache-control": "no-store, private" }, purgeSpy("purgeCompanyArchive"), purgeSpy("runtimeRepositories"));
  assert.equal(refused.status, 410);
  const refusedBody = await refused.json();
  assert.deepEqual({ ...refusedBody, error: { code: refusedBody.error.code } }, { bills: 0, ctes: 0, cteDocuments: 0, failed: 0, error: { code: "ARCHIVE_PURGE_DISABLED" } });
  assert.deepEqual(purgeTouched, []);
  // Synthetic bill still there after the refused purge; reading the archive is unchanged.
  const keep = await seed("AGENTE_1");
  assert.ok(await repository.get(tenant, keep.id));
  assert.ok((await repository.list(tenant)).some((document) => document.id === keep.id), "the archive is still listed");
  assert.match(listRoute, /export async function GET\(request: Request\)/);
  console.log("ARCHIVE_PURGE_DISABLED=PASS");

  // Phase A: collapsible section closed on load; search on invoice number and archive ID; two uploads of the same invoice told apart.
  assert.match(flow, /<details className="form-field bill-archive-panel"><summary className="form-label">Bollette archiviate/);
  assert.doesNotMatch(flow, /<details className="form-field bill-archive-panel" open/);
  const twin = (id) => approvedBillEntry({ id, title: "CLIENTE GEMELLO SRL", supplier: null, supplyReference: "IT000E55555555", period: { periodStart: "2026-09-01", periodEnd: "2026-09-30" }, vector: "EE", status: "APPROVED" });
  const [first, second] = [twin("11111111-aaaa"), twin("22222222-bbbb")];
  assert.notEqual(archiveEntryLabel(first), archiveEntryLabel(second));
  assert.deepEqual(searchArchive([first, second], "22222222").map((entry) => entry.id), ["22222222-bbbb"]);
  assert.match(picker, /\{entry\.invoiceNumber \? `Fattura \$\{entry\.invoiceNumber\} · ` : ""\}ID \{entry\.shortId\}/);
  console.log("BILL_ARCHIVE_COMPACT=PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("bill archive delete OK");
