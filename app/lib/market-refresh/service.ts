import { createHash } from "node:crypto";
import type { ElectricityMonthlyPunRecord } from "../energy/market-data.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { approveMarketArchive, compareMarketVersions, createMarketArchive } from "../market/service.ts";
import type { MarketArchiveRecord, MarketArchiveRepository } from "../market/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertMarketRecord } from "../market/validation.ts";
import type { TenantRecordRepository } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createOfficialPunSourceReader, type PunSourceBundle, type PunSourceCandidate, type PunSourceReader } from "./source.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { CALCULATED_PUN_DOMAINS, MINIMUM_PUN_HISTORY_MONTHS, PUN_REFRESH_STALE_DAYS, assertPunRefreshCoverage } from "./registry.ts";

export type PunRefreshRunStatus = "SUCCESS" | "PARTIAL_FAILURE" | "FAILED" | "ALREADY_RUNNING";
export type PunRefreshSourceStatus = "FRESH" | "STALE" | "FAILED_REVIEW_REQUIRED" | "NEVER_SUCCESSFUL" | "RUNNING";

export interface MarketRefreshState {
  readonly tenantId: string;
  readonly status: PunRefreshSourceStatus;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessfulAt: string | null;
  readonly nextExpectedCheckAt: string | null;
  readonly consecutiveFailures: number;
  readonly lastCheckedAtByMonth: Readonly<Record<string, string>>;
  readonly errors: readonly string[];
}

export interface MarketRefreshRun {
  readonly runId: string;
  readonly tenantId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: PunRefreshRunStatus;
  readonly trigger: "CRON" | "MANUAL" | "TEST";
  readonly targetMonths: readonly string[];
  readonly monthsChecked: number;
  readonly monthsComplete: number;
  readonly monthsUnchanged: number;
  readonly monthsCreated: number;
  readonly monthsCorrected: number;
  readonly monthsFailed: number;
  readonly lastSuccessfulAt: string | null;
  readonly consecutiveFailures: number;
  readonly errors: readonly string[];
}

export interface MarketRefreshSummary {
  readonly runId: string;
  readonly tenantId: string;
  readonly status: PunRefreshRunStatus;
  readonly dryRun: boolean;
  readonly targetMonths: readonly string[];
  readonly monthsChecked: number;
  readonly monthsComplete: number;
  readonly monthsUnchanged: number;
  readonly monthsCreated: number;
  readonly monthsCorrected: number;
  readonly monthsFailed: number;
  readonly errors: readonly string[];
}

export interface MarketRefreshDependencies {
  readonly repositories: {
    readonly marketArchiveRepository: MarketArchiveRepository;
    readonly marketRefreshState: TenantRecordRepository<unknown>;
    readonly marketRefreshRuns: TenantRecordRepository<unknown>;
    readonly marketRefreshLocks: TenantRecordRepository<unknown>;
  };
  readonly sourceReader?: PunSourceReader;
  readonly now?: string;
  readonly runId?: string;
  readonly trigger?: "CRON" | "MANUAL" | "TEST";
  readonly dryRun?: boolean;
}

const actor = "market-regulatory-auto-refresh";
const lockLeaseMs = 15 * 60 * 1000;
const errorText = (error: unknown): string => error instanceof Error ? error.message : "PUN_REFRESH_UNKNOWN_ERROR";
const validDate = (value: string): string => { if (!Number.isFinite(Date.parse(value))) throw new Error("PUN_REFRESH_TIMESTAMP_INVALID"); return new Date(value).toISOString(); };
const addDays = (value: string, days: number): string => new Date(Date.parse(value) + days * 86_400_000).toISOString();
const runIdFor = (tenantId: string, trigger: string, now: string): string => `pun-refresh_${createHash("sha256").update(`${tenantId}|${trigger}|${now}`, "utf8").digest("hex").slice(0, 40)}`;
const stateId = (tenantId: string): string => deterministicRecordId("market-refresh-state", tenantId, "pun-market-refresh");
const runRecordId = (runId: string, tenantId: string): string => deterministicRecordId("market-refresh-run", tenantId, runId);
const lockId = (tenantId: string): string => deterministicRecordId("market-refresh-lock", tenantId, "pun-market-refresh");

function monthKey(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
export function closedPunTargetMonths(now: string, count = MINIMUM_PUN_HISTORY_MONTHS): readonly string[] {
  const date = new Date(validDate(now));
  const firstClosed = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return Array.from({ length: count }, (_, index) => monthKey(new Date(Date.UTC(firstClosed.getUTCFullYear(), firstClosed.getUTCMonth() - index, 1))));
}

function complete(record: ElectricityMonthlyPunRecord): boolean {
  return record.vector === "EE" && record.index === "PUN" && record.f1 !== undefined && record.f2 !== undefined && record.f3 !== undefined && record.monthly !== undefined && [record.f1, record.f2, record.f3, record.monthly].every((rate) => rate.currency === "EUR" && rate.unit === "EUR_PER_MWH" && Number.isFinite(rate.value)) && record.effectiveFrom === `${record.month}-01` && record.effectiveTo !== null;
}
function canonicalMilli(value: number): number { return Math.round(value * 1000); }
function valuesEqual(left: ElectricityMonthlyPunRecord, right: ElectricityMonthlyPunRecord): boolean {
  if (left.month !== right.month || left.effectiveFrom !== right.effectiveFrom || left.effectiveTo !== right.effectiveTo) return false;
  return [left.monthly, right.monthly, left.f1, right.f1, left.f2, right.f2, left.f3, right.f3].every((rate) => rate !== undefined) && canonicalMilli(left.monthly!.value) === canonicalMilli(right.monthly!.value) && canonicalMilli(left.f1!.value) === canonicalMilli(right.f1!.value) && canonicalMilli(left.f2!.value) === canonicalMilli(right.f2!.value) && canonicalMilli(left.f3!.value) === canonicalMilli(right.f3!.value);
}
function officialHost(authority: "GME" | "ARERA"): (host: string) => boolean {
  return authority === "GME"
    ? (host) => host === "gme.mercatoelettrico.org"
    : (host) => host === "arera.it" || host === "www.arera.it";
}
function candidateComplete(candidate: PunSourceCandidate | undefined): candidate is PunSourceCandidate {
  if (!candidate || !complete(candidate.record)) return false;
  assertMarketRecord(candidate.record, candidate.record.tenantId);
  if (candidate.record.source.authority !== "GME" && candidate.record.source.authority !== "ARERA") throw new Error("PUN_SOURCE_AUTHORITY_INVALID");
  const host = new URL(candidate.record.source.url).hostname.toLowerCase();
  if (!officialHost(candidate.record.source.authority)(host)) throw new Error("PUN_SOURCE_DOMAIN_BLOCKED");
  return true;
}
function canonicalCandidate(bundle: PunSourceBundle, referenceMonth: string): PunSourceCandidate {
  const gme = candidateComplete(bundle.gme) && bundle.gme.record.month === referenceMonth ? bundle.gme : undefined;
  const arera = candidateComplete(bundle.arera) && bundle.arera.record.month === referenceMonth ? bundle.arera : undefined;
  if (gme && arera && !valuesEqual(gme.record, arera.record)) throw new Error("OFFICIAL_PUN_SOURCE_MISMATCH");
  if (gme) return gme;
  if (arera) return arera;
  throw new Error(bundle.gmeError ?? bundle.areraError ?? "PUN_MONTH_INCOMPLETE");
}
function nextVersion(records: readonly MarketArchiveRecord[]): number { return records.reduce((max, record) => Math.max(max, Number.parseInt(record.record.version, 10) || 0), 0) + 1; }
function pendingVersion(candidate: ElectricityMonthlyPunRecord, current: MarketArchiveRecord | undefined, all: readonly MarketArchiveRecord[]): ElectricityMonthlyPunRecord {
  if (!current) return { ...candidate, recordId: `gme-pun-${candidate.month}`, version: "1", parentVersionId: null, approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" } };
  const version = nextVersion(all.filter((record) => record.month === candidate.month));
  return { ...candidate, recordId: `gme-pun-${candidate.month}-v${version}`, version: String(version), parentVersionId: current.archiveId, approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_CORRECTION" } };
}
function initialState(tenantId: string): MarketRefreshState { return { tenantId, status: "NEVER_SUCCESSFUL", lastAttemptAt: null, lastSuccessfulAt: null, nextExpectedCheckAt: null, consecutiveFailures: 0, lastCheckedAtByMonth: {}, errors: [] }; }
function stale(lastSuccessfulAt: string | null, now: string): boolean { return lastSuccessfulAt === null || Date.parse(now) - Date.parse(lastSuccessfulAt) > PUN_REFRESH_STALE_DAYS * 86_400_000; }

async function acquireLease(input: MarketRefreshDependencies, tenantId: string, runId: string, now: string): Promise<{ acquired: boolean; version: number | undefined }> {
  const repository = input.repositories.marketRefreshLocks;
  const existing = await repository.get(tenantId, lockId(tenantId));
  if (existing && Date.parse((existing.payload as { expiresAt?: string }).expiresAt ?? "") > Date.parse(now)) return { acquired: false, version: existing.version };
  const payload = { tenantId, ownerRunId: runId, acquiredAt: now, expiresAt: new Date(Date.parse(now) + lockLeaseMs).toISOString() };
  try {
    if (existing) await repository.put({ tenantId, recordId: lockId(tenantId), payload, expectedVersion: existing.version, now });
    else await repository.append({ tenantId, recordId: lockId(tenantId), payload, now });
    return { acquired: true, version: (await repository.get(tenantId, lockId(tenantId)))?.version };
  } catch (error) {
    if (errorText(error).includes("CONFLICT") || errorText(error).includes("ALREADY_EXISTS")) return { acquired: false, version: undefined };
    throw error;
  }
}
async function releaseLease(input: MarketRefreshDependencies, tenantId: string, runId: string, now: string, version: number | undefined): Promise<void> {
  if (version === undefined) return;
  try { await input.repositories.marketRefreshLocks.put({ tenantId, recordId: lockId(tenantId), payload: { tenantId, ownerRunId: runId, acquiredAt: now, expiresAt: now }, expectedVersion: version, now }); } catch { /* another owner or a provider failure must not overwrite its lease */ }
}
async function persistRun(input: MarketRefreshDependencies, run: MarketRefreshRun): Promise<void> {
  const id = runRecordId(run.runId, run.tenantId);
  if (!(await input.repositories.marketRefreshRuns.get(run.tenantId, id))) await input.repositories.marketRefreshRuns.append({ tenantId: run.tenantId, recordId: id, payload: run, idempotencyKey: run.runId, now: run.finishedAt });
}

export async function runPunMarketRefresh(input: { readonly tenantId: string } & MarketRefreshDependencies): Promise<MarketRefreshSummary> {
  assertPunRefreshCoverage(CALCULATED_PUN_DOMAINS);
  const now = validDate(input.now ?? new Date().toISOString());
  const trigger = input.trigger ?? "MANUAL";
  const runId = input.runId ?? runIdFor(input.tenantId, trigger, now);
  const dryRun = input.dryRun === true;
  const targetMonths = closedPunTargetMonths(now);
  const reader = input.sourceReader ?? createOfficialPunSourceReader();
  let lease: { acquired: boolean; version: number | undefined } = { acquired: true, version: undefined };
  if (!dryRun) {
    lease = await acquireLease(input, input.tenantId, runId, now);
    if (!lease.acquired) return { runId, tenantId: input.tenantId, status: "ALREADY_RUNNING", dryRun: false, targetMonths, monthsChecked: 0, monthsComplete: 0, monthsUnchanged: 0, monthsCreated: 0, monthsCorrected: 0, monthsFailed: 0, errors: ["PUN_REFRESH_ALREADY_RUNNING"] };
  }
  let monthsComplete = 0; let monthsUnchanged = 0; let monthsCreated = 0; let monthsCorrected = 0; let monthsFailed = 0; const errors: string[] = [];
  try {
    for (const referenceMonth of targetMonths) {
      try {
        const bundle = await reader.load({ tenantId: input.tenantId, referenceMonth, retrievedAt: now });
        const candidate = canonicalCandidate(bundle, referenceMonth);
        const existing = await input.repositories.marketArchiveRepository.list(input.tenantId);
        const sameMonth = existing.filter((record) => record.month === referenceMonth && record.status === "APPROVED").sort(compareMarketVersions);
        const current = sameMonth[0];
        if (current && valuesEqual(current.record as ElectricityMonthlyPunRecord, candidate.record)) { monthsComplete += 1; monthsUnchanged += 1; continue; }
        monthsComplete += 1;
        if (!dryRun) {
          const pending = pendingVersion(candidate.record, current, existing);
          const created = await createMarketArchive(input.repositories.marketArchiveRepository, { tenantId: input.tenantId, record: pending, archiveId: pending.recordId, now, actor });
          await approveMarketArchive(input.repositories.marketArchiveRepository, input.tenantId, created.archiveId, actor, `pun-refresh-${runId}-${referenceMonth}-v${pending.version}`, now);
          monthsCreated += 1;
          if (current) monthsCorrected += 1;
        } else if (current) monthsCorrected += 1; else monthsCreated += 1;
      } catch (error) { monthsFailed += 1; errors.push(`${referenceMonth}:${errorText(error)}`); }
    }
  } finally {
    if (!dryRun) await releaseLease(input, input.tenantId, runId, now, lease.version);
  }
  const status: PunRefreshRunStatus = monthsFailed === 0 ? "SUCCESS" : monthsFailed === targetMonths.length ? "FAILED" : "PARTIAL_FAILURE";
  if (!dryRun) {
    const repository = input.repositories.marketRefreshState;
    const stored = await repository.get(input.tenantId, stateId(input.tenantId));
    const previous = (stored?.payload as MarketRefreshState | undefined) ?? initialState(input.tenantId);
    const lastSuccessfulAt = status === "SUCCESS" ? now : previous.lastSuccessfulAt;
    const checked = { ...previous.lastCheckedAtByMonth };
    for (const month of targetMonths) if (!errors.some((error) => error.startsWith(`${month}:`))) checked[month] = now;
    const currentState: MarketRefreshState = { tenantId: input.tenantId, status: status === "SUCCESS" ? "FRESH" : stale(lastSuccessfulAt, now) ? "STALE" : "FAILED_REVIEW_REQUIRED", lastAttemptAt: now, lastSuccessfulAt, nextExpectedCheckAt: addDays(now, 1), consecutiveFailures: status === "SUCCESS" ? 0 : previous.consecutiveFailures + 1, lastCheckedAtByMonth: checked, errors: stale(lastSuccessfulAt, now) ? ["PUN_REFRESH_STALE", ...errors] : errors };
    await repository.put({ tenantId: input.tenantId, recordId: stateId(input.tenantId), payload: currentState, expectedVersion: stored?.version, idempotencyKey: `state:${runId}`, now });
    const run: MarketRefreshRun = { runId, tenantId: input.tenantId, startedAt: now, finishedAt: new Date().toISOString(), status, trigger, targetMonths, monthsChecked: targetMonths.length, monthsComplete, monthsUnchanged, monthsCreated, monthsCorrected, monthsFailed, lastSuccessfulAt, consecutiveFailures: currentState.consecutiveFailures, errors };
    await persistRun(input, run);
  }
  return { runId, tenantId: input.tenantId, status, dryRun, targetMonths, monthsChecked: targetMonths.length, monthsComplete, monthsUnchanged, monthsCreated, monthsCorrected, monthsFailed, errors };
}

export function punRefreshStateIsStale(state: Pick<MarketRefreshState, "lastSuccessfulAt"> | null, now: string): boolean { return state === null || stale(state.lastSuccessfulAt, validDate(now)); }
