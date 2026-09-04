import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readRuntimeConfig } from "../app/lib/auth/config.ts";
import { clearProductionSessionAdapter, registerProductionSessionAdapter, resolvePrincipal } from "../app/lib/auth/adapter.ts";
import { authorizePrincipal, requireAuthorization } from "../app/lib/auth/authorization.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { clearProductionStorageAdapter, registerProductionStorageAdapter } from "../app/lib/persistence/adapter.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { AuditLogger, clearAuditRepository, registerAuditRepository } from "../app/lib/persistence/audit.ts";
import { planMigration } from "../app/lib/persistence/migration.ts";
import { readinessReport } from "../app/lib/readiness.ts";

const original = { ...process.env };
const restore = () => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; for (const [key, value] of Object.entries(original)) process.env[key] = value; };
const localEnv = (role = "ADMIN") => ({ APP_RUNTIME_MODE: "local", FOUNDATION_LOCAL_DEV: "true", AUTH_ADAPTER: "local", PERSISTENCE_ADAPTER: "filesystem", FOUNDATION_LOCAL_TENANT_ID: "tenant_auth-smoke", FOUNDATION_LOCAL_ROLE: role });
const auditRoot = await mkdtemp(path.join(os.tmpdir(), "phase6-auth-audit-"));
const isolatedAudit = new LocalFilesystemAdapter(auditRoot).collection("audit-events");
registerAuditRepository(isolatedAudit);

try {
  assert.equal(readRuntimeConfig(localEnv()).valid, true);
  assert.equal(readRuntimeConfig({ ...localEnv(), FOUNDATION_LOCAL_DEV: "1" }).valid, false);
  assert.equal(readRuntimeConfig({ ...localEnv(), APP_RUNTIME_MODE: "staging" }).valid, false);
  assert.equal(readRuntimeConfig({ ...localEnv(), APP_RUNTIME_MODE: "production", FOUNDATION_LOCAL_DEV: "true" }).valid, false);
  assert.equal(readRuntimeConfig({ APP_RUNTIME_MODE: "production", FOUNDATION_LOCAL_DEV: "false", AUTH_ADAPTER: "local", PERSISTENCE_ADAPTER: "provider" }).valid, false);
  assert.equal(readRuntimeConfig({ APP_RUNTIME_MODE: "local", FOUNDATION_LOCAL_DEV: "false", AUTH_ADAPTER: "local", PERSISTENCE_ADAPTER: "filesystem" }).valid, false);

  Object.assign(process.env, localEnv());
  const request = new Request("http://localhost/api/test", { method: "GET", headers: { "x-foundation-tenant-id": "tenant_spoofed" } });
  const principal = await resolvePrincipal(request);
  assert.deepEqual({ userId: principal.userId, tenantId: principal.tenantId, role: principal.role, source: principal.source }, { userId: "user_local-dev", tenantId: "tenant_auth-smoke", role: "ADMIN", source: "LOCAL_SYNTHETIC" });
  const localAuthEvents = await isolatedAudit.list("tenant_auth-smoke");
  assert.equal(localAuthEvents.length, 1);
  assert.equal(localAuthEvents[0].payload.action, "AUTHENTICATION_SUCCESS");
  assert.equal(localAuthEvents[0].payload.outcome, "ALLOWED");
  assert.equal(localAuthEvents[0].payload.tenantId, "tenant_auth-smoke");
  assert.equal(localAuthEvents[0].payload.principalId, "user_local-dev");
  assert.equal(localAuthEvents[0].payload.role, "ADMIN");
  assert.equal(localAuthEvents[0].payload.metadata.source, "LOCAL_SYNTHETIC");
  assert.equal(localAuthEvents.filter((record) => record.payload.action === "AUTHENTICATION_SUCCESS").length, 1);
  assert.equal(localAuthEvents[0].payload.sessionId, undefined);
  assert.equal(localAuthEvents[0].payload.metadata.sessionId, undefined);
  assert.equal(authorizePrincipal(principal, "ADMIN", "tenant_other").reason, "TENANT_MISMATCH");
  await assert.rejects(() => requireAuthorization(principal, "ADMIN", "tenant_other"), /TENANT_MISMATCH/);
  const viewer = { ...principal, role: "VIEWER" };
  await assert.rejects(() => requireAuthorization(viewer, "WRITE"), /AUTHORIZATION_DENIED/);
  const denialEvents = await isolatedAudit.list("tenant_auth-smoke");
  assert.equal(denialEvents.length, 3);
  const denials = denialEvents.filter((record) => record.payload.action === "AUTHORIZATION_DENIAL");
  assert.equal(denials.length, 2);
  const tenantDenial = denials.find((record) => record.payload.metadata.reason === "TENANT_MISMATCH");
  const roleDenial = denials.find((record) => record.payload.metadata.reason === "ROLE_INSUFFICIENT");
  assert.ok(tenantDenial);
  assert.ok(roleDenial);
  for (const denial of denials) {
    assert.equal(denial.payload.tenantId, "tenant_auth-smoke");
    assert.equal(denial.payload.principalId, "user_local-dev");
    assert.ok(["ADMIN", "ANALYST", "VIEWER"].includes(denial.payload.role));
    assert.equal(denial.payload.outcome, "DENIED");
    assert.equal(denial.payload.resourceType, "AUTHORIZATION");
    assert.equal(denial.payload.metadata.sessionId, undefined);
  }
  assert.equal(tenantDenial.payload.role, "ADMIN");
  assert.equal(tenantDenial.payload.metadata.access, "ADMIN");
  assert.equal(roleDenial.payload.role, "VIEWER");
  assert.equal(roleDenial.payload.metadata.access, "WRITE");
  assert.equal(authorizePrincipal({ ...principal, role: "ADMIN" }, "ADMIN").allowed, true);
  assert.equal(authorizePrincipal({ ...principal, role: "ANALYST" }, "WRITE").allowed, true);
  assert.equal(authorizePrincipal({ ...principal, role: "VIEWER" }, "READ").allowed, true);
  assert.equal(authorizePrincipal({ ...principal, role: "VIEWER" }, "WRITE").allowed, false);
  assert.equal(authorizePrincipal(principal, "READ", "tenant_other").allowed, false);
  assert.equal(authorizePrincipal(principal, "WRITE", "tenant_other").allowed, false);

  Object.assign(process.env, { APP_RUNTIME_MODE: "production", FOUNDATION_LOCAL_DEV: "false", AUTH_ADAPTER: "server-session", PERSISTENCE_ADAPTER: "provider" });
  clearProductionSessionAdapter();
  await assert.rejects(() => resolvePrincipal(request), /AUTH_ADAPTER_UNAVAILABLE/);
  const unauthenticatedEvents = await isolatedAudit.listUnscoped();
  assert.equal(unauthenticatedEvents.length, 1);
  assert.equal(unauthenticatedEvents[0].payload.action, "AUTHENTICATION_FAILURE");
  assert.equal(unauthenticatedEvents[0].payload.outcome, "FAILED");
  assert.equal(unauthenticatedEvents[0].payload.tenantId, undefined);
  assert.equal(unauthenticatedEvents[0].payload.principalId, undefined);
  assert.equal(unauthenticatedEvents[0].payload.role, undefined);
  assert.equal(unauthenticatedEvents[0].payload.metadata.failureCategory, "AUTH_ADAPTER_UNAVAILABLE");
  assert.ok(["AUTH_CONFIGURATION_INVALID", "AUTH_ADAPTER_UNAVAILABLE", "AUTHENTICATION_REQUIRED", "AUTHENTICATION_EXPIRED", "AUTHENTICATION_INVALID"].includes(unauthenticatedEvents[0].payload.metadata.failureCategory));
  const incomplete = readinessReport(new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(incomplete.readiness, false);
  assert.equal(incomplete.authAdapterConfigured, false);
  assert.equal(incomplete.persistenceAdapterConfigured, false);
  registerProductionSessionAdapter({ resolve: () => ({ userId: "user_provider", tenantId: "tenant_auth-smoke", role: "ANALYST", sessionId: "session_provider", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "VERIFIED_SESSION" }) });
  const missingPersistence = readinessReport(new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(missingPersistence.authAdapterConfigured, true);
  assert.equal(missingPersistence.persistenceAdapterConfigured, false);
  assert.equal(missingPersistence.readiness, false);
  clearProductionSessionAdapter();

  const root = await mkdtemp(path.join(os.tmpdir(), "phase6-persistence-"));
  try {
    const adapter = new LocalFilesystemAdapter(root);
    assert.throws(() => registerProductionSessionAdapter({}), /AUTH_ADAPTER_UNAVAILABLE/);
    assert.throws(() => registerProductionStorageAdapter({ kind: "provider" }), /PERSISTENCE_ADAPTER_INVALID/);
    registerProductionSessionAdapter({ resolve: () => ({ userId: "user_provider", tenantId: "tenant_auth-smoke", role: "ANALYST", sessionId: "session_provider", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "VERIFIED_SESSION" }) });
    const providerRecords = { billIngestionMetadata: adapter.collection("provider-bill-ingestion"), normalizedBillSnapshots: adapter.collection("provider-bill-snapshots"), cteArchives: adapter.collection("provider-cte"), marketDataArchives: adapter.collection("provider-market"), regulatoryValues: adapter.collection("provider-regulatory-values"), approvalDomains: adapter.collection("provider-approval-domains"), calculationResults: adapter.collection("provider-calculations"), comparisonResults: adapter.collection("provider-comparisons"), proposals: adapter.collection("provider-proposals"), exports: adapter.collection("provider-exports"), auditEvents: adapter.collection("provider-audit"), regulatoryRefreshState: adapter.collection("provider-regulatory-refresh-state"), regulatoryRefreshRuns: adapter.collection("provider-regulatory-refresh-runs") };
    registerProductionStorageAdapter({ kind: "provider", cteArchiveRepository: new LocalCteArchiveRepository(root), marketArchiveRepository: new LocalMarketArchiveRepository(root), billRepository: new LocalBillRepository(root), documentStorage: new LocalDocumentStorage(root), ...providerRecords });
    const complete = readinessReport(new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(complete.runtimeMode, "production");
    assert.equal(complete.authAdapterConfigured, true);
    assert.equal(complete.persistenceAdapterConfigured, true);
    assert.equal(complete.readiness, true);
    assert.equal((await resolvePrincipal(request)).source, "VERIFIED_SESSION");
    const providerAuthEvents = await isolatedAudit.list("tenant_auth-smoke");
    assert.equal(providerAuthEvents.filter((record) => record.payload.action === "AUTHENTICATION_SUCCESS").length, 2);
    assert.equal(providerAuthEvents.filter((record) => record.payload.metadata.source === "VERIFIED_SESSION").length, 1);
    clearProductionSessionAdapter();
    clearProductionStorageAdapter();
    const records = adapter.collection("records");
    const first = await records.put({ tenantId: "tenant_auth-smoke", recordId: "record-1", payload: { value: "one" }, idempotencyKey: "idem-1", now: "2026-01-01T00:00:00.000Z" });
    assert.equal(first.version, 1);
    assert.deepEqual(await records.put({ tenantId: "tenant_auth-smoke", recordId: "record-1", payload: { value: "ignored" }, idempotencyKey: "idem-1" }), first);
    const independent = await records.put({ tenantId: "tenant_auth-smoke", recordId: "record-2", payload: { value: "two" }, idempotencyKey: "idem-1" });
    assert.equal(independent.recordId, "record-2");
    const second = await records.put({ tenantId: "tenant_auth-smoke", recordId: "record-1", payload: { value: "two" }, expectedVersion: 1, now: "2026-01-02T00:00:00.000Z" });
    assert.equal(second.version, 2);
    assert.equal(second.createdAt, first.createdAt);
    await assert.rejects(() => records.put({ tenantId: "tenant_auth-smoke", recordId: "record-1", payload: { value: "three" }, expectedVersion: 1 }), /PERSISTENCE_VERSION_CONFLICT/);
    await assert.rejects(() => records.get("tenant_auth-smoke", "../escape"), /PERSISTENCE_PATH_INVALID/);
    await assert.rejects(() => records.get("tenant_auth-smoke", "..\\escape"), /PERSISTENCE_PATH_INVALID/);
    await assert.rejects(() => records.get("tenant_auth-smoke", "%2e%2e%2fescape"), /PERSISTENCE_PATH_INVALID/);
    await assert.rejects(() => records.append({ tenantId: "tenant_auth-smoke", recordId: "record-1", payload: { value: "duplicate" } }), /PERSISTENCE_APPEND_ONLY_CONFLICT/);
    const files = await readdir(path.join(root, "records", "tenant_auth-smoke"));
    assert.deepEqual(files, ["record-1.json", "record-2.json"]);

    const audit = new AuditLogger(adapter.collection("audit-events"));
    const event = await audit.record({ tenantId: "tenant_auth-smoke", principal: { userId: "user_local-dev", tenantId: "tenant_auth-smoke", role: "ADMIN", sessionId: "session_local-dev", issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" }, action: "TEST", resourceType: "RECORD", resourceId: "record-1", timestamp: "2026-01-03T00:00:00.000Z", outcome: "ALLOWED", correlationId: "phase6-auth-smoke", metadata: { safe: true } });
    assert.equal(event.metadata.safe, true);
    await assert.rejects(() => audit.record({ action: "TEST", resourceType: "RECORD", outcome: "FAILED", correlationId: "phase6-auth-smoke", metadata: { token: "secret" } }), /AUDIT_REDACTION_REQUIRED/);
    for (const key of ["cookie", "authorization", "rawRequest", "stackTrace"]) {
      await assert.rejects(() => audit.record({ action: "TEST", resourceType: "RECORD", outcome: "FAILED", correlationId: "phase6-auth-smoke", metadata: { [key]: "sensitive" } }), /AUDIT_REDACTION_REQUIRED/);
    }
    assert.equal((await adapter.collection("audit-events").list("tenant_auth-smoke")).length, 1);
    await assert.rejects(() => adapter.collection("audit-events").append({ tenantId: "tenant_auth-smoke", recordId: event.eventId, payload: event }), /PERSISTENCE_APPEND_ONLY_CONFLICT/);
    const persistedAudit = JSON.stringify([...(await isolatedAudit.list("tenant_auth-smoke")), ...(await isolatedAudit.listUnscoped()), ...(await adapter.collection("audit-events").list("tenant_auth-smoke"))]);
    assert.doesNotMatch(persistedAudit, /secret/i);
    assert.doesNotMatch(persistedAudit, /"(?:token|cookie|authorization|raw|request|header|headers|stack|stackTrace|exception)"\s*:/i);
    assert.deepEqual(planMigration(1), { dryRun: true, fromVersion: 1, toVersion: 1, action: "NOOP" });
    assert.throws(() => planMigration(2), /PERSISTENCE_SCHEMA_UNSUPPORTED/);
  } finally { clearProductionSessionAdapter(); clearProductionStorageAdapter(); await rm(root, { recursive: true, force: true }); }
  console.log("auth-persistence-production smoke: ok");
} finally { clearAuditRepository(); restore(); await rm(auditRoot, { recursive: true, force: true }); }
