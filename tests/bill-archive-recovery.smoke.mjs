import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { approvedBillEntry, archiveEntryLabel, archiveLoadError, BILL_LIST_LIMIT, pendingBillEntry, periodLabel, searchArchive } from "../app/lib/ui/bill-archive.ts";
import { billInScope, buildBillVisibilityScope } from "../app/lib/foundation/bill-visibility.ts";
import { resolveTrustedElectricityContextFromSourceBill } from "../app/lib/calculation/source-bill-context.ts";

// Tony (10/11/2026): "Nuova simulazione" shows "Bollette da completare" and "Bollette già disponibili" with holder, POD,
// billed period and state, search and explicit messages; a bill to complete opens on the review, never on the offers.
// Synthetic data only: no real customer, POD or supplier.

const field = (value) => ({ value, confidence: 1, source: "TEST", confirmed: false });
const pendingDoc = (over = {}) => ({
  id: "bill-pending-1", status: "REVIEW_REQUIRED", fileName: "bolletta-prova.pdf", currentVersionId: "v1", currentVersionNumber: 1, reviewState: "REVIEW_REQUIRED", currentApprovedVersionId: null, versionCount: 1, approvalReady: false,
  fields: { customerName: field("CLIENTE DI PROVA SRL"), pod: field("IT000E99999999"), billingPeriod: field("2026-09-01/2026-09-30"), supplier: field("Venditore di prova") },
  normalized: null, structuredBill: null, resolvedVector: "EE", ...over,
});
const approvedSummary = (over = {}) => ({ id: "bill-approved-1", title: "ALFA PROVA SPA", supplier: "Venditore di prova", supplyReference: "IT000E11111111", period: { periodStart: "2026-08-01", periodEnd: "2026-08-31" }, vector: "EE", status: "APPROVED", ...over });

// 1. Bill to review: holder, POD, period and state, openable for the review.
const pending = pendingBillEntry(pendingDoc());
assert.deepEqual({ holder: pending.holder, pod: pending.pod, period: pending.period, state: pending.state, label: pending.stateLabel, openable: pending.openable },
  { holder: "CLIENTE DI PROVA SRL", pod: "IT000E99999999", period: "01/09/2026 - 30/09/2026", state: "TO_COMPLETE", label: "Da completare", openable: true });
// A stored reading that failed cannot be reviewed: listed, not openable.
const failed = pendingBillEntry(pendingDoc({ id: "bill-failed", status: "FAILED", fields: {} }));
assert.equal(failed.state, "READ_FAILED"); assert.equal(failed.openable, false); assert.equal(failed.pod, "Non letto"); assert.equal(failed.period, "Non letto");
assert.equal(failed.holder, "bolletta-prova.pdf", "without a holder the file name identifies the bill");
// Values missing are said so, never invented.
const bare = pendingBillEntry(pendingDoc({ fields: { customerName: field("  ") }, fileName: "" }));
assert.equal(bare.holder, "Non letto"); assert.equal(bare.pod, "Non letto");
console.log("BILL_ARCHIVE_PENDING=PASS");

// 2. Approved bill.
const approved = approvedBillEntry(approvedSummary());
assert.deepEqual({ holder: approved.holder, pod: approved.pod, period: approved.period, state: approved.state, label: approved.stateLabel, openable: approved.openable },
  { holder: "ALFA PROVA SPA", pod: "IT000E11111111", period: "01/08/2026 - 31/08/2026", state: "APPROVED", label: "Approvata", openable: true });
// Tony (10/11/2026, fasi A+B): the label also carries the short archive ID (and the invoice number when read).
assert.equal(archiveEntryLabel(approved), "ALFA PROVA SPA · POD IT000E11111111 · 01/08/2026 - 31/08/2026 · ID billappr · Approvata");
assert.equal(approvedBillEntry(approvedSummary({ supplyReference: null, period: { periodStart: null, periodEnd: null } })).pod, "Non letto");
assert.equal(periodLabel(null, null, "dal 01/09/2026 al 30/09/2026"), "dal 01/09/2026 al 30/09/2026", "a period not in ISO form is shown as read");
console.log("BILL_ARCHIVE_APPROVED=PASS");

// Search on holder, POD, period, supplier and state; A to Z by holder; two bills of the same company told apart by POD.
const entries = [approved, pending, approvedBillEntry(approvedSummary({ id: "bill-approved-2", title: "ALFA PROVA SPA", supplyReference: "IT000E22222222" }))];
assert.deepEqual(searchArchive(entries, "").map((entry) => entry.id), ["bill-approved-1", "bill-approved-2", "bill-pending-1"]);
assert.deepEqual(searchArchive(entries, "e2222").map((entry) => entry.id), ["bill-approved-2"]);
assert.deepEqual(searchArchive(entries, "09/2026").map((entry) => entry.id), ["bill-pending-1"]);
assert.deepEqual(searchArchive(entries, "da completare").map((entry) => entry.id), ["bill-pending-1"]);
assert.deepEqual(searchArchive(entries, "nessuna-corrispondenza"), []);
console.log("BILL_ARCHIVE_SEARCH=PASS");

// 3-5. No bill, API error and over-limit: explicit messages; the server refuses a list over its limit instead of truncating.
assert.deepEqual(searchArchive([], "x"), []);
assert.match(archiveLoadError("BILL_LIST_TOO_LARGE"), new RegExp(`superano il limite di ${BILL_LIST_LIMIT}: l'elenco non viene mostrato per non presentarlo incompleto`));
assert.match(archiveLoadError("BILL_LIST_UNAVAILABLE"), /Elenco delle bollette non disponibile: riprova/);
assert.match(archiveLoadError(null), /non disponibile/);
const route = await readFile("app/api/bills/route.ts", "utf8");
assert.match(route, /const MAX_BILL_LIST_RESULTS = 100;/, "the UI limit message matches the server limit");
assert.equal(BILL_LIST_LIMIT, 100);
assert.match(route, /if \(documents\.length > MAX_BILL_LIST_RESULTS\) throw new Error\("BILL_LIST_TOO_LARGE"\);\n\s+const approvedView/, "the limit is applied to the whole scope before splitting approved / to complete, never by truncation");
assert.doesNotMatch(route, /\.slice\(0, MAX_BILL_LIST_RESULTS\)/);
assert.match(route, /documents\.filter\(\(document\) => document\.currentApprovedVersionId === null\)/, "GET /api/bills without view returns only the bills not approved");
const picker = await readFile("app/components/BillArchivePicker.tsx", "utf8");
assert.match(picker, /"Bollette da completare"/); assert.match(picker, /"Bollette già disponibili"/);
assert.match(picker, /empty="Nessuna bolletta da completare\."/); assert.match(picker, /empty="Nessuna bolletta approvata disponibile\."/);
assert.match(picker, /list\.status === "error" \? <div className="warning-text" role="alert"><p>\{list\.message\}<\/p><button[^>]*onClick=\{onRetry\}/);
assert.match(picker, /Nessuna bolletta di questo gruppo corrisponde alla ricerca\./);
assert.match(picker, /<strong>\{entry\.holder\}<\/strong>\s*<span>POD \{entry\.pod\}<\/span>\s*<span>\{entry\.period\}<\/span>\s*<span className=\{`bill-archive-state/);
assert.match(picker, /disabled=\{disabled \|\| !entry\.openable\}/);
const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
assert.match(flow, /requestJson<\{ readonly documents: readonly BillDocumentModel\[\] \}>\("\/api\/bills"\)/);
assert.match(flow, /\.catch\(\(cause: unknown\) => \{ setArchive\(\[\]\); setApprovedBills\(failure\(cause\)\); \}\)/, "an approved list that fails is an error, not an empty list");
assert.match(flow, /\.catch\(\(cause: unknown\) => setPendingBills\(failure\(cause\)\)\)/);
assert.doesNotMatch(flow, /catch \{ setArchive\(\[\]\); \}/, "the list error is no longer swallowed");
assert.match(flow, /useEffect\(\(\) => \{ if \(step === "bill"\) void loadArchive\(\); \}, \[step, loadArchive\]\);/);
assert.doesNotMatch(flow, /\{archive\.length \? <div className="form-field">/, "the groups are shown also when no bill is approved");
console.log("BILL_ARCHIVE_EMPTY_ERROR_LIMIT=PASS");

// 6. Different access levels: the lists come from the same server scope (tenant + commercial branch), unchanged.
const at = "2026-11-10T10:00:00.000Z";
const principal = (userId, role, tenantId = "tenant_prova-a") => ({ userId, tenantId, role, sessionId: `s-${userId}`, issuedAt: at, expiresAt: "2026-11-10T11:00:00.000Z", source: "LOCAL_SYNTHETIC" });
const membership = (id, userId, role, managerUserId) => ({ id, userId, tenantId: "tenant_prova-a", role, status: "ACTIVE", permissions: ["tenant:read", "document:read"], groupIds: [], createdAt: at, updatedAt: at, ...(managerUserId ? { managerUserId } : {}) });
const memberships = [membership("m-adm", "ADMIN_1", "TENANT_ADMIN"), membership("m-dir", "DIRETTORE_1", "SALES_MANAGER"), membership("m-ag1", "AGENTE_1", "SALES_OPERATOR", "DIRETTORE_1"), membership("m-ag2", "AGENTE_2", "SALES_OPERATOR")];
const doc = (id, ownerUserId, tenantId = "tenant_prova-a") => ({ id, tenantId, ownerUserId });
const docs = [doc("b-admin", "ADMIN_1"), doc("b-dir", "DIRETTORE_1"), doc("b-ag1", "AGENTE_1"), doc("b-ag2", "AGENTE_2"), doc("b-other-tenant", "ADMIN_1", "tenant_prova-b")];
const visible = (who) => docs.filter((document) => billInScope(document, buildBillVisibilityScope(who, memberships))).map((document) => document.id);
assert.deepEqual(visible(principal("ADMIN_1", "ADMIN")), ["b-admin", "b-dir", "b-ag1", "b-ag2"], "the company administrator sees every bill of the tenant, none of another tenant");
assert.deepEqual(visible(principal("DIRETTORE_1", "ANALYST")), ["b-dir", "b-ag1"], "the director sees his own bills and those of his agents");
assert.deepEqual(visible(principal("AGENTE_1", "VIEWER")), ["b-ag1"], "an agent sees only his own bills");
assert.deepEqual(visible(principal("ADMIN_1", "ADMIN", "tenant_prova-b")), ["b-other-tenant"]);
assert.doesNotMatch(flow, /\/api\/bills\?(scope|all|tenant)=/, "the UI asks no wider list than the existing endpoints");
console.log("BILL_ARCHIVE_ACCESS_LEVELS=PASS");

// 7. Recovering a bill reads it again from the archive (GET): no upload, no new record, no approval.
const openBillBody = flow.slice(flow.indexOf("const openBill = async"), flow.indexOf("// Confirms what was read"));
assert.ok(openBillBody.length > 0);
assert.match(openBillBody, /requestJson<\{ readonly document: BillDocumentModel \}>\(`\/api\/bills\/\$\{encodeURIComponent\(billId\)\}`\)/);
assert.doesNotMatch(openBillBody, /requestUpload|method: "(POST|PATCH|DELETE)"|operation: "approve"|loadOffers/, "opening never uploads, approves or jumps to the offers");
assert.match(openBillBody, /setStep\("review"\)/);
assert.match(flow, /onOpen=\{\(id\) => void openBill\(id\)\}/);
console.log("BILL_ARCHIVE_REOPEN_NO_DUPLICATE=PASS");

// 8. No offer or proposal from a bill not approved: the UI approves only on "Cerca le CTE utilizzabili", and the server refuses
// a simulation on a bill without an approved version.
const confirmBody = flow.slice(flow.indexOf("const confirm = async"), flow.indexOf("const visibleOffers"));
assert.ok(confirmBody.indexOf('operation: "approve"') > 0 && confirmBody.indexOf('operation: "approve"') < confirmBody.lastIndexOf("await loadOffers(current.id)"), "the offers are loaded only after the approval");
const unapprovedRepo = { async get() { return { id: "bill-pending-1", tenantId: "tenant_prova-a", currentApprovedVersionId: null, currentVersionId: "v1", versions: [] }; } };
await assert.rejects(() => resolveTrustedElectricityContextFromSourceBill(unapprovedRepo, "tenant_prova-a", { sourceBill: { billId: "bill-pending-1", version: "v1" } }), (error) => error.code === "SOURCE_BILL_NOT_APPROVED");
console.log("BILL_ARCHIVE_NO_SIMULATION_UNAPPROVED=PASS");

// Tony (10/11/2026, messa in sicurezza): the legacy "Cancella tutte" is disabled (see bill-archive-delete.smoke.mjs).
assert.doesNotMatch(flow, /Cancellare tutte le bollette caricate\? Non si può annullare\./);
console.log("bill archive recovery OK");
