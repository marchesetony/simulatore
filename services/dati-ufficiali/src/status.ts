import { createHash } from "node:crypto";
import type { OfficialDocumentCode } from "../../../app/lib/official-monitor/catalog";
import { OFFICIAL_MONITOR_TENANT, setAlertStatus, upsertAlert, type MonitorRepositories, type OfficialCheck } from "../../../app/lib/official-monitor/monitor";
import type { ServiceStore } from "./store";
import { SERVICE_IDENTITY } from "./identity";

/**
 * What the Control Room shows (Tony 21/11/2026): each acquisition is a check in the existing archive of checks (state, source,
 * last acquisition, next check written in the detail) and each anomaly an alert in the existing alerts, so the producer sees
 * them where he already looks. Nothing is shown to client companies.
 */
export type ServiceMode = "DRY_RUN" | "PUBLISH";
export const monitorRepositories = (store: ServiceStore): MonitorRepositories => ({ alerts: store.writable("official-alerts"), checks: store.writable("official-checks") });

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 40);
const when = (iso: string) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" });

export async function recordCheck(store: ServiceStore, input: { readonly code: OfficialDocumentCode; readonly period: string; readonly at: string; readonly outcome: OfficialCheck["outcome"]; readonly detail: string; readonly nextCheckAt: string; readonly alertId: string | null }): Promise<OfficialCheck> {
  const checkId = `official-check_${hash(`service|${input.code}|${input.period}|${input.at}`)}`;
  const detail = `${input.detail} · servizio automatico · prossima verifica ${when(input.nextCheckAt)}`.replace(/[\r\n\t]+/g, " ").slice(0, 400);
  const payload: OfficialCheck = { checkId, code: input.code, period: input.period, at: input.at, why: `${SERVICE_IDENTITY.name}`, outcome: input.outcome, detail, alertId: input.alertId };
  const checks = store.writable<OfficialCheck>("official-checks");
  if (!(await checks.get(OFFICIAL_MONITOR_TENANT, checkId))) await checks.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: checkId, payload, idempotencyKey: checkId, now: input.at });
  return payload;
}

export async function raiseAnomaly(store: ServiceStore, code: OfficialDocumentCode, period: string, reason: string, now: string): Promise<string> {
  const alert = await upsertAlert(monitorRepositories(store), { code, period, reason: reason.replace(/[\r\n\t]+/g, " ").slice(0, 600), now });
  return alert.alertId;
}

export async function resolveAnomaly(store: ServiceStore, code: OfficialDocumentCode, period: string, note: string, now: string): Promise<void> {
  await setAlertStatus(monitorRepositories(store), code, period, "RESOLVED", note, now);
}

export interface ServiceRun {
  readonly runId: string;
  readonly job: string;
  readonly mode: ServiceMode;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly identity: string;
  readonly outcome: "OK" | "PARTIAL" | "FAILED" | "ALREADY_RUNNING";
  readonly nextCheckAt: string;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly errors: readonly string[];
}

export async function recordRun(store: ServiceStore, run: ServiceRun): Promise<void> {
  const recordId = `svcrun_${run.job}_${hash(`${run.job}|${run.startedAt}|${run.runId}`)}`;
  await store.writable<ServiceRun>("official-service-runs").append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId, payload: run, idempotencyKey: recordId, now: run.finishedAt });
}

/** Next daily run at hh:mm UTC after `now`. */
export function nextDailyRun(now: string, hourUtc: number, minuteUtc: number): string {
  const date = new Date(now);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hourUtc, minuteUtc));
  if (next.getTime() <= date.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/** A lease per job so two runs never overlap (the cron and a manual call, or a slow run and the next one). */
export async function withJobLease<T>(store: ServiceStore, job: string, runId: string, now: string, run: () => Promise<T>): Promise<{ readonly acquired: boolean; readonly value?: T }> {
  const locks = store.writable<{ owner: string; expiresAt: string }>("official-service-locks");
  const recordId = `svclock_${job}`;
  const existing = await locks.get(OFFICIAL_MONITOR_TENANT, recordId);
  if (existing && Date.parse(existing.payload.expiresAt) > Date.parse(now)) return { acquired: false };
  const lease = { owner: runId, expiresAt: new Date(Date.parse(now) + 10 * 60_000).toISOString() };
  try {
    if (existing) await locks.put({ tenantId: OFFICIAL_MONITOR_TENANT, recordId, payload: lease, expectedVersion: existing.version, now });
    else await locks.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId, payload: lease, now });
  } catch (error) {
    if (/CONFLICT|ALREADY_EXISTS|VERSION/i.test(error instanceof Error ? error.message : "")) return { acquired: false };
    throw error;
  }
  try { return { acquired: true, value: await run() }; }
  finally {
    const current = await locks.get(OFFICIAL_MONITOR_TENANT, recordId).catch(() => null);
    if (current && current.payload.owner === runId) await locks.put({ tenantId: OFFICIAL_MONITOR_TENANT, recordId, payload: { owner: runId, expiresAt: now }, expectedVersion: current.version, now }).catch(() => undefined);
  }
}
