import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { observeJob, operationsStatus, recordIncident, resolveIncident } from "../app/lib/automation/observability.ts";
import { withBoundedRetry } from "../app/lib/automation/retry.ts";

const tenant = "tenant_automation-test";
const root = await mkdtemp(path.join(os.tmpdir(), "automation-operations-"));
try {
  const local = new LocalFilesystemAdapter(root);
  const runs = local.collection("job-runs");
  const incidents = local.collection("job-incidents");
  const now = "2026-09-15T04:00:00.000Z";
  const first = await observeJob({ repository: runs, incidents, tenantId: tenant, jobKey: "MARKET_REFRESH", trigger: "TEST", now, operation: async () => ({ monthsChecked: 4, monthsFailed: 0 }), summary: (value) => value });
  assert.equal(first.executed, true);
  const duplicate = await observeJob({ repository: runs, incidents, tenantId: tenant, jobKey: "MARKET_REFRESH", trigger: "TEST", now, operation: async () => { throw new Error("MUST_NOT_EXECUTE"); } });
  assert.equal(duplicate.executed, false);
  assert.equal((await runs.list(tenant)).length, 1);
  console.log("JOB_IDEMPOTENCY=PASS");

  const oldRun = await observeJob({ repository: runs, incidents, tenantId: tenant, jobKey: "BILL_RETENTION", trigger: "TEST", now: "2026-09-10T05:00:00.000Z", operation: async () => ({ scanned: 0 }), summary: (value) => value });
  assert.equal(oldRun.executed, true);

  const failed = await assert.rejects(() => observeJob({ repository: runs, incidents, tenantId: tenant, jobKey: "REGULATORY_REFRESH", trigger: "TEST", now, operation: async () => { throw new Error("SOURCE_TIMEOUT"); } }));
  assert.equal(failed, undefined);
  const status = await operationsStatus({ repository: runs, incidents, tenantId: tenant, now: "2026-09-15T05:00:00.000Z" });
  assert.equal(status.openIncidents.length, 2);
  assert.equal(status.openIncidents.find((incident) => incident.jobKey === "REGULATORY_REFRESH").diagnostics.retryable, true);
  assert.ok(status.missedJobs.includes("BILL_RETENTION"));
  const incident = (await incidents.list(tenant))[0];
  await resolveIncident(incidents, tenant, incident.recordId, "2026-09-15T06:00:00.000Z");
  assert.equal((await incidents.get(tenant, incident.recordId)).payload.status, "RESOLVED");
  console.log("INCIDENT_PERSISTENCE_AND_RESOLUTION=PASS");

  let attempts = 0;
  const retry = await withBoundedRetry(async () => { attempts += 1; if (attempts < 3) throw new Error("SOURCE_TIMEOUT"); return "ok"; }, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined });
  assert.equal(retry.value, "ok");
  assert.equal(retry.attempts, 3);
  await assert.rejects(() => withBoundedRetry(async () => { throw new Error("SCHEMA_INVALID"); }, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined }), /AUTOMATION_RETRY_EXHAUSTED/);
  console.log("BOUNDED_RETRY_AND_NON_RETRYABLE_FAIL_CLOSED=PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("AUTOMATION_OPERATIONS_SMOKE=PASS");
