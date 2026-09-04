import { createHash } from "node:crypto";
import type { RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createRegulatoryValue, isAllowedAreraUrl } from "../foundation/arera-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateChecksum } from "../foundation/regulatory-validation.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { RegulatoryApprovalDomainService, regulatoryApprovalDomainId } from "../regulatory-approval-domain.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveRegulatoryTimeline } from "../calculation/regulatory-timeline.ts";
import type { RuntimeRepositories } from "../persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createAreraRegulatorySourceReader, assertReaderDomain, type RegulatorySourceReader } from "./arera.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { AUTO_REFRESH_REGISTERED_DOMAINS, CALCULATED_REGULATORY_DOMAINS, REGULATORY_REFRESH_STALE_DAYS, regulatoryDomainKey, type RegulatoryRefreshDomain } from "./registry.ts";

export type RefreshRunStatus = "SUCCESS" | "PARTIAL_FAILURE" | "FAILED" | "ALREADY_RUNNING";
export type RefreshSourceStatus = "FRESH" | "STALE" | "FAILED_REVIEW_REQUIRED" | "NEVER_SUCCESSFUL" | "RUNNING";

export interface RegulatoryRefreshState {
  readonly tenantId: string;
  readonly status: RefreshSourceStatus;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessfulAt: string | null;
  readonly nextExpectedCheckAt: string | null;
  readonly consecutiveFailures: number;
  readonly sourceStatus: Readonly<Record<string, string>>;
  readonly errors: readonly string[];
  readonly lease?: { readonly ownerRunId: string; readonly acquiredAt: string; readonly expiresAt: string } | null;
}

export interface RegulatoryRefreshRun {
  readonly runId: string;
  readonly tenantId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: RefreshRunStatus;
  readonly trigger: "CRON" | "MANUAL" | "TEST";
  readonly sourceChecks: readonly { readonly domain: string; readonly status: "PASS" | "FAIL"; readonly sourceReference?: string; readonly sourceSha256?: string; readonly error?: string }[];
  readonly domainsChecked: readonly string[];
  readonly unchangedCount: number;
  readonly createdCount: number;
  readonly approvedCount: number;
  readonly replacedCount: number;
  readonly failedCount: number;
  readonly lastSuccessfulAt: string | null;
  readonly errors: readonly string[];
}

export interface RegulatoryRefreshSummary {
  readonly runId: string;
  readonly tenantId: string;
  readonly status: RefreshRunStatus;
  readonly dryRun: boolean;
  readonly unchangedCount: number;
  readonly createdCount: number;
  readonly approvedCount: number;
  readonly replacedCount: number;
  readonly failedCount: number;
  readonly errors: readonly string[];
  readonly sourceChecks: RegulatoryRefreshRun["sourceChecks"];
}

export interface RegulatoryRefreshDependencies {
  readonly repositories: Pick<RuntimeRepositories, "regulatoryValues" | "approvalDomains" | "auditEvents" | "regulatoryRefreshState" | "regulatoryRefreshRuns">;
  readonly sourceReader?: RegulatorySourceReader;
  readonly now?: string;
  readonly runId?: string;
  readonly trigger?: "CRON" | "MANUAL" | "TEST";
  readonly dryRun?: boolean;
}

const actor = "user_regulatory-auto-refresh";
const validDate = (value: string): string => { if (!Number.isFinite(Date.parse(value))) throw new Error("REGULATORY_REFRESH_TIMESTAMP_INVALID"); return new Date(value).toISOString(); };
const addDays = (value: string, days: number): string => new Date(Date.parse(value) + days * 86_400_000).toISOString();
const runIdFor = (tenantId: string, trigger: string, now: string): string => `refresh_${createHash("sha256").update(`${tenantId}|${trigger}|${now}`, "utf8").digest("hex").slice(0, 40)}`;
const errorText = (error: unknown): string => error instanceof Error ? error.message : "REGULATORY_REFRESH_UNKNOWN_ERROR";

function initialState(tenantId: string): RegulatoryRefreshState {
  return { tenantId, status: "NEVER_SUCCESSFUL", lastAttemptAt: null, lastSuccessfulAt: null, nextExpectedCheckAt: null, consecutiveFailures: 0, sourceStatus: {}, errors: [], lease: null };
}

function stateId(tenantId: string): string { return deterministicRecordId("regulatory-refresh-state", tenantId, "regulatory-refresh"); }
function runRecordId(runId: string): string { return `regulatory-refresh-run_${runId.slice(8)}`; }
function stale(lastSuccessfulAt: string | null, now: string): boolean { return lastSuccessfulAt === null || Date.parse(now) - Date.parse(lastSuccessfulAt) > REGULATORY_REFRESH_STALE_DAYS * 86_400_000; }

async function acquireLease(dependencies: RegulatoryRefreshDependencies, tenantId: string, runId: string, now: string): Promise<{ acquired: boolean; record: Awaited<ReturnType<RuntimeRepositories["regulatoryRefreshState"]["get"]>> }> {
  const repository = dependencies.repositories.regulatoryRefreshState;
  const existing = await repository.get(tenantId, stateId(tenantId));
  const current = existing?.payload as RegulatoryRefreshState | undefined;
  if (current?.lease && Date.parse(current.lease.expiresAt) > Date.parse(now) && current.lease.ownerRunId !== runId) return { acquired: false, record: existing };
  const payload: RegulatoryRefreshState = { ...(current ?? initialState(tenantId)), status: "RUNNING", lastAttemptAt: now, lease: { ownerRunId: runId, acquiredAt: now, expiresAt: addDays(now, 15 / (24 * 60)) } };
  try {
    const saved = await repository.put({ tenantId, recordId: stateId(tenantId), payload, expectedVersion: existing?.version, idempotencyKey: `lease:${runId}`, now });
    return { acquired: true, record: saved };
  } catch (error) {
    if (errorText(error).includes("CONFLICT") || errorText(error).includes("ALREADY_EXISTS")) return { acquired: false, record: await repository.get(tenantId, stateId(tenantId)) };
    throw error;
  }
}

function assertCandidate(domain: RegulatoryRefreshDomain, candidate: RegulatoryValueRecord, tenantId: string): void {
  if (candidate.tenantId !== tenantId || candidate.componentCode !== domain.componentCode || candidate.customerScope !== domain.customerScope || candidate.normalizedUnit !== domain.normalizedUnit) throw new Error(`REGULATORY_REFRESH_DOMAIN_MISMATCH:${regulatoryDomainKey(domain)}`);
  if (!isAllowedAreraUrl(candidate.sourceReference)) throw new Error("OFFICIAL_SOURCE_ALLOWLIST_FAILED");
  if (!candidate.sourceSha256 || !/^[a-f0-9]{64}$/i.test(candidate.sourceSha256)) throw new Error("SOURCE_SHA256_INVALID");
  validateChecksum(candidate);
  const from = Date.parse(candidate.effectiveFrom); const to = candidate.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(candidate.effectiveTo);
  if (!Number.isFinite(from) || from >= to) throw new Error("EFFECTIVE_INTERVAL_INVALID");
}

function nextMonthStart(now: string): string {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

async function verifyTimeline(domain: RegulatoryRefreshDomain, candidate: RegulatoryValueRecord, dependencies: RegulatoryRefreshDependencies, tenantId: string, now: string): Promise<void> {
  const periodStart = candidate.effectiveFrom;
  const periodEnd = candidate.effectiveTo ?? nextMonthStart(now);
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) return;
  const bridge = new ProductionRegulatoryPersistenceBridge(dependencies.repositories.regulatoryValues, dependencies.repositories.approvalDomains);
  await resolveRegulatoryTimeline(bridge, { tenantId, componentCode: domain.componentCode, customerScope: domain.customerScope, normalizedUnit: domain.normalizedUnit, periodStart, periodEnd });
}

function equivalent(left: RegulatoryValueRecord, right: RegulatoryValueRecord): boolean {
  return left.componentCode === right.componentCode && left.customerScope === right.customerScope && left.normalizedUnit === right.normalizedUnit && left.effectiveFrom === right.effectiveFrom && left.effectiveTo === right.effectiveTo && left.normalizedValue === right.normalizedValue && left.sourceSha256 === right.sourceSha256;
}

function versionedRecord(record: RegulatoryValueRecord, suffix: string, extra: { readonly effectiveTo?: string | null; readonly carriedForwardFrom?: string; readonly confirmationSource?: string }): RegulatoryValueRecord {
  return createRegulatoryValue({ tenantId: record.tenantId, sourceType: record.sourceType, sourceReference: record.sourceReference, officialIdentifier: `${record.officialIdentifier}:${suffix}`, publicationDate: record.publicationDate, retrievedAt: record.retrievedAt, effectiveFrom: record.effectiveFrom, effectiveTo: extra.effectiveTo === undefined ? record.effectiveTo : extra.effectiveTo, componentCode: record.componentCode, customerScope: record.customerScope, originalValue: record.originalValue, originalUnit: record.originalUnit, applicationBasis: record.applicationBasis, sourceSha256: record.sourceSha256, conversionProvenance: record.conversionProvenance, carriedForwardFrom: extra.carriedForwardFrom ?? record.carriedForwardFrom, confirmationSource: extra.confirmationSource ?? record.confirmationSource, authority: record.authority, publishedBy: record.publishedBy === "TERNA" ? "TERNA" : record.publishedBy === undefined ? undefined : "ARERA", calculatedBy: record.calculatedBy === "TERNA" ? "TERNA" : record.calculatedBy === undefined ? undefined : "ARERA", officialName: record.officialName, contractPassThroughRequired: record.contractPassThroughRequired, referenceDomain: record.referenceDomain });
}

async function saveIfMissing(repository: RuntimeRepositories["regulatoryValues"], tenantId: string, record: RegulatoryValueRecord, now: string): Promise<RegulatoryValueRecord> {
  const existing = await repository.get(tenantId, record.id);
  if (existing) return existing.payload;
  return (await repository.put({ tenantId, recordId: record.id, payload: record, idempotencyKey: `refresh-record:${record.id}`, now })).payload;
}

async function refreshDomain(domain: RegulatoryRefreshDomain, candidate: RegulatoryValueRecord, dependencies: RegulatoryRefreshDependencies, tenantId: string, runId: string, now: string): Promise<{ unchanged: number; created: number; approved: number; replaced: number }> {
  assertCandidate(domain, candidate, tenantId);
  const values = await dependencies.repositories.regulatoryValues.list(tenantId);
  const same = values.find((stored) => equivalent(stored.payload, candidate));
  const approval = new RegulatoryApprovalDomainService({ regulatoryValues: dependencies.repositories.regulatoryValues, approvalDomains: dependencies.repositories.approvalDomains, auditEvents: dependencies.repositories.auditEvents });
  const evidenceReference = candidate.sourceReference;
  const correlationId = `regulatory-refresh:${runId}`;
  const key = (action: string, target: string): string => `refresh:${runId}:${regulatoryDomainKey(domain)}:${action}:${target}`.slice(0, 160);
  if (same) {
    await approval.approveRegulatoryValue({ tenantId, targetRecordId: same.payload.id, principalId: actor, role: "ADMIN", correlationId, idempotencyKey: key("approve", same.payload.id), evidenceReference });
    return { unchanged: 1, created: 0, approved: 0, replaced: 0 };
  }
  const samePeriod = values.find((stored) => stored.payload.componentCode === domain.componentCode && stored.payload.customerScope === domain.customerScope && stored.payload.normalizedUnit === domain.normalizedUnit && stored.payload.effectiveFrom === candidate.effectiveFrom && stored.payload.effectiveTo === candidate.effectiveTo);
  const approvedDomain = await dependencies.repositories.approvalDomains.get(tenantId, regulatoryApprovalDomainId(tenantId, regulatoryDomainKey(domain)));
  const effective = approvedDomain?.payload.effectiveApprovals ?? [];
  const approvedSamePeriod = samePeriod && effective.find((entry) => entry.targetRecordId === samePeriod.payload.id && entry.targetRecordChecksum === samePeriod.payload.checksum);
  let next = candidate;
  if (samePeriod && approvedSamePeriod) next = versionedRecord(candidate, `correction-${candidate.sourceSha256.slice(0, 16)}`, {});
  const openEnded = values.filter((stored) => stored.payload.componentCode === domain.componentCode && stored.payload.customerScope === domain.customerScope && stored.payload.normalizedUnit === domain.normalizedUnit && stored.payload.effectiveTo === null && Date.parse(stored.payload.effectiveFrom) < Date.parse(candidate.effectiveFrom)).sort((a, b) => Date.parse(b.payload.effectiveFrom) - Date.parse(a.payload.effectiveFrom))[0];
  let replaced = 0;
  if (openEnded) {
    const openApproved = effective.find((entry) => entry.targetRecordId === openEnded.payload.id && entry.targetRecordChecksum === openEnded.payload.checksum);
    if (!openApproved) throw new Error("REGULATORY_OPEN_ENDED_ROLLOVER_NOT_APPROVED");
    const bounded = versionedRecord(openEnded.payload, `carry-forward-${candidate.effectiveFrom}`, { effectiveTo: candidate.effectiveFrom, carriedForwardFrom: openEnded.payload.id, confirmationSource: candidate.sourceReference });
    await saveIfMissing(dependencies.repositories.regulatoryValues, tenantId, bounded, now);
    await approval.replaceRegulatoryValue({ tenantId, oldTargetRecordId: openEnded.payload.id, newTargetRecordId: bounded.id, principalId: actor, role: "ADMIN", correlationId, idempotencyKey: key("replace-open", bounded.id), evidenceReference });
    replaced += 1;
  }
  await saveIfMissing(dependencies.repositories.regulatoryValues, tenantId, next, now);
  const result = approvedSamePeriod
    ? await approval.replaceRegulatoryValue({ tenantId, oldTargetRecordId: samePeriod!.payload.id, newTargetRecordId: next.id, principalId: actor, role: "ADMIN", correlationId, idempotencyKey: key("replace-correction", next.id), evidenceReference })
    : await approval.approveRegulatoryValue({ tenantId, targetRecordId: next.id, principalId: actor, role: "ADMIN", correlationId, idempotencyKey: key("approve", next.id), evidenceReference });
  return { unchanged: 0, created: samePeriod && next.id === samePeriod.payload.id ? 0 : 1, approved: result.decision === "APPROVE" && !result.idempotent ? 1 : 0, replaced: replaced + (result.decision === "REPLACE" && !result.idempotent ? 1 : 0) };
}

async function persistRun(dependencies: RegulatoryRefreshDependencies, run: RegulatoryRefreshRun): Promise<void> {
  const existing = await dependencies.repositories.regulatoryRefreshRuns.get(run.tenantId, runRecordId(run.runId));
  if (!existing) await dependencies.repositories.regulatoryRefreshRuns.append({ tenantId: run.tenantId, recordId: runRecordId(run.runId), payload: run, idempotencyKey: run.runId, now: run.finishedAt });
}

export async function runRegulatoryRefresh(input: { readonly tenantId: string } & RegulatoryRefreshDependencies): Promise<RegulatoryRefreshSummary> {
  const now = validDate(input.now ?? new Date().toISOString());
  const trigger = input.trigger ?? "MANUAL";
  const runId = input.runId ?? runIdFor(input.tenantId, trigger, now);
  const dryRun = input.dryRun === true;
  const reader = input.sourceReader ?? createAreraRegulatorySourceReader();
  if (!dryRun) {
    const lease = await acquireLease(input, input.tenantId, runId, now);
    if (!lease.acquired) return { runId, tenantId: input.tenantId, status: "ALREADY_RUNNING", dryRun: false, unchangedCount: 0, createdCount: 0, approvedCount: 0, replacedCount: 0, failedCount: 0, errors: ["REGULATORY_REFRESH_ALREADY_RUNNING"], sourceChecks: [] };
  }
  const checks: Array<RegulatoryRefreshRun["sourceChecks"][number]> = [];
  const errors: string[] = [];
  let unchangedCount = 0; let createdCount = 0; let approvedCount = 0; let replacedCount = 0; let failedCount = 0;
  let candidates: readonly RegulatoryValueRecord[] = [];
  try { candidates = await reader.load({ tenantId: input.tenantId, retrievedAt: now }); } catch (error) { errors.push(errorText(error)); }
  for (const domain of CALCULATED_REGULATORY_DOMAINS) {
    try {
      const candidate = assertReaderDomain(domain, candidates);
      checks.push({ domain: regulatoryDomainKey(domain), status: "PASS", sourceReference: candidate.sourceReference, sourceSha256: candidate.sourceSha256 });
      if (!dryRun) {
        const result = await refreshDomain(domain, candidate, input, input.tenantId, runId, now);
        await verifyTimeline(domain, candidate, input, input.tenantId, now);
        unchangedCount += result.unchanged; createdCount += result.created; approvedCount += result.approved; replacedCount += result.replaced;
      }
    } catch (error) { failedCount += 1; const message = errorText(error); errors.push(`${regulatoryDomainKey(domain)}:${message}`); checks.push({ domain: regulatoryDomainKey(domain), status: "FAIL", error: message }); }
  }
  const status: RefreshRunStatus = failedCount === 0 && errors.length === 0 ? "SUCCESS" : failedCount === CALCULATED_REGULATORY_DOMAINS.length ? "FAILED" : "PARTIAL_FAILURE";
  if (!dryRun) {
    const stateRepository = input.repositories.regulatoryRefreshState;
    const stored = await stateRepository.get(input.tenantId, stateId(input.tenantId));
    const previous = (stored?.payload as RegulatoryRefreshState | undefined) ?? initialState(input.tenantId);
    const lastSuccessfulAt = status === "SUCCESS" ? now : previous.lastSuccessfulAt;
    const isStale = stale(lastSuccessfulAt, now);
    const state: RegulatoryRefreshState = { tenantId: input.tenantId, status: status === "SUCCESS" ? "FRESH" : isStale ? "STALE" : "FAILED_REVIEW_REQUIRED", lastAttemptAt: now, lastSuccessfulAt, nextExpectedCheckAt: addDays(now, 1), consecutiveFailures: status === "SUCCESS" ? 0 : previous.consecutiveFailures + 1, sourceStatus: Object.fromEntries(checks.map((check) => [check.domain, check.status])), errors: isStale ? ["REGULATORY_REFRESH_STALE", ...errors] : errors, lease: null };
    await stateRepository.put({ tenantId: input.tenantId, recordId: stateId(input.tenantId), payload: state, expectedVersion: stored?.version, idempotencyKey: `state:${runId}`, now });
    const run: RegulatoryRefreshRun = { runId, tenantId: input.tenantId, startedAt: now, finishedAt: new Date().toISOString(), status, trigger, sourceChecks: checks, domainsChecked: [...AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey)], unchangedCount, createdCount, approvedCount, replacedCount, failedCount, lastSuccessfulAt, errors };
    await persistRun(input, run);
  }
  return { runId, tenantId: input.tenantId, status, dryRun, unchangedCount, createdCount, approvedCount, replacedCount, failedCount, errors, sourceChecks: checks };
}

export function refreshStateIsStale(state: Pick<RegulatoryRefreshState, "lastSuccessfulAt"> | null, now: string): boolean { return state === null || stale(state.lastSuccessfulAt, validDate(now)); }
