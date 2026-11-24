// Tony (24/11/2026, "ANALISI BOLLETTE"): the phases shown while a bill is analysed are the ones the server records
// (bill-analysis.ts); no percentage is shown, because the reading gives none that could be measured.
// Tony (24/11/2026, "PROGRESSIONE DELLE OPERAZIONI", A): only the bytes sent have a real percentage; the phases carry the
// durations recorded by the server, the step where an analysis failed or was stopped stays marked, and a long wait is told
// apart from a server that really stopped answering. Nothing here is estimated.

export type AnalysisServerState = "RECEIVED" | "READING" | "VALIDATING" | "SAVING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface AnalysisView { readonly analysisId: string; readonly state: AnalysisServerState; readonly cancelRequested: boolean; readonly billId: string | null; readonly errorCode: string | null; readonly phases: readonly { readonly state: AnalysisServerState; readonly at: string }[] }
export type AnalysisStep = AnalysisServerState | "SENDING";
export type StepStatus = "done" | "current" | "todo" | "failed" | "stopped";

export const ANALYSIS_STEPS: readonly { readonly state: AnalysisStep; readonly label: string }[] = [
  { state: "SENDING", label: "Invio del file" },
  { state: "RECEIVED", label: "Ricezione del file sul server" },
  // Tony (24/11/2026, opzione 1): the reader's own checks (and its second reading, when needed) run inside this phase.
  { state: "READING", label: "Estrazione e controlli di lettura" },
  { state: "VALIDATING", label: "Validazione dei dati letti" },
  { state: "SAVING", label: "Salvataggio della bolletta" },
];
const ORDER = ANALYSIS_STEPS.map((step) => step.state);
export const POLL_MS = 1500;
/** Consecutive status requests without an answer before the screen says the server is not answering. */
export const NO_ANSWER_AFTER = 3;
/** A phase still running after this long is called a long wait (never a failure). */
export const LONG_WAIT_MS = 90_000;
/** Same window after which the server stops counting an analysis as running (ANALYSIS_STALE_MS in bill-analysis.ts). */
export const SERVER_SILENT_MS = 6 * 60 * 1000;

export function isFinalAnalysisState(state: AnalysisServerState): boolean { return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED"; }

/** The step that was running when the analysis ended without completing: the last phase the server recorded before
 *  FAILED or CANCELLED. Null while it runs or when it completed. */
export function endedAt(server: Pick<AnalysisView, "state" | "phases"> | null): AnalysisStep | null {
  if (!server || (server.state !== "FAILED" && server.state !== "CANCELLED")) return null;
  const last = [...server.phases].reverse().find((phase) => !isFinalAnalysisState(phase.state));
  return last ? last.state : "RECEIVED";
}

/** Where each step stands from the last phase the server recorded; before the server has recorded anything the file is
 *  still travelling, so "Invio del file" is the step in progress. `failedStep` marks the step where the screen received an
 *  error the server did not record (for example the file could not be sent). */
export function stepStatus(server: Pick<AnalysisView, "state"> & { readonly phases?: AnalysisView["phases"] } | null, step: AnalysisStep, failedStep: AnalysisStep | null = null): StepStatus {
  const index = ORDER.indexOf(step);
  const ended = failedStep ?? (server?.phases ? endedAt({ state: server.state, phases: server.phases }) : null);
  if (ended) {
    const at = ORDER.indexOf(ended);
    return index < at ? "done" : index === at ? (server?.state === "CANCELLED" && !failedStep ? "stopped" : "failed") : "todo";
  }
  const reached = server ? (isFinalAnalysisState(server.state) ? ORDER.length : ORDER.indexOf(server.state)) : 0;
  return index < reached ? "done" : index === reached ? "current" : "todo";
}

/** How long each finished phase lasted, from the times the server recorded (start of the phase to start of the next).
 *  The current phase has no duration here: the screen counts it itself. */
export function phaseDurations(server: Pick<AnalysisView, "phases"> | null): Partial<Record<AnalysisStep, number>> {
  const result: Partial<Record<AnalysisStep, number>> = {};
  const phases = server?.phases ?? [];
  for (let index = 0; index + 1 < phases.length; index += 1) {
    const start = Date.parse(phases[index].at); const end = Date.parse(phases[index + 1].at);
    if (!isFinalAnalysisState(phases[index].state) && Number.isFinite(start) && Number.isFinite(end) && end >= start) result[phases[index].state] = end - start;
  }
  return result;
}

/** "0:07", "1:12", "12:03": minutes and seconds, whole seconds only. */
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Bytes really sent by the browser, when it knows the total: "1,2 di 3,4 MB (35%)". Without a total, no percentage. */
export function uploadText(sent: number, total: number | null): string {
  const mb = (bytes: number) => (bytes / 1_000_000).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (total === null || total <= 0) return `${mb(sent)} MB inviati`;
  const percent = Math.min(100, Math.floor((sent / total) * 100));
  return `${mb(Math.min(sent, total))} di ${mb(total)} MB (${percent}%)`;
}

export interface ContactState { readonly lastAnswerAt: number | null; readonly failuresInARow: number }
/** What the screen says about the server while an analysis runs. Only failed requests make "no answer"; time alone only
 *  makes a long wait, never an error (Tony 24/11/2026, vincolo 4). */
export function waitNotice(input: { readonly contact: ContactState; readonly phaseSeenAt: number | null; readonly now: number; readonly fileSent: boolean }): { readonly kind: "none" | "long" | "silent" | "no-answer"; readonly text: string } {
  const { contact, phaseSeenAt, now } = input;
  const last = contact.lastAnswerAt === null ? null : new Date(contact.lastAnswerAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (contact.failuresInARow >= NO_ANSWER_AFTER) return { kind: "no-answer", text: `Le ultime ${contact.failuresInARow} richieste di stato non hanno avuto risposta${last ? ` (ultima risposta alle ${last})` : ""}. L'analisi potrebbe essere ancora in corso: puoi attendere o interromperla.` };
  if (phaseSeenAt !== null && input.fileSent) {
    const running = now - phaseSeenAt;
    if (running >= SERVER_SILENT_MS) return { kind: "silent", text: `Il server risponde ma non registra nuove fasi da ${durationText(running)}. L'analisi potrebbe non concludersi: puoi attendere ancora o interromperla.` };
    if (running >= LONG_WAIT_MS) return { kind: "long", text: "Questa fase sta richiedendo più tempo del solito ma è ancora in corso: il server continua a rispondere." };
  }
  return { kind: "none", text: "" };
}
