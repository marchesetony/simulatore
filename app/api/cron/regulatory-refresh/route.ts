// @ts-expect-error Next route handlers are evaluated by the framework.
import { runtimeRepositories } from "../../../lib/persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { configuredRefreshTenants, cronAuthorizationMatches, cronSecretConfigured } from "../../../lib/regulatory-refresh/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runRegulatoryRefresh } from "../../../lib/regulatory-refresh/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { observeJob } from "../../../lib/automation/observability.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    if (!request.headers.get("authorization")) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const secret = cronSecretConfigured();
    if (!cronAuthorizationMatches(request, secret)) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const tenants = configuredRefreshTenants();
    const repositories = runtimeRepositories();
    const results = [];
    for (const tenantId of tenants) {
      const observed = await observeJob({ repository: repositories.jobRuns, incidents: repositories.jobIncidents, tenantId, jobKey: "REGULATORY_REFRESH", trigger: "CRON", now: new Date().toISOString(), operation: () => runRegulatoryRefresh({ tenantId, repositories, trigger: "CRON" }), summary: (result) => ({ domains: result.sourceChecks.length, failed: result.failedCount, created: result.createdCount, replaced: result.replacedCount }) });
      results.push(observed.value ?? { status: "ALREADY_RUNNING", runId: observed.run.payload.runId, tenantId });
    }
    return Response.json({ status: "OK", results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REGULATORY_REFRESH_FAILED";
    const status = message === "CRON_SECRET_REQUIRED" || message === "REGULATORY_REFRESH_TENANTS_REQUIRED" ? 500 : 500;
    return Response.json({ error: message }, { status });
  }
}
