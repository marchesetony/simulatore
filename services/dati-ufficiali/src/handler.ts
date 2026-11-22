import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { officialDataTenants } from "../../../app/lib/automation/official-data-tenants";
import type { Company } from "../../../app/lib/access/types";
import { createServiceStore, type ServiceStore } from "./store";
import { postgresBackend, serviceDatabaseConfig, type ServiceDatabaseBackend, type ServiceDatabaseEnvironment } from "./database";
import { createOfficialFetch } from "./official-fetch";
import { gmeSourcePages, runGmeJob } from "./gme/job";
import { runPunAudit } from "./gme/audit";
import { runRegulatoryJob } from "./regulatory/job";
import { nextDailyRun, recordRun, withJobLease, type ServiceMode } from "./status";
import { SERVICE_IDENTITY } from "./identity";
import { PLATFORM_TENANT } from "./documents";

/**
 * Entry point of the independent official data service (Tony 21/11/2026, opzione A). Called only by its own scheduled jobs with
 * the CRON_SECRET of its Vercel project; no user login, no session, no access to the commercial application.
 * - job=gme: PUN F1/F2/F3 and monthly value (daily);
 * - job=regulatory: ARERA and Terna (daily);
 * - job=audit-pun: read-only audit of the approved PUN months (weekly, and on demand).
 * OFFICIAL_DATA_SERVICE_MODE=publish is required to write; anything else is a dry run that downloads, checks and reports only.
 */
export const SCHEDULE = {
  gme: { path: "/api/run?job=gme", cron: "20 5 * * *", hour: 5, minute: 20 },
  regulatory: { path: "/api/run?job=regulatory", cron: "40 3 * * *", hour: 3, minute: 40 },
  "audit-pun": { path: "/api/run?job=audit-pun", cron: "0 6 * * 1", hour: 6, minute: 0 },
} as const;
export type JobName = keyof typeof SCHEDULE;
export const AUDIT_MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] as const;

export interface ServiceEnvironment extends ServiceDatabaseEnvironment {
  readonly CRON_SECRET?: string;
  readonly OFFICIAL_DATA_SERVICE_MODE?: string;
  readonly OFFICIAL_DATA_TENANT_IDS?: string;
}
export interface HandlerDependencies { readonly store?: ServiceStore; readonly fetchImpl?: typeof fetch; readonly now?: () => string; readonly sleep?: (ms: number) => Promise<void> }

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const safeEqual = (left: string, right: string) => { const a = createHash("sha256").update(left).digest(); const b = createHash("sha256").update(right).digest(); return timingSafeEqual(a, b); };

export function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.trim().length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  return safeEqual(header, `Bearer ${secret.trim()}`);
}

export function configuredTenants(env: ServiceEnvironment): readonly string[] {
  const values = (env.OFFICIAL_DATA_TENANT_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.some((value) => !/^tenant_[a-z0-9-]+$/.test(value))) throw new Error("OFFICIAL_DATA_TENANTS_INVALID");
  return values;
}

export async function handle(request: Request, env: ServiceEnvironment, dependencies: HandlerDependencies = {}): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (!authorized(request, env.CRON_SECRET)) return json(401, { error: "CRON_UNAUTHORIZED" });
  const job = new URL(request.url).searchParams.get("job") as JobName | null;
  if (!job || !(job in SCHEDULE)) return json(400, { error: "JOB_UNKNOWN" });
  const mode: ServiceMode = env.OFFICIAL_DATA_SERVICE_MODE === "publish" ? "PUBLISH" : "DRY_RUN";
  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  // Fase B (Tony 21/11/2026): only the database role svc_dati_ufficiali, never a Supabase key.
  let store: ServiceStore;
  let database: ServiceDatabaseBackend | null = null;
  try {
    if (dependencies.store) store = dependencies.store;
    else { database = postgresBackend(serviceDatabaseConfig(env)); store = createServiceStore(database); }
  } catch (error) { return json(500, { error: error instanceof Error ? error.message : "SERVICE_CONFIGURATION_INVALID" }); }
  try { return await runJob(job, mode, env, store, dependencies, now); }
  finally { await database?.close().catch(() => undefined); }
}

async function runJob(job: JobName, mode: ServiceMode, env: ServiceEnvironment, store: ServiceStore, dependencies: HandlerDependencies, now: string): Promise<Response> {
  const runId = `svc_${job}_${randomUUID()}`;
  const nextCheckAt = nextDailyRun(now, SCHEDULE[job].hour, SCHEDULE[job].minute);
  const official = createOfficialFetch({ fetchImpl: dependencies.fetchImpl, now: () => (dependencies.now ?? (() => new Date().toISOString()))(), sleep: dependencies.sleep });
  try {
    const companies = { list: (tenantId: string) => store.readOnly<Company>("companies").list(tenantId) } as never;
    const clientTenants = await officialDataTenants(() => configuredTenants(env), companies);
    const lease = await withJobLease(store, job, runId, now, async () => {
      if (job === "gme") {
        const months = await runGmeJob({ store, fetcher: official.fetch, recorded: official.recorded, tenants: [PLATFORM_TENANT, ...clientTenants], now, mode, nextCheckAt });
        const sources = await gmeSourcePages(official.fetch, official.recorded);
        return { months, sources, errors: [...months.flatMap((month) => [...month.errors, ...(month.punop?.errors ?? [])].filter((error) => !/NOT_PUBLISHED_YET/.test(error)).map((error) => `${month.month}:${error}`)), ...sources.filter((page) => !page.reachable).map((page) => `GME_SOURCE_PAGE_UNREACHABLE:${page.id}`)] };
      }
      if (job === "regulatory") {
        const result = await runRegulatoryJob({ store, fetcher: official.fetch, recorded: official.recorded, tenants: clientTenants, now, mode, nextCheckAt, runId });
        return { ...result, errors: result.errors };
      }
      const audits = await runPunAudit({ store, fetcher: official.fetch, recorded: official.recorded, tenants: [PLATFORM_TENANT, ...clientTenants], months: AUDIT_MONTHS, now, mode });
      return { audits, errors: audits.flatMap((audit) => audit.errors.map((error) => `${audit.month}:${error}`)) };
    });
    if (!lease.acquired) return json(200, { job, mode, outcome: "ALREADY_RUNNING" });
    const value = lease.value!;
    const outcome = value.errors.length === 0 ? "OK" : "PARTIAL";
    const summary = { ...value, downloads: official.recorded.map((doc) => ({ url: doc.url, sha256: doc.sha256, size: doc.size })), downloadFailures: official.failures };
    await recordRun(store, { runId, job, mode, startedAt: now, finishedAt: new Date().toISOString(), identity: SERVICE_IDENTITY.principalId, outcome, nextCheckAt, summary: JSON.parse(JSON.stringify({ ...summary, downloads: summary.downloads.slice(0, 200) })), errors: value.errors.slice(0, 100) }).catch(() => undefined);
    return json(200, { job, mode, identity: SERVICE_IDENTITY.principalId, outcome, nextCheckAt, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SERVICE_JOB_FAILED";
    await recordRun(store, { runId, job, mode, startedAt: now, finishedAt: new Date().toISOString(), identity: SERVICE_IDENTITY.principalId, outcome: "FAILED", nextCheckAt, summary: {}, errors: [message] }).catch(() => undefined);
    return json(500, { job, mode, outcome: "FAILED", error: message });
  }
}
