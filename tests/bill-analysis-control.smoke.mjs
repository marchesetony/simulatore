// Tony (24/11/2026, "PERMESSI GERARCHICI E ANALISI BOLLETTE", Modulo B): bill analysis with real phases and a real stop.
// The upload request stays synchronous; each phase is recorded by the server before it starts, and a stop (the user's
// "Interrompi analisi" or the request being closed) is seen at the next phase: nothing is saved, the stored PDF is removed,
// and the result of an old analysis can never be taken for a new one.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { analysisHooks, finishAnalysis, getAnalysis, markDiscarded, requestCancel, startAnalysis, ANALYSIS_STALE_MS } from "../app/lib/reading/bill-analysis.ts";
import { ClaudeBillReader } from "../app/lib/reading/bill-reader.ts";
import { stepStatus, ANALYSIS_STEPS } from "../app/lib/ui/bill-analysis-steps.ts";
import { analysisBillDiscardable } from "../app/lib/reading/bill-analysis-discard.ts";

const tenant = "tenant_sintetica";
function memoryRepository() {
  const rows = new Map();
  const key = (tenantId, recordId) => `${tenantId}|${recordId}`;
  return {
    async get(tenantId, recordId) { return structuredClone(rows.get(key(tenantId, recordId)) ?? null); },
    async list(tenantId) { return [...rows.values()].filter((row) => row.tenantId === tenantId).map((row) => structuredClone(row)); },
    async put({ tenantId, recordId, payload, expectedVersion, now = new Date().toISOString() }) {
      const existing = rows.get(key(tenantId, recordId));
      if ((existing?.version ?? undefined) !== expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT");
      const row = { schemaVersion: 1, tenantId, recordId, payload: structuredClone(payload), version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now };
      rows.set(key(tenantId, recordId), row); return structuredClone(row);
    },
  };
}
const id = (n) => `analysis_${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const user = { tenantId: tenant, userId: "user_agente" };
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 analisi sintetica", "latin1"));

// 1. The job: one start per id, one running analysis per user, only its owner sees or stops it.
{
  const jobs = memoryRepository();
  await assert.rejects(() => startAnalysis(jobs, user, "analysis_bad"), /BILL_ANALYSIS_ID_INVALID/);
  const started = await startAnalysis(jobs, user, id(1));
  assert.equal(started.state, "RECEIVED");
  await assert.rejects(() => startAnalysis(jobs, user, id(1)), /BILL_ANALYSIS_DUPLICATE/);
  await assert.rejects(() => startAnalysis(jobs, user, id(2)), /BILL_ANALYSIS_BUSY/, "no second analysis while one is running");
  await startAnalysis(jobs, { tenantId: tenant, userId: "user_altro" }, id(3));
  await assert.rejects(() => getAnalysis(jobs, { tenantId: tenant, userId: "user_altro" }, id(1)), /BILL_ANALYSIS_NOT_FOUND/, "another user's analysis does not exist for him");
  await assert.rejects(() => requestCancel(jobs, { tenantId: "tenant_altra", userId: "user_agente" }, id(1)), /BILL_ANALYSIS_NOT_FOUND/, "nor for another company");
  await finishAnalysis(jobs, tenant, id(1), { state: "COMPLETED", billId: "bill-1" });
  assert.equal((await requestCancel(jobs, user, id(1))).state, "COMPLETED", "a finished analysis is returned as it is");
  assert.equal((await startAnalysis(jobs, user, id(4))).state, "RECEIVED", "after the end a new analysis may start");
  // A stuck analysis (the function was stopped by the host) stops blocking after the stale window.
  const later = () => new Date(Date.now() + ANALYSIS_STALE_MS + 1000).toISOString();
  assert.equal((await startAnalysis(jobs, user, id(5), later)).state, "RECEIVED");
  assert.equal((await markDiscarded(jobs, tenant, id(5))).state, "RECEIVED", "only a completed analysis can be discarded");
  assert.equal((await markDiscarded(jobs, tenant, id(1))).state, "CANCELLED");
}
console.log("ANALYSIS_JOB=PASS");

const root = await mkdtemp(path.join(os.tmpdir(), "bill-analysis-"));
try {
  const repository = new LocalBillRepository(root); const storage = new LocalDocumentStorage(root);
  const stored = async () => (await readdir(path.join(root, tenant)).catch(() => [])).filter((name) => name.endsWith(".pdf")).length;
  const base = { tenantId: tenant, fileName: "bolletta.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} } };

  // 2. A normal analysis records every phase before it starts and saves the bill.
  {
    const jobs = memoryRepository();
    await startAnalysis(jobs, user, id(10));
    const document = await ingestBill({ ...base, extractor: { async extract() { return { text: "", pages: 1 }; } }, analysis: analysisHooks(jobs, tenant, id(10)) });
    await finishAnalysis(jobs, tenant, id(10), { state: "COMPLETED", billId: document.id });
    const job = await getAnalysis(jobs, user, id(10));
    assert.deepEqual(job.phases.map((phase) => phase.state), ["RECEIVED", "READING", "SAVING", "COMPLETED"]);
    assert.ok(await repository.get(tenant, document.id));
  }
  console.log("REAL_PHASES=PASS");

  // 3. "Interrompi analisi" while the PDF is being read: the reading that comes back is thrown away, nothing is saved,
  //    not even a failed bill, and the stored PDF is removed.
  {
    const jobs = memoryRepository();
    await startAnalysis(jobs, user, id(11));
    const before = (await repository.list(tenant)).length; const filesBefore = await stored();
    let release; const reading = new Promise((resolve) => { release = resolve; });
    const structuredExtractor = { async extract() { await reading; return { anything: "a full reading would be here" }; } };
    const running = ingestBill({ ...base, structuredExtractor, analysis: analysisHooks(jobs, tenant, id(11)) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await getAnalysis(jobs, user, id(11))).state, "READING");
    await requestCancel(jobs, user, id(11));
    release();
    await assert.rejects(running, /BILL_ANALYSIS_CANCELLED/);
    assert.equal((await repository.list(tenant)).length, before, "no bill saved");
    assert.equal(await stored(), filesBefore, "the PDF stored for the reading is removed");
    const job = await getAnalysis(jobs, user, id(11));
    assert.equal(job.state, "READING"); assert.equal(job.cancelRequested, true);
    assert.equal((await finishAnalysis(jobs, tenant, id(11), { state: "CANCELLED" })).state, "CANCELLED");
  }
  // 3b. A reading that fails after the stop leaves no failed bill either.
  {
    const jobs = memoryRepository();
    await startAnalysis(jobs, user, id(12));
    const before = (await repository.list(tenant)).length;
    const structuredExtractor = { async extract() { await requestCancel(jobs, user, id(12)); throw new Error("BILL_OCR_PROVIDER_UNAVAILABLE"); } };
    await assert.rejects(() => ingestBill({ ...base, structuredExtractor, analysis: analysisHooks(jobs, tenant, id(12)) }), /BILL_ANALYSIS_CANCELLED/);
    assert.equal((await repository.list(tenant)).length, before);
  }
  // 3c. The browser closing the request (signal) stops it the same way.
  {
    const jobs = memoryRepository();
    await startAnalysis(jobs, user, id(13));
    const abort = new AbortController(); abort.abort();
    const before = (await repository.list(tenant)).length;
    await assert.rejects(() => ingestBill({ ...base, extractor: { async extract() { return { text: "", pages: 1 }; } }, analysis: analysisHooks(jobs, tenant, id(13), abort.signal) }), /BILL_ANALYSIS_CANCELLED/);
    assert.equal((await repository.list(tenant)).length, before);
  }
  // 3d. Without an analysis the upload works exactly as before (a failed reading is still saved as failed).
  {
    const before = (await repository.list(tenant)).length;
    const document = await ingestBill({ ...base, structuredExtractor: { async extract() { throw new Error("BILL_OCR_PROVIDER_UNAVAILABLE"); } } });
    assert.equal((await repository.list(tenant)).length, before + 1); assert.equal(document.versions[0].status, "FAILED");
  }
  console.log("STOP_SAVES_NOTHING=PASS");
} finally { await rm(root, { recursive: true, force: true }); }

// 4. The reader: the stop reaches the request to the model, and a stopped reading is not read again.
{
  const calls = [];
  const client = { messages: { async create(params, options) { calls.push(options?.signal ?? null); throw Object.assign(new Error("aborted"), { name: "APIUserAbortError" }); } } };
  const abort = new AbortController();
  const reader = new ClaudeBillReader(client, "modello-sintetico", 1000, abort.signal);
  abort.abort();
  await assert.rejects(() => reader.extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_ANALYSIS_CANCELLED/);
  assert.equal(calls.length, 0, "an already stopped analysis never calls the model");
  const live = new AbortController();
  const reader2 = new ClaudeBillReader(client, "modello-sintetico", 1000, live.signal);
  const pending = reader2.extract({ bytes: pdf, contentType: "application/pdf" }).catch((error) => error);
  live.abort();
  await pending;
  assert.equal(calls.at(-1), live.signal, "the signal is passed to the model request");
}
console.log("READER_ABORT=PASS");

// 5. Phases on screen: only the recorded ones, no percentage.
assert.equal(stepStatus(null, "SENDING"), "current");
assert.deepEqual(ANALYSIS_STEPS.map((step) => stepStatus({ state: "READING" }, step.state)), ["done", "done", "current", "todo", "todo"]);
assert.deepEqual(ANALYSIS_STEPS.map((step) => stepStatus({ state: "COMPLETED" }, step.state)), ["done", "done", "done", "done", "done"]);
const control = await readFile("app/components/BillAnalysisControl.tsx", "utf8");
// Tony (24/11/2026, "PROGRESSIONE DELLE OPERAZIONI", A): the only measure on screen is the bytes the browser reports as sent;
// the reading phases still have none.
assert.doesNotMatch(control, /\d\s*%|\$\{[^}]*\}\s*%|aria-valuenow/i, "no invented percentages");
assert.deepEqual(control.match(/<progress[^>]*>/g), ['<progress className="bill-upload-progress" max={progress.total} value={Math.min(progress.sent, progress.total)} aria-label="Byte inviati" />'], "the one bar is the bytes sent");
for (const label of ["File selezionato", "Avvia analisi", "Interrompi analisi", "Annulla", "Ricomincia"]) assert.match(control, new RegExp(label), label);
assert.match(control, /if \(current\.current !== id\) return;/, "answers of an older analysis are ignored");
assert.match(control, /\/cancel`, \{ method: "POST"[\s\S]*controller\.current\?\.abort\(\)/, "the server is told before the request is closed");
// The reading opens ready to confirm: the analysis card closes with the screen change, so neither side may leave the flow
// marked busy (before 24/11 «Annulla», «Ricomincia» and «Cerca le CTE utilizzabili» stayed disabled after a reading).
assert.match(control, /useEffect\(\(\) => \(\) => onBusy\(false\), \[onBusy\]\);/);
assert.match(await readFile("app/components/QuickQuoteFlow.tsx", "utf8"), /const analysisRead = useCallback\(\(document: BillDocumentModel, analysisId: string, summary: AnalysisSummary\) => \{[\s\S]{0,200}setPending\(\(value\) => value === "upload" \? undefined : value\);/);
console.log("SCREEN=PASS");

// 6. Routes: same company and owner only; a bill saved at the moment of the stop is removed; "Annulla" removes only the
//    untouched bill of that analysis.
const route = await readFile("app/api/bills/route.ts", "utf8");
assert.match(route, /request\.headers\.get\("x-bill-analysis-id"\)/);
assert.match(route, /if \(request\.signal\.aborted \|\| await cancelRequested\([^)]*\)\) \{[\s\S]{0,200}if \(!\(await analysisBillDiscardable\(repositories, tenantId, result\.document\)\)\) \{[\s\S]{0,300}return deny\("BILL_ANALYSIS_NOT_DISCARDABLE"[\s\S]{0,120}\}\s*await deleteArchivedBill\(principal, repositories, result\.document, CORRELATION_ID\);/, "the stop removes a bill only after the guard");
const discard = await readFile("app/api/bills/analysis/[id]/discard/route.ts", "utf8");
assert.match(discard, /requestPrincipal\(request, "OPERATE"\)[\s\S]*getAnalysis\(repositories\.billAnalyses, principal, id\)/);
assert.match(discard, /getBillInScope\(principal, repositories, record\.billId\)/);
assert.match(discard, /if \(!\(await analysisBillDiscardable\(repositories, principal\.tenantId, document\)\)\) throw new Error\("BILL_ANALYSIS_NOT_DISCARDABLE"\);\s*await deleteArchivedBill/);
assert.equal((discard.match(/deleteArchivedBill\(/g) ?? []).length, 1);
assert.equal((route.match(/deleteArchivedBill\(/g) ?? []).length, 1);

// 7. The guard (Tony 24/11, vincolo obbligatorio): only the bill as read, linked to nothing, can ever be removed.
{
  const fresh = { id: "bill_new", tenantId: tenant, currentApprovedVersionId: null, versions: [{ versionId: "v1" }], approvals: [], detailDocument: undefined };
  const repos = (extra = {}) => ({ proposals: memoryRepository(), calculationResults: memoryRepository(), comparisonResults: memoryRepository(), eligibilityOverrides: memoryRepository(), customerBillLinks: memoryRepository(), ...extra });
  const derived = { result: { normalizedInput: { sourceBill: { billId: "bill_new" } } } };
  assert.equal(await analysisBillDiscardable(repos(), tenant, fresh), true, "a fresh bill linked to nothing");
  assert.equal(await analysisBillDiscardable(repos(), "tenant_altra", fresh), false, "another company");
  assert.equal(await analysisBillDiscardable(repos(), tenant, { ...fresh, currentApprovedVersionId: "v1" }), false, "approved");
  assert.equal(await analysisBillDiscardable(repos(), tenant, { ...fresh, versions: [{ versionId: "v1" }, { versionId: "v2" }] }), false, "corrected or re-read");
  assert.equal(await analysisBillDiscardable(repos(), tenant, { ...fresh, approvals: [{}] }), false, "approval recorded");
  assert.equal(await analysisBillDiscardable(repos(), tenant, { ...fresh, detailDocument: { linkId: "d" } }), false, "detail document linked");
  for (const name of ["calculationResults", "comparisonResults"]) {
    const r = repos(); await r[name].put({ tenantId: tenant, recordId: "x", payload: derived });
    assert.equal(await analysisBillDiscardable(r, tenant, fresh), false, `${name}: simulation on the bill`);
  }
  { const r = repos(); await r.eligibilityOverrides.put({ tenantId: tenant, recordId: "o", payload: { billId: "bill_new" } }); assert.equal(await analysisBillDiscardable(r, tenant, fresh), false, "forced eligibility"); }
  { const r = repos(); await r.proposals.put({ tenantId: tenant, recordId: "p", payload: { proposal: { sourceBill: { billId: "bill_new" } } } }); const linked = await analysisBillDiscardable(r, tenant, fresh); assert.equal(linked, false, "proposal on the bill"); }
  { const r = repos(); await r.customerBillLinks.put({ tenantId: tenant, recordId: "bill_new", payload: { billId: "bill_new" } }); assert.equal(await analysisBillDiscardable(r, tenant, fresh), false, "customer link"); }
  assert.equal(await analysisBillDiscardable(repos({ customerBillLinks: undefined }), tenant, fresh), false, "links not readable: kept");
  assert.equal(await analysisBillDiscardable(repos({ proposals: { async list() { throw new Error("DOWN"); } } }), tenant, fresh), false, "store down: kept");
  console.log("GUARD=PASS");
}
for (const file of ["app/api/bills/analysis/[id]/route.ts", "app/api/bills/analysis/[id]/cancel/route.ts"]) assert.match(await readFile(file, "utf8"), /requestPrincipal\(request, "OPERATE"\)/);
console.log("ROUTES=PASS");
console.log("bill-analysis-control: ok");
