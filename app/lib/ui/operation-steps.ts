// Tony (24/11/2026, "PROGRESSIONE DELLE OPERAZIONI", B): the CTE search is shown as the requests it really makes, in order.
// A step becomes "done" only when its request has answered, "failed" when it answered with an error, "skipped" when it is
// not needed; the times are measured by the browser. No percentage.

export type OperationStepStatus = "done" | "current" | "todo" | "failed" | "skipped";
export interface OperationStep { readonly key: string; readonly label: string; readonly status: OperationStepStatus; readonly startedAt?: number; readonly durationMs?: number; readonly detail?: string }

export const CTE_SEARCH_STEPS: readonly { readonly key: CteSearchStep; readonly label: string }[] = [
  { key: "confirm", label: "Conferma dei dati letti" },
  { key: "approve", label: "Approvazione della bolletta" },
  { key: "cte", label: "Verifica delle CTE utilizzabili" },
  { key: "compare", label: "Calcolo del confronto economico" },
];
export type CteSearchStep = "confirm" | "approve" | "cte" | "compare";

export function newSteps(list: readonly { readonly key: string; readonly label: string }[]): readonly OperationStep[] {
  return list.map((step) => ({ key: step.key, label: step.label, status: "todo" }));
}

/** Marks `key` as running from `now`. */
export function startStep(steps: readonly OperationStep[], key: string, now: number): readonly OperationStep[] {
  return steps.map((step) => step.key === key ? { key: step.key, label: step.label, status: "current", startedAt: now } : step);
}

/** Marks `key` as finished: done (with its duration if it had started), failed or skipped, with an optional detail. */
export function endStep(steps: readonly OperationStep[], key: string, status: "done" | "failed" | "skipped", now: number, detail?: string): readonly OperationStep[] {
  return steps.map((step) => {
    if (step.key !== key) return step;
    const durationMs = status === "done" && step.startedAt !== undefined ? Math.max(0, now - step.startedAt) : undefined;
    return { key: step.key, label: step.label, status, ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}), ...(durationMs !== undefined ? { durationMs } : {}), ...(detail ? { detail } : {}) };
  });
}

/** When an error arrives, the step that was running is the one that failed. */
export function failRunning(steps: readonly OperationStep[], now: number, detail: string): readonly OperationStep[] {
  const running = steps.find((step) => step.status === "current");
  return running ? endStep(steps, running.key, "failed", now, detail) : steps;
}

/** "7 CTE trovate, 3 utilizzabili per il calcolo": counts of what the server returned for this bill. */
export function cteCountText(candidates: readonly { readonly finalStatus?: string; readonly calculationReadiness: string; readonly cteVersionId: string | null }[]): string {
  const usable = candidates.filter((item) => (item.finalStatus === "ELIGIBLE" || item.finalStatus === "ELIGIBLE_BY_OVERRIDE") && item.calculationReadiness === "READY" && Boolean(item.cteVersionId)).length;
  const found = candidates.length;
  return `${found === 1 ? "1 CTE trovata" : `${found} CTE trovate`}, ${usable === 1 ? "1 utilizzabile" : `${usable} utilizzabili`} per il calcolo`;
}

export function finished(steps: readonly OperationStep[]): boolean { return steps.every((step) => step.status === "done" || step.status === "skipped"); }
export function totalMs(steps: readonly OperationStep[]): number { return steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0); }
