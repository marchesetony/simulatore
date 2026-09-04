// @ts-expect-error Next route handlers are evaluated by the framework.
import { runtimeRepositories } from "../../../lib/persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { configuredRefreshTenants, cronAuthorizationMatches, cronSecretConfigured } from "../../../lib/regulatory-refresh/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runRegulatoryRefresh } from "../../../lib/regulatory-refresh/service.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    if (!request.headers.get("authorization")) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const secret = cronSecretConfigured();
    if (!cronAuthorizationMatches(request, secret)) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const tenants = configuredRefreshTenants();
    const repositories = runtimeRepositories();
    const results = [];
    for (const tenantId of tenants) results.push(await runRegulatoryRefresh({ tenantId, repositories, trigger: "CRON" }));
    return Response.json({ status: "OK", results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REGULATORY_REFRESH_FAILED";
    const status = message === "CRON_SECRET_REQUIRED" || message === "REGULATORY_REFRESH_TENANTS_REQUIRED" ? 500 : 500;
    return Response.json({ error: message }, { status });
  }
}
