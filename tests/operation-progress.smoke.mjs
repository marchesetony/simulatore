// Tony (24/11/2026, "PROGRESSIONE DELLE OPERAZIONI"): A) the bytes sent are the only percentage, phases carry the times the
// server recorded, the failed step stays marked, a long wait is never called an error; B) the CTE search shows the requests
// it really makes, with the CTEs found; C) short waits show activity and time. Nothing estimated, no calculation touched.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ANALYSIS_STEPS, durationText, endedAt, LONG_WAIT_MS, NO_ANSWER_AFTER, phaseDurations, SERVER_SILENT_MS, stepStatus, uploadText, waitNotice } from "../app/lib/ui/bill-analysis-steps.ts";
import { CTE_SEARCH_STEPS, cteCountText, endStep, failRunning, finished, newSteps, startStep, totalMs } from "../app/lib/ui/operation-steps.ts";
import { ANALYSIS_STALE_MS } from "../app/lib/reading/bill-analysis.ts";

const phases = (...list) => list.map(([state, at]) => ({ state, at: `2026-11-24T17:00:${String(at).padStart(2, "0")}.000Z` }));
const statuses = (server, failedStep = null) => ANALYSIS_STEPS.map((step) => stepStatus(server, step.state, failedStep));

// 1. Labels: option 1 (the reader's checks are part of the extraction phase).
assert.deepEqual(ANALYSIS_STEPS.map((step) => step.label), ["Invio del file", "Ricezione del file sul server", "Estrazione e controlli di lettura", "Validazione dei dati letti", "Salvataggio della bolletta"]);

// 2. The failed step stays marked; before it done, after it untouched.
{
  const failed = { state: "FAILED", phases: phases(["RECEIVED", 0], ["READING", 2], ["FAILED", 40]) };
  assert.equal(endedAt(failed), "READING");
  assert.deepEqual(statuses(failed), ["done", "done", "failed", "todo", "todo"]);
  const stopped = { state: "CANCELLED", phases: phases(["RECEIVED", 0], ["READING", 2], ["VALIDATING", 30], ["CANCELLED", 31]) };
  assert.deepEqual(statuses(stopped), ["done", "done", "done", "stopped", "todo"]);
  // Not recorded by the server at all: the file did not arrive.
  assert.deepEqual(statuses(null, "SENDING"), ["failed", "todo", "todo", "todo", "todo"]);
  // Running and completed behave as before.
  assert.deepEqual(statuses({ state: "VALIDATING", phases: phases(["RECEIVED", 0], ["READING", 2], ["VALIDATING", 30]) }), ["done", "done", "done", "current", "todo"]);
  assert.deepEqual(statuses({ state: "COMPLETED", phases: phases(["RECEIVED", 0], ["READING", 2], ["VALIDATING", 30], ["SAVING", 31], ["COMPLETED", 32]) }), ["done", "done", "done", "done", "done"]);
  assert.equal(endedAt({ state: "COMPLETED", phases: [] }), null);
}
console.log("FAILED_STEP=PASS");

// 3. Durations only from the server's recorded times; the running phase has none; text in minutes:seconds.
{
  const durations = phaseDurations({ phases: phases(["RECEIVED", 0], ["READING", 2], ["VALIDATING", 44], ["SAVING", 45]) });
  assert.deepEqual(durations, { RECEIVED: 2000, READING: 42000, VALIDATING: 1000 });
  assert.equal(durationText(42000), "0:42"); assert.equal(durationText(72_500), "1:12"); assert.equal(durationText(-5), "0:00");
  assert.deepEqual(phaseDurations(null), {});
}
console.log("DURATIONS=PASS");

// 4. Bytes: percentage only with a known total, never above 100.
assert.equal(uploadText(1_200_000, 3_400_000), "1,2 di 3,4 MB (35%)");
assert.equal(uploadText(3_400_000, 3_400_000), "3,4 di 3,4 MB (100%)");
assert.equal(uploadText(900_000, null), "0,9 MB inviati");
assert.doesNotMatch(uploadText(900_000, null), /%/);
console.log("BYTES=PASS");

// 5. Waits (vincolo 4): time alone gives a long wait, never "no answer"; only failed requests give "no answer".
{
  const start = 1_000_000; const answering = { lastAnswerAt: start, failuresInARow: 0 };
  assert.equal(waitNotice({ contact: answering, phaseSeenAt: start, now: start + 10_000, fileSent: true }).kind, "none");
  const long = waitNotice({ contact: answering, phaseSeenAt: start, now: start + LONG_WAIT_MS, fileSent: true });
  assert.equal(long.kind, "long"); assert.match(long.text, /ancora in corso/); assert.doesNotMatch(long.text, /bloccat|errore/i);
  const silent = waitNotice({ contact: answering, phaseSeenAt: start, now: start + SERVER_SILENT_MS, fileSent: true });
  assert.equal(silent.kind, "silent"); assert.match(silent.text, /risponde ma non registra nuove fasi/); assert.doesNotMatch(silent.text, /bloccat/i);
  assert.equal(SERVER_SILENT_MS, ANALYSIS_STALE_MS, "same window the server uses");
  assert.equal(waitNotice({ contact: { lastAnswerAt: start, failuresInARow: NO_ANSWER_AFTER - 1 }, phaseSeenAt: start, now: start + 5000, fileSent: true }).kind, "none");
  const none = waitNotice({ contact: { lastAnswerAt: start, failuresInARow: NO_ANSWER_AFTER }, phaseSeenAt: start, now: start + 5000, fileSent: true });
  assert.equal(none.kind, "no-answer"); assert.match(none.text, /potrebbe essere ancora in corso/);
  // While the file is still travelling the bytes speak for themselves.
  assert.equal(waitNotice({ contact: { lastAnswerAt: null, failuresInARow: 0 }, phaseSeenAt: null, now: start + SERVER_SILENT_MS * 2, fileSent: false }).kind, "none");
}
console.log("WAITS=PASS");

// 6. CTE search steps: done only when the request answered, the running step is the one that fails, counts as returned.
{
  let steps = startStep(newSteps(CTE_SEARCH_STEPS), "confirm", 0);
  assert.deepEqual(steps.map((step) => step.status), ["current", "todo", "todo", "todo"]);
  steps = startStep(endStep(steps, "confirm", "done", 800), "approve", 800);
  steps = endStep(steps, "approve", "done", 1500);
  steps = startStep(steps, "cte", 1500);
  steps = failRunning(steps, 4000, "Servizio non disponibile");
  assert.deepEqual(steps.map((step) => [step.status, step.durationMs ?? null, step.detail ?? null]), [["done", 800, null], ["done", 700, null], ["failed", null, "Servizio non disponibile"], ["todo", null, null]]);
  assert.equal(finished(steps), false);
  const ok = endStep(endStep(startStep(steps.map((step) => step.key === "cte" ? { key: "cte", label: step.label, status: "todo" } : step), "cte", 0), "cte", "done", 2000, "x"), "compare", "skipped", 2000, "nessuna CTE utilizzabile: calcolo non eseguito");
  assert.equal(finished(ok), true); assert.equal(totalMs(ok), 3500);
  const candidate = (finalStatus, readiness = "READY", version = "v1") => ({ finalStatus, calculationReadiness: readiness, cteVersionId: version });
  assert.equal(cteCountText([candidate("ELIGIBLE"), candidate("ELIGIBLE_BY_OVERRIDE"), candidate("NOT_ELIGIBLE"), candidate("ELIGIBLE", "NOT_READY"), candidate("ELIGIBLE", "READY", null)]), "5 CTE trovate, 2 utilizzabili per il calcolo");
  assert.equal(cteCountText([candidate("ELIGIBLE")]), "1 CTE trovata, 1 utilizzabile per il calcolo");
  assert.equal(cteCountText([]), "0 CTE trovate, 0 utilizzabili per il calcolo");
}
console.log("CTE_SEARCH=PASS");

// 7. Upload: with a progress callback the same request goes through XMLHttpRequest (bytes reported, stop honoured, server
//    errors read as before); without it fetch is used exactly as before.
{
  const sent = [];
  class FakeXhr {
    static last = null;
    constructor() { this.upload = {}; this.headers = {}; FakeXhr.last = this; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    abort() { this.onabort?.(); }
    send(body) {
      this.body = body;
      queueMicrotask(() => {
        if (FakeXhr.mode === "hang") return;
        this.upload.onprogress?.({ loaded: 500, total: 1000, lengthComputable: true });
        this.upload.onprogress?.({ loaded: 1000, total: 1000, lengthComputable: true });
        if (FakeXhr.mode === "network") { this.onerror?.(); return; }
        this.status = FakeXhr.mode === "error" ? 422 : 200;
        this.responseText = FakeXhr.mode === "error" ? JSON.stringify({ error: { code: "PDF_REQUIRED", message: "x" } }) : JSON.stringify({ document: { id: "b1" } });
        this.onload?.();
      });
    }
  }
  globalThis.XMLHttpRequest = FakeXhr;
  let fetched = 0; globalThis.fetch = async () => { fetched += 1; return new Response(JSON.stringify({ document: { id: "b0" } }), { status: 200 }); };
  const { requestUpload } = await import("../app/lib/ui/client.ts");
  const file = new File([new Uint8Array(1000)], "bolletta.pdf", { type: "application/pdf" });
  FakeXhr.mode = "ok";
  assert.deepEqual(await requestUpload("/api/bills", file, { "x-bill-analysis-id": "analysis_x" }, undefined, (loaded, total) => sent.push([loaded, total])), { document: { id: "b1" } });
  assert.deepEqual(sent, [[500, 1000], [1000, 1000]]);
  assert.equal(FakeXhr.last.method, "POST"); assert.equal(FakeXhr.last.url, "/api/bills"); assert.equal(FakeXhr.last.headers["x-bill-analysis-id"], "analysis_x");
  assert.ok(FakeXhr.last.body instanceof FormData && FakeXhr.last.body.get("file").name === "bolletta.pdf");
  assert.equal(fetched, 0);
  FakeXhr.mode = "error";
  await assert.rejects(() => requestUpload("/api/bills", file, {}, undefined, () => {}), (error) => error.code === "PDF_REQUIRED");
  FakeXhr.mode = "network";
  await assert.rejects(() => requestUpload("/api/bills", file, {}, undefined, () => {}), TypeError);
  FakeXhr.mode = "hang";
  const controller = new AbortController();
  const pending = requestUpload("/api/bills", file, {}, controller.signal, () => {});
  await new Promise((resolve) => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(() => pending, (error) => error.name === "AbortError");
  assert.deepEqual(await requestUpload("/api/bills", file, {}), { document: { id: "b0" } }, "no callback: fetch as before");
  assert.equal(fetched, 1);
}
console.log("UPLOAD=PASS");

// 8. Screens: the real steps and the short waits are wired; no percentage outside the bytes; engine and reader untouched by
//    this change (checked on the diff in the report).
{
  const flow = await readFile("app/components/QuickQuoteFlow.tsx", "utf8");
  assert.match(flow, /moveSearch\(\(\) => startStep\(newSteps\(CTE_SEARCH_STEPS\), "confirm", Date\.now\(\)\)\)/);
  assert.match(flow, /endStep\(steps, "cte", "done", Date\.now\(\), cteCountText\(prepared\.candidates\)\)/);
  assert.match(flow, /<ActivityIndicator label="Simulazione tecnica in corso" \/>/);
  assert.match(flow, /<ActivityIndicator label="Preparazione della proposta e del PDF in corso" \/>/);
  assert.equal((flow.match(/<ActivityIndicator label="Nuova lettura delle voci dal PDF in corso" \/>/g) ?? []).length, 2);
  const steps = await readFile("app/components/OperationSteps.tsx", "utf8");
  assert.doesNotMatch(steps, /%|<progress|aria-valuenow/);
  assert.match(flow, /Whether the reader\s+\/\/ read the bill a second time is not sent to the screen, so it is not said\./);
}
console.log("SCREENS=PASS");
console.log("operation-progress: ok");
