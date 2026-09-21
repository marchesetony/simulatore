import { randomUUID } from "node:crypto";
// @ts-expect-error Next route handlers are evaluated by the framework.
import { runtimeRepositories } from "../../../lib/persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { configuredFoundationRetentionTenants, foundationRetentionCronAuthorizationMatches, foundationRetentionCronSecretConfigured } from "../../../lib/foundation/retention-config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runBillRetention } from "../../../lib/foundation/bill-retention.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { observeJob } from "../../../lib/automation/observability.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const secret = foundationRetentionCronSecretConfigured();
    if (!foundationRetentionCronAuthorizationMatches(request, secret)) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const repositories = runtimeRepositories();
    const now = new Date().toISOString();
    const results: Array<Record<string, unknown>> = [];
    for (const tenantId of configuredFoundationRetentionTenants()) {
      const observed = await observeJob({ repository: repositories.jobRuns, incidents: repositories.jobIncidents, tenantId, jobKey: "BILL_RETENTION", trigger: "CRON", now, operation: () => runBillRetention({ tenantId, repositories: { bills: repositories.billRepository, storage: repositories.documentStorage, audit: { async record(event) { const eventId = `bill-retention-${randomUUID()}`; await repositories.auditEvents.append({ recordId: eventId, tenantId: event.tenantId, payload: { schemaVersion: 1, eventId, tenantId: event.tenantId, action: `BILL_${event.type}`, resourceType: "BILL", resourceId: event.documentId, timestamp: now, outcome: event.outcome, correlationId: "bill-retention", metadata: {} }, now }); } } }, now }), summary: (result) => ({ scanned: result.scanned, deleted: result.deleted, failed: result.failed }) });
      results.push((observed.value ?? { status: "ALREADY_RUNNING", runId: observed.run.payload.runId, tenantId }) as unknown as Record<string, unknown>);
    }
    const failed = results.some((result) => typeof result.failed === "number" && result.failed > 0);
    return Response.json({ status: failed ? "FAILED" : "OK", results }, { status: failed ? 500 : 200 });
  } catch {
    return Response.json({ error: "BILL_RETENTION_FAILED" }, { status: 500 });
  }
}
