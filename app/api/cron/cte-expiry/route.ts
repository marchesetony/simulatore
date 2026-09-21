// @ts-expect-error Next route handlers are evaluated by the framework.
import { runtimeRepositories } from "../../../lib/persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { configuredFoundationRetentionTenants, foundationRetentionCronAuthorizationMatches, foundationRetentionCronSecretConfigured } from "../../../lib/foundation/retention-config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { expireCteArchives } from "../../../lib/cte/archive/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { observeJob } from "../../../lib/automation/observability.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const secret = foundationRetentionCronSecretConfigured();
    if (!foundationRetentionCronAuthorizationMatches(request, secret)) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const repositories = runtimeRepositories();
    const results = [];
    const at = new Date().toISOString();
    for (const tenantId of configuredFoundationRetentionTenants()) {
      const observed = await observeJob({ repository: repositories.jobRuns, incidents: repositories.jobIncidents, tenantId, jobKey: "CTE_EXPIRY", trigger: "CRON", now: at, operation: () => expireCteArchives(repositories.cteArchiveRepository, tenantId, "SYSTEM_CTE_EXPIRY", at), summary: (result) => ({ scanned: result.scanned, expired: result.expired }) });
      results.push(observed.value ?? { status: "ALREADY_RUNNING", runId: observed.run.payload.runId, tenantId });
    }
    return Response.json({ status: "OK", results });
  } catch {
    return Response.json({ error: "CTE_EXPIRY_FAILED" }, { status: 500 });
  }
}
