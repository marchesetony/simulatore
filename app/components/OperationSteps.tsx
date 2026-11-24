"use client";
import { useEffect, useState, type ReactNode } from "react";
import { durationText } from "../lib/ui/bill-analysis-steps";
import type { OperationStep } from "../lib/ui/operation-steps";

// Tony (24/11/2026, "PROGRESSIONE DELLE OPERAZIONI", B e C): operations made of several requests show each request as a
// step that is done, running, failed or not needed, with the time measured by the browser. No percentage: none of these
// requests reports one.

/** The current time, refreshed every second while `active`; used only to show elapsed times. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // First refresh right away (not inside the effect body), then every second.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [active]);
  return now;
}

/** A short wait: a moving mark, what is happening and, after 3 seconds, how long it has been going on (counted from when
 *  the wait appears on screen, which is when the request starts). */
export function ActivityIndicator({ label }: { readonly label: string }): ReactNode {
  const [startedAt] = useState(() => Date.now());
  const now = useNow(true);
  const elapsed = now - startedAt;
  return <p className="activity-indicator" role="status" aria-live="polite"><span className="activity-spinner" aria-hidden="true" /><span>{label}</span>{elapsed >= 3000 ? <small>da {durationText(elapsed)}</small> : null}</p>;
}

const MARK: Record<OperationStep["status"], string> = { done: "✓", current: "", todo: "", failed: "✕", skipped: "–" };
const STATE_TEXT: Record<OperationStep["status"], string> = { done: "completato", current: "in corso", todo: "da eseguire", failed: "non riuscito", skipped: "non necessario" };

export function OperationSteps({ title, steps }: { readonly title: string; readonly steps: readonly OperationStep[] }): ReactNode {
  const running = steps.some((step) => step.status === "current");
  const now = useNow(running);
  const failed = steps.some((step) => step.status === "failed");
  return <div className={`op-steps${failed ? " has-failure" : ""}`} aria-live="polite">
    <p className="op-steps-title">{title}</p>
    <ol>{steps.map((step) => <li key={step.key} className={`op-step ${step.status}`} aria-current={step.status === "current" ? "step" : undefined}>
      <span className="op-step-dot" aria-hidden="true">{MARK[step.status]}</span>
      <span className="op-step-body">
        <span className="op-step-label">{step.label}<span className="visually-hidden">: {STATE_TEXT[step.status]}</span></span>
        {step.status === "current" && step.startedAt !== undefined ? <small className="op-step-time">in corso, da {durationText(now - step.startedAt)}</small> : null}
        {step.status === "done" && step.durationMs !== undefined ? <small className="op-step-time">{durationText(step.durationMs)}</small> : null}
        {step.detail ? <small className={step.status === "failed" ? "op-step-detail failure" : "op-step-detail"} role={step.status === "failed" ? "alert" : undefined}>{step.detail}</small> : null}
      </span>
    </li>)}</ol>
  </div>;
}
