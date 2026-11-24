"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { MAX_UPLOAD_BYTES, requestJson, requestUpload, toUiError, UiApiError } from "../lib/ui/client";
import type { BillDocumentModel } from "../lib/ui/models";
import { ANALYSIS_STEPS, isFinalAnalysisState, POLL_MS, stepStatus, type AnalysisView } from "../lib/ui/bill-analysis-steps";

// Tony (24/11/2026, "PERMESSI GERARCHICI E ANALISI BOLLETTE", Modulo B): load and analysis of a bill with the real phases the
// server records (no invented percentages), "Interrompi analisi", "Annulla" and "Ricomincia". The controls act on the server:
// a stopped analysis saves nothing, and the result of an old analysis is never taken for a new one.

type Run =
  | { readonly kind: "idle" }
  | { readonly kind: "selected"; readonly file: File }
  | { readonly kind: "running"; readonly file: File; readonly id: string; readonly server: AnalysisView | null; readonly stopping: boolean }
  | { readonly kind: "stopped"; readonly file: File; readonly text: string }
  | { readonly kind: "failed"; readonly file: File; readonly text: string };

function newAnalysisId(): string { return `analysis_${crypto.randomUUID()}`; }
function sizeText(bytes: number): string { return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`; }
function errorText(cause: unknown): string { const error = toUiError(cause); return error.detail ? `${error.message} (codice ${error.detail})` : error.message; }
const STOPPED = "Analisi interrotta: la bolletta non è stata salvata. Puoi avviarla di nuovo o scegliere un altro file.";

export function BillAnalysisControl({ readonly, disabled, onBusy, onRead }: { readonly readonly: boolean; readonly disabled: boolean; readonly onBusy: (busy: boolean) => void; readonly onRead: (document: BillDocumentModel, analysisId: string) => void }): ReactNode {
  const [run, setRun] = useState<Run>({ kind: "idle" });
  // The analysis the screen is following: answers of any other (older) analysis are ignored.
  const current = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = run.kind === "running";
  useEffect(() => { onBusy(running); }, [running, onBusy]);

  // Real phases: read from the server while the upload request is open.
  const runningId = run.kind === "running" ? run.id : null;
  useEffect(() => {
    if (!runningId) return;
    let alive = true;
    const tick = async () => {
      try {
        const { analysis } = await requestJson<{ readonly analysis: AnalysisView }>(`/api/bills/analysis/${encodeURIComponent(runningId)}`);
        if (alive && current.current === runningId) setRun((value) => value.kind === "running" && value.id === runningId ? { ...value, server: analysis } : value);
      } catch { /* not recorded yet (the file is still travelling) or a network hiccup: the next tick tries again */ }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => { alive = false; clearInterval(timer); };
  }, [runningId]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || running) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setRun({ kind: "failed", file, text: "Il file deve essere un PDF." }); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setRun({ kind: "failed", file, text: "Il file supera 20 MB." }); return; }
    setRun({ kind: "selected", file });
  };

  const start = useCallback(async (file: File) => {
    const id = newAnalysisId();
    const abort = new AbortController();
    current.current = id; controller.current = abort;
    setRun({ kind: "running", file, id, server: null, stopping: false });
    try {
      const { document } = await requestUpload<{ readonly document: BillDocumentModel }>("/api/bills", file, { "x-bill-analysis-id": id }, abort.signal);
      if (current.current !== id) return;
      if (document.status === "FAILED" || document.status === "PROVIDER_NOT_CONFIGURED") { setRun({ kind: "failed", file, text: "Non siamo riusciti a leggere la bolletta. Riprova con un PDF più nitido." }); return; }
      setRun({ kind: "idle" }); current.current = null;
      onRead(document, id);
    } catch (cause) {
      if (current.current !== id) return;
      const stopped = abort.signal.aborted || (cause instanceof UiApiError && cause.code === "BILL_ANALYSIS_CANCELLED");
      setRun((value) => value.kind === "running" && value.id === id && value.stopping ? value : stopped ? { kind: "stopped", file, text: STOPPED } : { kind: "failed", file, text: errorText(cause) });
    } finally { if (controller.current === abort) controller.current = null; }
  }, [onRead]);

  /** "Interrompi analisi": the server is told first (it drops the reading at its next phase), then the request is closed. */
  const interrupt = useCallback(async () => {
    if (run.kind !== "running" || run.stopping) return;
    const { id, file } = run;
    setRun({ ...run, stopping: true });
    let final: AnalysisView | null = null;
    try { final = (await requestJson<{ readonly analysis: AnalysisView }>(`/api/bills/analysis/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" })).analysis; }
    catch { /* not recorded yet: closing the request below stops it before it is saved */ }
    controller.current?.abort();
    // Wait for the server's final word, so the screen never says "interrotta" about a bill that was saved.
    for (let attempt = 0; attempt < 20 && !(final && isFinalAnalysisState(final.state)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      try { final = (await requestJson<{ readonly analysis: AnalysisView }>(`/api/bills/analysis/${encodeURIComponent(id)}`)).analysis; } catch { final = final ?? null; }
    }
    if (current.current !== id) return;
    current.current = null;
    if (final?.state === "COMPLETED") {
      // It finished just before the stop arrived: the new bill is removed, as the user asked.
      try { await requestJson(`/api/bills/analysis/${encodeURIComponent(id)}/discard`, { method: "POST", body: "{}" }); setRun({ kind: "stopped", file, text: STOPPED }); }
      catch (cause) { setRun({ kind: "failed", file, text: `L'analisi era già conclusa e la bolletta letta non è stata rimossa: ${errorText(cause)}` }); }
      return;
    }
    setRun(final && final.state !== "CANCELLED" && final.state !== "FAILED"
      ? { kind: "failed", file, text: "La conferma dell'interruzione non è arrivata. Ricarica la pagina prima di riprovare: nessuna bolletta viene usata senza che tu la apra." }
      : { kind: "stopped", file, text: STOPPED });
  }, [run]);

  /** "Ricomincia": back to the choice of the file; a running analysis is stopped first. */
  const restart = useCallback(async () => {
    if (run.kind === "running") await interrupt();
    current.current = null; setRun({ kind: "idle" });
  }, [run, interrupt]);

  const file = run.kind === "idle" ? null : run.file;
  return <div className="bill-analysis" aria-live="polite">
    {run.kind === "idle" ? <label className="button primary quote-upload-button">Carica bolletta (PDF)<input className="visually-hidden" type="file" accept="application/pdf" onChange={choose} disabled={readonly || disabled} /></label> : null}
    {file ? <p><strong>File selezionato:</strong> {file.name} <span className="muted">· {sizeText(file.size)}</span></p> : null}
    {run.kind === "selected" ? <div className="button-row"><button className="button primary" type="button" onClick={() => void start(run.file)} disabled={readonly || disabled}>Avvia analisi</button><button className="button secondary" type="button" onClick={() => setRun({ kind: "idle" })}>Annulla</button></div> : null}
    {run.kind === "running" ? <>
      <ol className="bill-analysis-steps">{ANALYSIS_STEPS.map((step) => { const status = stepStatus(run.server, step.state); return <li key={step.state} className={`bill-analysis-step ${status}`}><span aria-hidden="true">{status === "done" ? "✓" : status === "current" ? "…" : "○"}</span> {step.label}{status === "current" ? <span className="muted"> · in corso</span> : null}</li>; })}</ol>
      <p className="muted">La lettura può richiedere fino a qualche minuto. Le fasi sono quelle registrate dal server.</p>
      <div className="button-row"><button className="button danger" type="button" onClick={() => void interrupt()} disabled={run.stopping}>{run.stopping ? "Interruzione in corso…" : "Interrompi analisi"}</button><button className="button secondary" type="button" onClick={() => void restart()} disabled={run.stopping}>Ricomincia</button></div>
    </> : null}
    {run.kind === "stopped" || run.kind === "failed" ? <>
      <p className={run.kind === "stopped" ? "muted" : "warning-text"} role={run.kind === "failed" ? "alert" : "status"}>{run.text}</p>
      <div className="button-row">{run.kind === "stopped" || run.file.size <= MAX_UPLOAD_BYTES ? <button className="button primary" type="button" onClick={() => void start(run.file)} disabled={readonly || disabled}>Avvia di nuovo</button> : null}<button className="button secondary" type="button" onClick={() => void restart()}>Ricomincia</button></div>
    </> : null}
  </div>;
}
