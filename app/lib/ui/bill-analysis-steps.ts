// Tony (24/11/2026, "ANALISI BOLLETTE"): the phases shown while a bill is analysed are the ones the server records
// (bill-analysis.ts); no percentage is shown, because the reading gives none that could be measured.

export type AnalysisServerState = "RECEIVED" | "READING" | "VALIDATING" | "SAVING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface AnalysisView { readonly analysisId: string; readonly state: AnalysisServerState; readonly cancelRequested: boolean; readonly billId: string | null; readonly errorCode: string | null; readonly phases: readonly { readonly state: AnalysisServerState; readonly at: string }[] }

export const ANALYSIS_STEPS: readonly { readonly state: AnalysisServerState | "SENDING"; readonly label: string }[] = [
  { state: "SENDING", label: "Invio del file" },
  { state: "RECEIVED", label: "Ricezione del file sul server" },
  { state: "READING", label: "Estrazione dei dati dal PDF" },
  { state: "VALIDATING", label: "Validazione dei dati letti" },
  { state: "SAVING", label: "Salvataggio della bolletta" },
];
const ORDER = ANALYSIS_STEPS.map((step) => step.state);
export const POLL_MS = 1500;

export function isFinalAnalysisState(state: AnalysisServerState): boolean { return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED"; }

/** Where each step stands from the last phase the server recorded; before the server has recorded anything the file is
 *  still travelling, so "Invio del file" is the step in progress. */
export function stepStatus(server: Pick<AnalysisView, "state"> | null, step: AnalysisServerState | "SENDING"): "done" | "current" | "todo" {
  const reached = server ? (isFinalAnalysisState(server.state) ? ORDER.length : ORDER.indexOf(server.state)) : 0;
  const index = ORDER.indexOf(step);
  return index < reached ? "done" : index === reached ? "current" : "todo";
}
