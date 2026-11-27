import type { TenantRecordRepository } from "../persistence/types";

/**
 * Manual commands of the Control Room (Tony 23/11/2026): «Aggiorna GME», «Aggiorna ARERA», «Aggiorna Terna» start the job of the
 * independent official data service from the server, never from the browser. The service keeps its own mode: with
 * OFFICIAL_DATA_SERVICE_MODE unset it downloads, checks and reports, and publishes nothing. Two configuration values, server only:
 * - OFFICIAL_DATA_SERVICE_URL: the service's production address (https);
 * - OFFICIAL_DATA_SERVICE_SECRET: the secret the service accepts (its CRON_SECRET), never sent to the browser or logged.
 * A job already running (the service's lease in official-service-locks, or a command still in flight here) is never started twice.
 */
export const MANUAL_COMMANDS = {
  gme: { job: "gme", scope: null, label: "Aggiorna GME", source: "GME" },
  arera: { job: "regulatory", scope: "arera", label: "Aggiorna ARERA", source: "ARERA" },
  terna: { job: "regulatory", scope: "terna", label: "Aggiorna Terna", source: "TERNA" },
} as const;
export type ManualCommand = keyof typeof MANUAL_COMMANDS;
export const isManualCommand = (value: unknown): value is ManualCommand => typeof value === "string" && Object.prototype.hasOwnProperty.call(MANUAL_COMMANDS, value);

export interface ServiceTriggerConfig { readonly baseUrl: string; readonly secret: string }
export interface ServiceTriggerEnvironment { readonly OFFICIAL_DATA_SERVICE_URL?: string; readonly OFFICIAL_DATA_SERVICE_SECRET?: string }

/** null when the commands are not connected to the service in this environment (the buttons say so and stay off). */
export function serviceTriggerConfig(env: ServiceTriggerEnvironment = process.env as ServiceTriggerEnvironment): ServiceTriggerConfig | null {
  const secret = env.OFFICIAL_DATA_SERVICE_SECRET?.trim() ?? "";
  let url: URL;
  try { url = new URL(env.OFFICIAL_DATA_SERVICE_URL?.trim() ?? ""); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || secret.length < 16) return null;
  return { baseUrl: url.origin, secret };
}

export interface ActiveJob { readonly job: string; readonly since: string | null; readonly until: string }
/** The service's lease of a job: active while its expiry is in the future (the service releases it at the end of the run). */
export async function activeServiceJob(locks: TenantRecordRepository<unknown>, job: string, now: string): Promise<ActiveJob | null> {
  const record = await locks.get("tenant_piattaforma", `svclock_${job}`).catch(() => null);
  const payload = record?.payload as { readonly owner?: unknown; readonly expiresAt?: unknown } | undefined;
  if (!payload || typeof payload.expiresAt !== "string" || !(Date.parse(payload.expiresAt) > Date.parse(now))) return null;
  // The lease lasts ten minutes from the start of the run.
  const since = new Date(Date.parse(payload.expiresAt) - 10 * 60_000).toISOString();
  return { job, since: Number.isFinite(Date.parse(since)) ? since : null, until: payload.expiresAt };
}

export type TriggerStatus = "COMPLETED" | "ALREADY_RUNNING" | "RUNNING" | "FAILED";
export interface TriggerResult { readonly command: ManualCommand; readonly status: TriggerStatus; readonly outcome: string | null; readonly message: string; readonly errors: readonly string[] }

const OUTCOME_MESSAGE: Readonly<Record<string, string>> = {
  OK: "Esecuzione completata senza anomalie (modalità prova: nulla è stato pubblicato).",
  PARTIAL: "Esecuzione completata con anomalie: dettagli nella scheda della fonte.",
  FAILED: "Esecuzione non riuscita: dettagli nella scheda della fonte.",
};
const HTTP_MESSAGE: Readonly<Record<number, string>> = {
  401: "Il servizio ha rifiutato il comando: il collegamento tra Simulatore e servizio non è valido.",
  400: "Il servizio non riconosce il comando: versione del servizio non aggiornata.",
};

/** In-flight commands of this server instance, so a double click does not reach the service twice. */
const inFlight = new Set<string>();
export const commandKey = (command: ManualCommand) => MANUAL_COMMANDS[command].job;

/**
 * Starts one command and waits for the service's answer up to `timeoutMs`; a longer run keeps going on the service and is shown as
 * RUNNING (its report appears in the Control Room when it ends). The secret travels only in the Authorization header.
 */
export async function triggerServiceJob(input: { readonly command: ManualCommand; readonly config: ServiceTriggerConfig; readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number }): Promise<TriggerResult> {
  const { command, config } = input;
  const spec = MANUAL_COMMANDS[command];
  const key = commandKey(command);
  if (inFlight.has(key)) return { command, status: "ALREADY_RUNNING", outcome: null, message: "Un aggiornamento dello stesso servizio è già in corso.", errors: [] };
  inFlight.add(key);
  const url = new URL("/api/run", config.baseUrl);
  url.searchParams.set("job", spec.job);
  if (spec.scope) url.searchParams.set("scope", spec.scope);
  try {
    const response = await (input.fetchImpl ?? fetch)(url.toString(), { method: "GET", redirect: "error", cache: "no-store", headers: { authorization: `Bearer ${config.secret}` }, signal: AbortSignal.timeout(input.timeoutMs ?? 50_000) });
    const body = await response.json().catch(() => null) as { readonly outcome?: unknown; readonly errors?: unknown; readonly error?: unknown } | null;
    const outcome = typeof body?.outcome === "string" ? body.outcome : null;
    const errors = Array.isArray(body?.errors) ? body!.errors.filter((item): item is string => typeof item === "string").slice(0, 50) : typeof body?.error === "string" ? [body.error] : [];
    if (outcome === "ALREADY_RUNNING") return { command, status: "ALREADY_RUNNING", outcome, message: "Il servizio sta già eseguendo questo aggiornamento: attendi la fine.", errors: [] };
    if (response.status === 200 && (outcome === "OK" || outcome === "PARTIAL")) return { command, status: "COMPLETED", outcome, message: OUTCOME_MESSAGE[outcome], errors };
    if (outcome === "FAILED") return { command, status: "FAILED", outcome, message: OUTCOME_MESSAGE.FAILED, errors };
    return { command, status: "FAILED", outcome, message: HTTP_MESSAGE[response.status] ?? `Il servizio ha risposto con un errore (HTTP ${response.status}).`, errors };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { command, status: "RUNNING", outcome: null, message: "Il servizio sta ancora lavorando: il risultato comparirà qui al termine dell'esecuzione.", errors: [] };
    return { command, status: "FAILED", outcome: null, message: "Servizio non raggiungibile in questo momento: riprova più tardi.", errors: [] };
  } finally {
    inFlight.delete(key);
  }
}
