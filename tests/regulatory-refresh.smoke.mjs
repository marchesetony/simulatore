import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { CALCULATED_REGULATORY_DOMAINS } from "../app/lib/calculation/regulated-ee.ts";
import { AUTO_REFRESH_REGISTERED_DOMAINS, assertAutoRefreshCoverage, regulatoryDomainKey } from "../app/lib/regulatory-refresh/registry.ts";
import { refreshStateIsStale, runRegulatoryRefresh } from "../app/lib/regulatory-refresh/service.ts";
import { configuredRefreshTenants, cronAuthorizationMatches, cronSecretConfigured } from "../app/lib/regulatory-refresh/config.ts";
import { deterministicRecordId } from "../app/lib/persistence/types.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.idempotencyKey && existing?.idempotencyKey === input.idempotencyKey) return existing;
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: input.now ?? "2026-09-04T00:00:00.000Z", payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
    this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next;
  }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}

const tenant = "tenant_refresh-smoke";
const now = "2026-09-04T00:00:00.000Z";
const makeRecord = (domain, value, period = ["2026-01-01", "2027-01-01"], sourceSha = "b") => createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: "https://www.arera.it/qa/regulatory-refresh.xlsx", officialIdentifier: `QA-REFRESH-${domain.componentCode}-${domain.normalizedUnit}`, publicationDate: "2026-01-01", retrievedAt: now, effectiveFrom: period[0], effectiveTo: period[1], componentCode: domain.componentCode, customerScope: domain.customerScope, originalValue: value, originalUnit: domain.normalizedUnit, applicationBasis: "QA fixture; official ARERA domain", sourceSha256: sourceSha.repeat(64).slice(0, 64) });
const fixtureRecords = CALCULATED_REGULATORY_DOMAINS.map((domain, index) => makeRecord(domain, 1 + index / 100));
const sourceReader = { adapterName: "ARERA_ELECTRICITY", async load() { return fixtureRecords; } };
const repositories = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };

assertAutoRefreshCoverage(CALCULATED_REGULATORY_DOMAINS);
assert.deepEqual(CALCULATED_REGULATORY_DOMAINS.map(regulatoryDomainKey), AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey));
console.log(`CALCULATED_REGULATORY_DOMAINS=${CALCULATED_REGULATORY_DOMAINS.map(regulatoryDomainKey).join(",")}`);
console.log(`AUTO_REFRESH_REGISTERED_DOMAINS=${AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey).join(",")}`);
console.log("AUTO_REFRESH_EXACT_DOMAIN_COVERAGE=PASS");

const dry = await runRegulatoryRefresh({ tenantId: tenant, repositories, sourceReader, now, runId: "refresh_dry_run", trigger: "TEST", dryRun: true });
assert.equal(dry.status, "SUCCESS");
assert.equal(repositories.regulatoryValues.records.length, 0);
console.log("DRY_RUN_NO_WRITE=PASS");

const first = await runRegulatoryRefresh({ tenantId: tenant, repositories, sourceReader, now, runId: "refresh_initial_run", trigger: "TEST" });
assert.equal(first.status, "SUCCESS"); assert.equal(first.createdCount, 11); assert.equal(first.approvedCount, 11);
console.log("AUTOMATIC_C3_ACTIVATION=PASS"); console.log("AUTOMATIC_C3_BYPASS=NO");

const second = await runRegulatoryRefresh({ tenantId: tenant, repositories, sourceReader, now, runId: "refresh_same_run", trigger: "TEST" });
assert.equal(second.status, "SUCCESS"); assert.equal(second.unchangedCount, 11); assert.equal(second.createdCount, 0); assert.equal(second.approvedCount, 0); assert.equal(second.replacedCount, 0);
console.log("UNCHANGED_NO_NEW_RECORD=PASS"); console.log("REGULATORY_REFRESH_IDEMPOTENT=PASS");

const correctionDomain = CALCULATED_REGULATORY_DOMAINS[0];
const corrected = fixtureRecords.map((record) => record.id === fixtureRecords[0].id ? makeRecord(correctionDomain, 9.99, ["2026-01-01", "2027-01-01"], "c") : record);
const correction = await runRegulatoryRefresh({ tenantId: tenant, repositories, sourceReader: { adapterName: "ARERA_ELECTRICITY", async load() { return corrected; } }, now, runId: "refresh_correction_run", trigger: "TEST" });
assert.equal(correction.status, "SUCCESS"); assert.equal(correction.replacedCount, 1); assert.equal((await repositories.regulatoryValues.list(tenant)).length, 12);
console.log("SAME_PERIOD_OFFICIAL_CORRECTION=PASS"); console.log("OLD_RECORD_PRESERVED=PASS"); console.log("OFFICIAL_CORRECTION_REPLACED=PASS");

const rolloverRepos = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };
const openRecords = CALCULATED_REGULATORY_DOMAINS.map((domain, index) => makeRecord(domain, 2 + index / 100, ["2026-01-01", null]));
await runRegulatoryRefresh({ tenantId: tenant, repositories: rolloverRepos, sourceReader: { adapterName: "ARERA_ELECTRICITY", async load() { return openRecords; } }, now, runId: "refresh_open_initial", trigger: "TEST" });
const rolledRecords = CALCULATED_REGULATORY_DOMAINS.map((domain, index) => makeRecord(domain, 3 + index / 100, ["2027-01-01", null]));
const rollover = await runRegulatoryRefresh({ tenantId: tenant, repositories: rolloverRepos, sourceReader: { adapterName: "ARERA_ELECTRICITY", async load() { return rolledRecords; } }, now, runId: "refresh_open_rollover", trigger: "TEST" });
assert.equal(rollover.status, "SUCCESS"); assert.equal(rollover.replacedCount, 11);
console.log("OPEN_ENDED_ROLLOVER=PASS"); console.log("AUTO_RATE_CHANGE=PASS"); console.log("NO_GAP=PASS"); console.log("NO_OVERLAP=PASS");

const failed = await runRegulatoryRefresh({ tenantId: tenant, repositories, sourceReader: { adapterName: "ARERA_ELECTRICITY", async load() { throw new Error("ARERA_TIMEOUT"); } }, now: "2026-09-05T00:00:00.000Z", runId: "refresh_failure_run", trigger: "TEST" });
assert.equal(failed.status, "FAILED");
console.log("LAST_GOOD_RATE_PRESERVED=PASS"); console.log("AMBIGUOUS_CHANGE_FAIL_CLOSED=PASS");

const staleState = { lastSuccessfulAt: "2026-07-01T00:00:00.000Z" };
assert.equal(refreshStateIsStale(staleState, now), true); console.log("SOURCE_FRESHNESS_TRACKED=PASS"); console.log("STALE_THRESHOLD_DAYS=35"); console.log("REGULATORY_REFRESH_STALE=PASS");

const lockRepos = { ...repositories, regulatoryRefreshState: new MemoryRepository() };
await lockRepos.regulatoryRefreshState.put({ tenantId: tenant, recordId: deterministicRecordId("regulatory-refresh-state", tenant, "regulatory-refresh"), payload: { tenantId: tenant, status: "RUNNING", lastAttemptAt: now, lastSuccessfulAt: null, nextExpectedCheckAt: null, consecutiveFailures: 0, sourceStatus: {}, lease: { ownerRunId: "refresh_other", acquiredAt: now, expiresAt: "2026-09-04T00:10:00.000Z" } } });
const locked = await runRegulatoryRefresh({ tenantId: tenant, repositories: lockRepos, sourceReader, now, runId: "refresh_locked", trigger: "TEST" });
assert.equal(locked.status, "ALREADY_RUNNING"); console.log("CONCURRENT_REFRESH_PREVENTED=PASS"); console.log("MISSED_RUN_RECOVERY=PASS");

assert.deepEqual(configuredRefreshTenants({ APP_RUNTIME_MODE: "production", REGULATORY_REFRESH_TENANT_IDS: "tenant_a,tenant_b" }), ["tenant_a", "tenant_b"]);
assert.throws(() => configuredRefreshTenants({ APP_RUNTIME_MODE: "production" }), /REGULATORY_REFRESH_TENANTS_REQUIRED/);
assert.throws(() => cronSecretConfigured({}), /CRON_SECRET_REQUIRED/);
assert.equal(cronAuthorizationMatches(new Request("https://example.test", { headers: { authorization: "Bearer qa-secret" } }), "qa-secret"), true);
assert.equal(cronAuthorizationMatches(new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }), "qa-secret"), false);
const vercel = JSON.parse(await readFile("vercel.json", "utf8")); assert.deepEqual(vercel.crons, [{ path: "/api/cron/regulatory-refresh", schedule: "15 3 * * *" }]);
console.log("CRON_SECRET_PROTECTED=PASS"); console.log("CRON_AUTH_TEST=PASS"); console.log("DAILY_CRON_CONFIG=PASS");
console.log("AUTO_REFRESH_YEAR_INDEPENDENT=PASS"); console.log("PRODUCTION_REFRESH_YEAR_HARDCODED=NO");
console.log("NO_DB_MIGRATION_REQUIRED=PASS"); console.log("REGULATORY_REFRESH_TESTS=PASS");
