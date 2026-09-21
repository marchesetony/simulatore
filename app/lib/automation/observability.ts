import { createHash } from "node:crypto";
import type { TenantRecord, TenantRecordRepository, JobIncidentRecord, JobRunRecord, ObservedJobKey, ObservedJobTrigger, SafeJobDiagnostics } from "../persistence/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";

export interface JobSchedule { readonly jobKey: ObservedJobKey; readonly cron: string; readonly intervalMs: number; readonly graceMs: number; }
export const AUTOMATION_SCHEDULES: readonly JobSchedule[] = Object.freeze([
  { jobKey: "REGULATORY_REFRESH", cron: "15 3 * * *", intervalMs: 86_400_000, graceMs: 3_600_000 },
  { jobKey: "MARKET_REFRESH", cron: "15 4 * * *", intervalMs: 86_400_000, graceMs: 3_600_000 },
  { jobKey: "BILL_RETENTION", cron: "0 5 * * *", intervalMs: 86_400_000, graceMs: 3_600_000 },
  { jobKey: "CTE_EXPIRY", cron: "30 5 * * *", intervalMs: 86_400_000, graceMs: 3_600_000 },
]);

const validIso = (value?: string): string => { const result = value ?? new Date().toISOString(); if (!Number.isFinite(Date.parse(result))) throw new Error("AUTOMATION_TIMESTAMP_INVALID"); return new Date(result).toISOString(); };
const runRecordId = (tenantId: string, jobKey: ObservedJobKey, runId: string): string => deterministicRecordId("job-run", tenantId, `${jobKey}:${runId}`);
const incidentRecordId = (tenantId: string, jobKey: ObservedJobKey, fingerprint: string): string => deterministicRecordId("job-incident", tenantId, `${jobKey}:${fingerprint}`);
const sanitize = (value: string): string => value.replace(/[\r\n\t]+/g, " ").slice(0, 160);
const diagnostic = (code: string, stage: string, retryable: boolean): SafeJobDiagnostics => ({ code: sanitize(code), stage: sanitize(stage), retryable });

export function observedRunId(jobKey: ObservedJobKey, tenantId: string, now: string): string { return `${jobKey}:${tenantId}:${validIso(now).slice(0, 16)}`; }
export function safeJobDiagnostics(error: unknown, stage: string): SafeJobDiagnostics { const code = error instanceof Error ? error.message : "AUTOMATION_JOB_FAILED"; return diagnostic(code, stage, /TIMEOUT|NETWORK|5\d\d|429|503|504/i.test(code) && !/INVALID|SCHEMA|UNAUTHORIZED|SEMANTIC/i.test(code)); }

export async function observeJob<T>(input: {
  readonly repository: TenantRecordRepository<JobRunRecord>;
  readonly incidents: TenantRecordRepository<JobIncidentRecord>;
  readonly tenantId: string;
  readonly jobKey: ObservedJobKey;
  readonly trigger: ObservedJobTrigger;
  readonly now: string;
  readonly operation: () => Promise<T>;
  readonly summary?: (value: T) => Readonly<Record<string, number>>;
}): Promise<{ readonly executed: boolean; readonly run: TenantRecord<JobRunRecord>; readonly value?: T }> {
  const startedAt = validIso(input.now); const runId = observedRunId(input.jobKey, input.tenantId, startedAt); const recordId = runRecordId(input.tenantId, input.jobKey, runId); const existing = await input.repository.get(input.tenantId, recordId);
  if (existing) return { executed: false, run: existing };
  const started: JobRunRecord = { runId, tenantId: input.tenantId, jobKey: input.jobKey, trigger: input.trigger, startedAt, finishedAt: null, status: "RUNNING", durationMs: null, summary: {}, diagnostics: null };
  const saved = await input.repository.append({ tenantId: input.tenantId, recordId, payload: started, idempotencyKey: runId, now: startedAt });
  try {
    const value = await input.operation(); const finishedAt = startedAt; const completed: JobRunRecord = { ...started, finishedAt, status: "SUCCESS", durationMs: 0, summary: input.summary?.(value) ?? {}, diagnostics: null };
    const run = await input.repository.put({ tenantId: input.tenantId, recordId, payload: completed, expectedVersion: saved.version, idempotencyKey: `${runId}:complete`, now: finishedAt });
    return { executed: true, run, value };
  } catch (error) {
    const finishedAt = startedAt; const diagnostics = safeJobDiagnostics(error, input.jobKey); const failed: JobRunRecord = { ...started, finishedAt, status: "FAILED", durationMs: 0, summary: {}, diagnostics };
    await input.repository.put({ tenantId: input.tenantId, recordId, payload: failed, expectedVersion: saved.version, idempotencyKey: `${runId}:failed`, now: finishedAt });
    await recordIncident({ repository: input.incidents, tenantId: input.tenantId, jobKey: input.jobKey, runId, diagnostics, now: finishedAt });
    throw error;
  }
}

export async function recordIncident(input: { readonly repository: TenantRecordRepository<JobIncidentRecord>; readonly tenantId: string; readonly jobKey: ObservedJobKey; readonly runId: string; readonly diagnostics: SafeJobDiagnostics; readonly now?: string }): Promise<TenantRecord<JobIncidentRecord>> {
  const now = validIso(input.now); const fingerprint = createHash("sha256").update(`${input.jobKey}|${input.diagnostics.code}|${input.diagnostics.stage}`, "utf8").digest("hex").slice(0, 40); const recordId = incidentRecordId(input.tenantId, input.jobKey, fingerprint); const existing = await input.repository.get(input.tenantId, recordId);
  if (existing?.payload.status === "OPEN") return input.repository.put({ tenantId: input.tenantId, recordId, payload: { ...existing.payload, lastSeenAt: now, occurrences: existing.payload.occurrences + 1, lastRunId: input.runId }, expectedVersion: existing.version, idempotencyKey: `incident:${fingerprint}:${input.runId}`, now });
  const payload: JobIncidentRecord = { incidentId: recordId, tenantId: input.tenantId, jobKey: input.jobKey, fingerprint, status: "OPEN", firstSeenAt: existing?.payload.firstSeenAt ?? now, lastSeenAt: now, resolvedAt: null, occurrences: (existing?.payload.occurrences ?? 0) + 1, lastRunId: input.runId, diagnostics: input.diagnostics };
  if (!existing) return input.repository.append({ tenantId: input.tenantId, recordId, payload, idempotencyKey: `incident:${fingerprint}:${input.runId}`, now });
  return input.repository.put({ tenantId: input.tenantId, recordId, payload, expectedVersion: existing.version, idempotencyKey: `incident:${fingerprint}:${input.runId}`, now });
}

export async function resolveIncident(repository: TenantRecordRepository<JobIncidentRecord>, tenantId: string, incidentId: string, now?: string): Promise<TenantRecord<JobIncidentRecord>> {
  const current = await repository.get(tenantId, incidentId); if (!current) throw new Error("JOB_INCIDENT_NOT_FOUND"); if (current.payload.status === "RESOLVED") return current; const resolvedAt = validIso(now);
  return repository.put({ tenantId, recordId: incidentId, payload: { ...current.payload, status: "RESOLVED", resolvedAt }, expectedVersion: current.version, now: resolvedAt });
}

export async function detectMissedJobs(input: { readonly repository: TenantRecordRepository<JobRunRecord>; readonly incidents: TenantRecordRepository<JobIncidentRecord>; readonly tenantId: string; readonly now: string }): Promise<readonly ObservedJobKey[]> {
  const now = Date.parse(validIso(input.now)); const runs = await input.repository.list(input.tenantId); const missed: ObservedJobKey[] = [];
  for (const schedule of AUTOMATION_SCHEDULES) {
    const latest = runs.filter((entry) => entry.payload.jobKey === schedule.jobKey && entry.payload.status === "SUCCESS").sort((a, b) => Date.parse(b.payload.finishedAt ?? "") - Date.parse(a.payload.finishedAt ?? ""))[0];
    if (latest?.payload.finishedAt && now - Date.parse(latest.payload.finishedAt) > schedule.intervalMs + schedule.graceMs) { missed.push(schedule.jobKey); await recordIncident({ repository: input.incidents, tenantId: input.tenantId, jobKey: schedule.jobKey, runId: `missed:${schedule.jobKey}:${input.now.slice(0, 10)}`, diagnostics: diagnostic("JOB_MISSED", "schedule", true), now: input.now }); }
  }
  return missed;
}

export async function operationsStatus(input: { readonly repository: TenantRecordRepository<JobRunRecord>; readonly incidents: TenantRecordRepository<JobIncidentRecord>; readonly tenantId: string; readonly now: string }): Promise<{ readonly runs: readonly JobRunRecord[]; readonly openIncidents: readonly JobIncidentRecord[]; readonly missedJobs: readonly ObservedJobKey[] }> {
  const runs = await input.repository.list(input.tenantId); const missedJobs = await detectMissedJobs(input); const incidents = await input.incidents.list(input.tenantId); return { runs: runs.map((entry) => entry.payload).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), openIncidents: incidents.map((entry) => entry.payload).filter((entry) => entry.status === "OPEN"), missedJobs };
}
