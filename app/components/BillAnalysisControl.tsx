"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { MAX_UPLOAD_BYTES, requestJson, requestUpload, toUiError, UiApiError } from "../lib/ui/client";
import type { BillDocumentModel } from "../lib/ui/models";
import { ANALYSIS_STEPS, durationText, isFinalAnalysisState, phaseDurations, POLL_MS, stepStatus, uploadText, waitNotice, type AnalysisStep, type AnalysisView, type ContactState } from "../lib/ui/bill-analysis-steps";
import { useNow } from "./OperationSteps";

// Tony (24/11/2026, "PERMESSI GERARCHICI E ANALISI BOLLETTE", Modulo B): load and analysis of a bill with the real phases the
// server records (no invented percentages), "Interrompi analisi", "Annulla" and "Ricomincia". The controls act on the server:
// a stopped analysis saves nothing, and the result of an old analysis is never taken for a new one.

type Run =
  | { readonly kind: "idle" }
  | { readonly kind: "selected"; readonly file: File }
  | { readonly kind: "running"; readonly file: File; readonly id: string; readonly server: AnalysisView | null; readonly stopping: boolean; readonly progress: Progress; readonly phaseSeen: PhaseSeen | null; readonly contact: ContactState }
  | { readonly kind: "stopped"; readonly file: File; readonly text: string; readonly server: AnalysisView | null; readonly failedStep: AnalysisStep | null }
  | { readonly kind: "failed"; readonly file: File; readonly text: string; readonly server: AnalysisView | null; readonly failedStep: AnalysisStep | null };
// Tony (24/11/2026, "PROGRESSIONE DELLE OPERAZIONI", A): bytes really sent (total null when the browser does not know it),
// when the screen first saw the phase in progress (to count its time), and the answers of the status requests.
type Progress = { readonly sent: number; readonly total: number | null; readonly complete: boolean };
type PhaseSeen = { readonly step: AnalysisStep; readonly at: number };
export interface AnalysisSummary { readonly totalMs: number }

function newAnalysisId(): string { return `analysis_${crypto.randomUUID()}`; }
function sizeText(bytes: number): string { return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`; }
function errorText(cause: unknown): string { const error = toUiError(cause); return error.detail ? `${error.message} (codice ${error.detail})` : error.message; }
const STOPPED = "Analisi interrotta: la bolletta non è stata salvata. Puoi avviarla di nuovo o scegliere un altro file.";

export function BillAnalysisControl({ readonly, disabled, onBusy, onRead }: { readonly readonly: boolean; readonly disabled: boolean; readonly onBusy: (busy: boolean) => void; readonly onRead: (document: BillDocumentModel, analysisId: string, summary: AnalysisSummary) => void }): ReactNode {
  const [run, setRun] = useState<Run>({ kind: "idle" });
  // The analysis the screen is following: answers of any other (older) analysis are ignored.
  const current = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = run.kind === "running";
  useEffect(() => { onBusy(running); }, [running, onBusy]);
  // The screen moves to the reading as soon as it arrives: closing this card must not leave the flow marked busy.
  useEffect(() => () => onBusy(false), [onBusy]);

  // Real phases: read from the server while the upload request is open.
  const runningId = run.kind === "running" ? run.id : null;
  useEffect(() => {
    if (!runningId) return;
    let alive = true;
    const tick = async () => {
      try {
        const { analysis } = await requestJson<{ readonly analysis: AnalysisView }>(`/api/bills/analysis/${encodeURIComponent(runningId)}`);
        const at = Date.now();
        if (alive && current.current === runningId) setRun((value) => {
          if (value.kind !== "running" || value.id !== runningId) return value;
          const step: AnalysisStep = analysis.state;
          return { ...value, server: analysis, contact: { lastAnswerAt: at, failuresInARow: 0 }, phaseSeen: value.phaseSeen?.step === step ? value.phaseSeen : { step, at } };
        });
      } catch (cause) {
        // Not recorded yet (the file is still travelling: the server answers "not found") or no answer at all. Only a
        // request that got no answer counts towards "the server is not answering".
        const answered = cause instanceof UiApiError && !/^HTTP_5/.test(cause.code);
        if (alive && current.current === runningId) setRun((value) => value.kind === "running" && value.id === runningId ? { ...value, contact: answered ? { lastAnswerAt: Date.now(), failuresInARow: 0 } : { ...value.contact, failuresInARow: value.contact.failuresInARow + 1 } } : value);
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => { alive = false; clearInterval(timer); };
  }, [runningId]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || running) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setRun({ kind: "failed", file, text: "Il file deve essere un PDF.", server: null, failedStep: null }); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setRun({ kind: "failed", file, text: "Il file supera 20 MB.", server: null, failedStep: null }); return; }
    setRun({ kind: "selected", file });
  };

  const start = useCallback(async (file: File) => {
    const id = newAnalysisId();
    const abort = new AbortController();
    current.current = id; controller.current = abort;
    const startedAt = Date.now();
    setRun({ kind: "running", file, id, server: null, stopping: false, progress: { sent: 0, total: file.size, complete: false }, phaseSeen: null, contact: { lastAnswerAt: null, failuresInARow: 0 } });
    // Bytes really sent, as the browser reports them; the last report (all bytes sent) closes "Invio del file".
    const onProgress = (sent: number, total: number | null) => setRun((value) => value.kind === "running" && value.id === id ? { ...value, progress: { sent, total, complete: total !== null && sent >= total }, phaseSeen: total !== null && sent >= total && !value.server && !value.phaseSeen ? { step: "RECEIVED", at: Date.now() } : value.phaseSeen } : value);
    try {
      const { document } = await requestUpload<{ readonly document: BillDocumentModel }>("/api/bills", file, { "x-bill-analysis-id": id }, abort.signal, onProgress);
      if (current.current !== id) return;
      if (document.status === "FAILED" || document.status === "PROVIDER_NOT_CONFIGURED") {
        // The reader answered that it could not read the bill: the failure belongs to the reading step.
        const server = await finalAnalysis(id);
        setRun({ kind: "failed", file, text: "Non siamo riusciti a leggere la bolletta. Riprova con un PDF più nitido.", server, failedStep: "READING" }); return;
      }
      setRun({ kind: "idle" }); current.current = null;
      onRead(document, id, { totalMs: Date.now() - startedAt });
    } catch (cause) {
      if (current.current !== id) return;
      const stopped = abort.signal.aborted || (cause instanceof UiApiError && cause.code === "BILL_ANALYSIS_CANCELLED");
      // The step where it ended: the one the server recorded, read once more; if the server never recorded the analysis,
      // the file did not arrive, so it is the sending.
      const server = stopped ? null : await finalAnalysis(id);
      if (current.current !== id) return;
      setRun((value) => {
        if (value.kind === "running" && value.id === id && value.stopping) return value;
        const known = server ?? (value.kind === "running" && value.id === id ? value.server : null);
        const failedStep: AnalysisStep | null = known && (known.state === "FAILED" || known.state === "CANCELLED") ? null : known ? (isFinalAnalysisState(known.state) ? "SAVING" : known.state) : "SENDING";
        return stopped ? { kind: "stopped", file, text: STOPPED, server: known, failedStep } : { kind: "failed", file, text: errorText(cause), server: known, failedStep };
      });
    } finally { if (controller.current === abort) controller.current = null; }
  }, [onRead]);

  /** The analysis as the server recorded it, read once after the request ended; null when it cannot be read. */
  async function finalAnalysis(id: string): Promise<AnalysisView | null> {
    try { return (await requestJson<{ readonly analysis: AnalysisView }>(`/api/bills/analysis/${encodeURIComponent(id)}`)).analysis; } catch { return null; }
  }

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
      try { await requestJson(`/api/bills/analysis/${encodeURIComponent(id)}/discard`, { method: "POST", body: "{}" }); setRun({ kind: "stopped", file, text: STOPPED, server: final, failedStep: "SAVING" }); }
      catch (cause) { setRun({ kind: "failed", file, text: `L'analisi era già conclusa e la bolletta letta non è stata rimossa: ${errorText(cause)}`, server: final, failedStep: "SAVING" }); }
      return;
    }
    const lastKnown = final ?? run.server;
    setRun(final && final.state !== "CANCELLED" && final.state !== "FAILED"
      ? { kind: "failed", file, text: "La conferma dell'interruzione non è arrivata. Ricarica la pagina prima di riprovare: nessuna bolletta viene usata senza che tu la apra.", server: final, failedStep: isFinalAnalysisState(final.state) ? "SAVING" : final.state }
      : { kind: "stopped", file, text: STOPPED, server: lastKnown, failedStep: lastKnown && (lastKnown.state === "CANCELLED" || lastKnown.state === "FAILED") ? null : lastKnown ? (isFinalAnalysisState(lastKnown.state) ? "SAVING" : lastKnown.state) : "SENDING" });
  }, [run]);

  /** "Ricomincia": back to the choice of the file; a running analysis is stopped first. */
  const restart = useCallback(async () => {
    if (run.kind === "running") await interrupt();
    current.current = null; setRun({ kind: "idle" });
  }, [run, interrupt]);

  // Tony (24/11/2026, "DIREZIONE GRAFICA DEFINITIVA"): one clear card. The file chosen, the server's real phases as a row of
  // steps (no percentage), and the commands that stop or restart the analysis always in view next to them.
  const now = useNow(running);
  const file = run.kind === "idle" ? null : run.file;
  const chip = file ? <div className="bill-file-chip"><span className="bill-file-icon" aria-hidden="true">PDF</span><span className="bill-file-name"><small className="bill-file-label">File selezionato</small><strong>{file.name}</strong><small>{sizeText(file.size)}</small></span></div> : null;
  return <div className="bill-analysis" aria-live="polite">
    {run.kind === "idle" ? <div className="bill-drop">
      <span className="bill-drop-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 17v-6" /><path d="m9 13 3-3 3 3" /></svg></span>
      <div className="bill-drop-text"><strong>Carica la bolletta del cliente</strong><small>File PDF fino a 20 MB</small></div>
      <label className="button primary quote-upload-button">Carica bolletta (PDF)<input className="visually-hidden" type="file" accept="application/pdf" onChange={choose} disabled={readonly || disabled} /></label>
    </div> : null}
    {run.kind === "selected" ? <div className="bill-analysis-bar">{chip}<div className="button-row"><button className="button primary" type="button" onClick={() => void start(run.file)} disabled={readonly || disabled}>Avvia analisi</button><button className="button secondary" type="button" onClick={() => setRun({ kind: "idle" })}>Annulla</button></div></div> : null}
    {run.kind === "running" ? <>
      <div className="bill-analysis-bar">{chip}<div className="button-row"><button className="button danger" type="button" onClick={() => void interrupt()} disabled={run.stopping}>{run.stopping ? "Interruzione in corso…" : "Interrompi analisi"}</button><button className="button secondary" type="button" onClick={() => void restart()} disabled={run.stopping}>Ricomincia</button></div></div>
      <AnalysisSteps server={run.server} failedStep={null} stopped={false} progress={run.progress} phaseSeen={run.phaseSeen} now={now} />
      <RunningNotes run={run} now={now} />
    </> : null}
    {run.kind === "stopped" || run.kind === "failed" ? <>
      <div className="bill-analysis-bar">{chip}<div className="button-row">{run.kind === "stopped" || run.file.size <= MAX_UPLOAD_BYTES ? <button className="button primary" type="button" onClick={() => void start(run.file)} disabled={readonly || disabled}>Avvia di nuovo</button> : null}<button className="button secondary" type="button" onClick={() => void restart()}>Ricomincia</button></div></div>
      {run.server || run.failedStep ? <AnalysisSteps server={run.server} failedStep={run.failedStep} stopped={run.kind === "stopped"} progress={null} phaseSeen={null} now={now} /> : null}
      <p className={run.kind === "stopped" ? "bill-analysis-message" : "bill-analysis-message warning-text"} role={run.kind === "failed" ? "alert" : "status"}>{run.text}{run.kind === "failed" && run.server?.errorCode && !run.text.includes(run.server.errorCode) ? <small className="bill-analysis-code"> Codice: {run.server.errorCode}</small> : null}</p>
    </> : null}
  </div>;
}

const STEP_STATE_TEXT = { done: "completata", current: "in corso", todo: "da eseguire", failed: "non riuscita", stopped: "interrotta" } as const;

/** The five steps: the server's phases with their recorded durations, the bytes sent on the first, the step where the
 *  analysis ended marked as failed or stopped. */
function AnalysisSteps({ server, failedStep, stopped, progress, phaseSeen, now }: { readonly server: AnalysisView | null; readonly failedStep: AnalysisStep | null; readonly stopped: boolean; readonly progress: Progress | null; readonly phaseSeen: PhaseSeen | null; readonly now: number }): ReactNode {
  const durations = phaseDurations(server);
  return <ol className="bill-analysis-steps">{ANALYSIS_STEPS.map((step) => {
    const raw = stepStatus(server, step.state, failedStep);
    const status = stopped && raw === "failed" ? "stopped" : raw;
    const duration = durations[step.state];
    // Bytes sent: shown while the file travels and kept on the step once sent; the server phase that follows starts the clock.
    const bytes = step.state === "SENDING" && progress && (status === "current" || status === "done") ? uploadText(progress.sent, progress.total) : null;
    const running = status === "current" && phaseSeen && phaseSeen.step === step.state ? durationText(now - phaseSeen.at) : null;
    return <li key={step.state} className={`bill-analysis-step ${status}`} aria-current={status === "current" ? "step" : undefined}>
      <span className="bill-analysis-dot" aria-hidden="true">{status === "done" ? "✓" : status === "failed" ? "✕" : status === "stopped" ? "■" : ""}</span>
      <span className="bill-analysis-label">{step.label}<span className="visually-hidden">: {STEP_STATE_TEXT[status]}</span>
        {status === "current" ? <small>in corso{running ? `, da ${running}` : ""}</small> : null}
        {status === "done" && duration !== undefined ? <small className="bill-analysis-time">{durationText(duration)}</small> : null}
        {status === "failed" ? <small className="bill-analysis-failed">non riuscita</small> : null}
        {status === "stopped" ? <small className="bill-analysis-stopped">interrotta</small> : null}
        {bytes ? <small className="bill-analysis-bytes">{bytes}</small> : null}
      </span>
      {step.state === "SENDING" && progress && status === "current" && progress.total ? <progress className="bill-upload-progress" max={progress.total} value={Math.min(progress.sent, progress.total)} aria-label="Byte inviati" /> : null}
    </li>;
  })}</ol>;
}

/** Elapsed time, last answer from the server and, only when it applies, the long wait or the missing answers. */
function RunningNotes({ run, now }: { readonly run: Extract<Run, { readonly kind: "running" }>; readonly now: number }): ReactNode {
  const fileSent = run.progress.complete || run.server !== null;
  const notice = waitNotice({ contact: run.contact, phaseSeenAt: run.phaseSeen?.at ?? null, now, fileSent });
  const last = run.contact.lastAnswerAt === null ? null : new Date(run.contact.lastAnswerAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return <>
    <p className="muted bill-analysis-note">Le fasi sono quelle registrate dal server.{last ? ` Ultima risposta del server alle ${last}.` : fileSent ? " In attesa della prima risposta del server." : ""}</p>
    {notice.kind === "none" ? null : <p className={notice.kind === "long" ? "bill-analysis-message" : "bill-analysis-message warning-text"} role="status">{notice.text}</p>}
  </>;
}
