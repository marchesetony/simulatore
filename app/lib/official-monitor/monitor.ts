import { createHash } from "node:crypto";
import type { TenantRecordRepository } from "../persistence/types";
import { catalogEntry, dueChecks, officialLinkFor, type DueCheck, type OfficialDocumentCode, type OfficialSource } from "./catalog";

/**
 * Control Room produttore: esecuzione dei controlli programmati e alert. Un alert per documento e periodo (id deterministico):
 * un nuovo esito negativo aggiorna lo stesso alert (occorrenze, ultimo controllo), mai un duplicato. Ogni controllo lascia un
 * esito registrato. Gli alert e gli esiti sono della piattaforma (tenant_piattaforma): le aziende clienti non li vedono.
 */
export const OFFICIAL_MONITOR_TENANT = "tenant_piattaforma";

export type AlertStatus = "OPEN" | "FILE_UPLOADED" | "REJECTED" | "RESOLVED";
export const ALERT_STATUS_LABEL: Readonly<Record<AlertStatus, string>> = {
  OPEN: "Da lavorare",
  FILE_UPLOADED: "File caricato, in validazione",
  REJECTED: "File rifiutato dalla validazione: caricare il file corretto",
  RESOLVED: "Risolto",
};

export interface OfficialAlert {
  readonly alertId: string;
  readonly code: OfficialDocumentCode;
  readonly source: OfficialSource;
  readonly document: string;
  readonly period: string;
  readonly officialLink: string;
  readonly reason: string;
  readonly instructions: readonly string[];
  readonly uploadPath: string;
  readonly status: AlertStatus;
  readonly firstSeenAt: string;
  readonly lastCheckedAt: string;
  readonly occurrences: number;
  readonly history: readonly { readonly at: string; readonly status: AlertStatus; readonly note: string }[];
}

export type CheckOutcome = "COVERED" | "ACQUIRED" | "FAILED" | "MANUAL_REQUIRED";
export interface OfficialCheck { readonly checkId: string; readonly code: OfficialDocumentCode; readonly period: string; readonly at: string; readonly why: string; readonly outcome: CheckOutcome; readonly detail: string; readonly alertId: string | null }

/** What the monitor needs from the rest of the app for one document: is it in the archive, and how to try to get it. */
export interface DocumentProbe {
  /** True when a verified value for the period is in the archive; null when the document has no archive check (always attempt). */
  readonly covered: (period: string) => Promise<boolean | null>;
  /** Automatic acquisition from the official source with a verified format; absent when none exists. */
  readonly acquire?: (period: string) => Promise<{ readonly ok: boolean; readonly errors: readonly string[] }>;
}
export type DocumentProbes = Partial<Readonly<Record<OfficialDocumentCode, DocumentProbe>>>;

export interface MonitorRepositories { readonly alerts: TenantRecordRepository<unknown>; readonly checks: TenantRecordRepository<unknown> }

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 40);
export const alertIdFor = (code: OfficialDocumentCode, period: string) => `official-alert_${hash(`${code}|${period}`)}`;

export async function upsertAlert(repositories: MonitorRepositories, input: { readonly code: OfficialDocumentCode; readonly period: string; readonly reason: string; readonly now: string; readonly status?: AlertStatus }): Promise<OfficialAlert> {
  const entry = catalogEntry(input.code);
  const alertId = alertIdFor(input.code, input.period);
  const existing = await repositories.alerts.get(OFFICIAL_MONITOR_TENANT, alertId);
  const previous = existing?.payload as OfficialAlert | undefined;
  const status = input.status ?? (previous && previous.status !== "RESOLVED" ? previous.status : "OPEN");
  const payload: OfficialAlert = {
    alertId, code: input.code, source: entry.source, document: entry.document, period: input.period, officialLink: officialLinkFor(entry, input.period),
    reason: input.reason, instructions: entry.instructions, uploadPath: entry.uploadPath, status,
    firstSeenAt: previous?.firstSeenAt ?? input.now, lastCheckedAt: input.now, occurrences: (previous?.occurrences ?? 0) + 1,
    history: [...(previous?.history ?? []), { at: input.now, status, note: input.reason }].slice(-50),
  };
  const key = `${alertId}:${input.now}:${status}`;
  if (!existing) await repositories.alerts.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: alertId, payload, idempotencyKey: key, now: input.now });
  else await repositories.alerts.put({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: alertId, payload, expectedVersion: existing.version, idempotencyKey: key, now: input.now });
  return payload;
}

export async function setAlertStatus(repositories: MonitorRepositories, code: OfficialDocumentCode, period: string, status: AlertStatus, note: string, now: string): Promise<OfficialAlert | null> {
  const alertId = alertIdFor(code, period);
  const existing = await repositories.alerts.get(OFFICIAL_MONITOR_TENANT, alertId);
  if (!existing) return null;
  const previous = existing.payload as OfficialAlert;
  if (previous.status === status && status === "RESOLVED") return previous;
  const payload: OfficialAlert = { ...previous, status, lastCheckedAt: now, history: [...previous.history, { at: now, status, note }].slice(-50) };
  await repositories.alerts.put({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: alertId, payload, expectedVersion: existing.version, idempotencyKey: `${alertId}:${now}:${status}`, now });
  return payload;
}

async function logCheck(repositories: MonitorRepositories, check: Omit<OfficialCheck, "checkId">): Promise<OfficialCheck> {
  const checkId = `official-check_${hash(`${check.code}|${check.period}|${check.at}`)}`;
  const payload: OfficialCheck = { checkId, ...check };
  if (!(await repositories.checks.get(OFFICIAL_MONITOR_TENANT, checkId))) await repositories.checks.append({ tenantId: OFFICIAL_MONITOR_TENANT, recordId: checkId, payload, idempotencyKey: checkId, now: check.at });
  return payload;
}

async function runOne(repositories: MonitorRepositories, probes: DocumentProbes, due: DueCheck, now: string): Promise<OfficialCheck> {
  const entry = catalogEntry(due.code);
  const probe = probes[due.code];
  const base = { code: due.code, period: due.period, at: now, why: due.why };
  if (entry.acquisition === "MANUAL_VERIFICATION") {
    const existing = await repositories.alerts.get(OFFICIAL_MONITOR_TENANT, alertIdFor(due.code, due.period));
    if ((existing?.payload as OfficialAlert | undefined)?.status === "RESOLVED") return logCheck(repositories, { ...base, outcome: "COVERED", detail: "verifica manuale già confermata per il periodo", alertId: null });
    const alert = await upsertAlert(repositories, { code: due.code, period: due.period, reason: "nessuna fonte ufficiale con formato verificato per l'acquisizione automatica: serve la verifica manuale", now });
    return logCheck(repositories, { ...base, outcome: "MANUAL_REQUIRED", detail: alert.reason, alertId: alert.alertId });
  }
  const before = probe ? await probe.covered(due.period) : false;
  if (before === true) {
    await setAlertStatus(repositories, due.code, due.period, "RESOLVED", "documento presente in archivio", now);
    return logCheck(repositories, { ...base, outcome: "COVERED", detail: "documento del periodo già presente e verificato", alertId: null });
  }
  let errors: readonly string[] = [];
  if (entry.acquisition === "AUTOMATIC" && probe?.acquire) {
    const attempt = await probe.acquire(due.period).catch((error: unknown) => ({ ok: false, errors: [error instanceof Error ? error.message : "ACQUISITION_FAILED"] }));
    const after = await probe.covered(due.period);
    if (after === true || (after === null && attempt.ok)) {
      await setAlertStatus(repositories, due.code, due.period, "RESOLVED", "acquisito automaticamente dalla fonte ufficiale", now);
      return logCheck(repositories, { ...base, outcome: "ACQUIRED", detail: "acquisizione automatica riuscita", alertId: null });
    }
    errors = attempt.errors.length ? attempt.errors : ["documento non ancora presente dopo l'acquisizione automatica"];
  } else if (entry.acquisition === "AUTOMATIC") {
    errors = ["acquisizione automatica non collegata in questo ambiente"];
  } else {
    errors = ["documento assente dall'archivio: va scaricato dalla fonte ufficiale e caricato a mano"];
  }
  const reason = errors.slice(0, 3).map((error) => error.replace(/[\r\n\t]+/g, " ").slice(0, 200)).join("; ");
  const alert = await upsertAlert(repositories, { code: due.code, period: due.period, reason, now });
  return logCheck(repositories, { ...base, outcome: entry.acquisition === "AUTOMATIC" ? "FAILED" : "MANUAL_REQUIRED", detail: reason, alertId: alert.alertId });
}

/** Runs the checks due today (or the ones given) one by one; a failing check never stops the others. */
export async function runOfficialMonitor(input: { readonly repositories: MonitorRepositories; readonly probes: DocumentProbes; readonly now: string; readonly only?: readonly DueCheck[] }): Promise<readonly OfficialCheck[]> {
  const results: OfficialCheck[] = [];
  for (const due of input.only ?? dueChecks(input.now)) {
    try { results.push(await runOne(input.repositories, input.probes, due, input.now)); }
    catch (error) { results.push(await logCheck(input.repositories, { code: due.code, period: due.period, at: input.now, why: due.why, outcome: "FAILED", detail: `controllo non eseguito: ${error instanceof Error ? error.message : "errore"}`.slice(0, 200), alertId: null })); }
  }
  return results;
}

export async function listAlerts(repositories: MonitorRepositories): Promise<readonly OfficialAlert[]> {
  return (await repositories.alerts.list(OFFICIAL_MONITOR_TENANT)).map((record) => record.payload as OfficialAlert).sort((a, b) => b.lastCheckedAt.localeCompare(a.lastCheckedAt));
}
export async function listChecks(repositories: MonitorRepositories, limit = 60): Promise<readonly OfficialCheck[]> {
  return (await repositories.checks.list(OFFICIAL_MONITOR_TENANT)).map((record) => record.payload as OfficialCheck).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
