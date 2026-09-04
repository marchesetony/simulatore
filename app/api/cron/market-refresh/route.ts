// @ts-expect-error Next route handlers are evaluated by the framework.
import { runtimeRepositories } from "../../../lib/persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { configuredMarketRefreshTenants, marketCronAuthorizationMatches, marketCronSecretConfigured } from "../../../lib/market-refresh/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runPunMarketRefresh } from "../../../lib/market-refresh/service.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    if (!request.headers.get("authorization")) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const secret = marketCronSecretConfigured();
    if (!marketCronAuthorizationMatches(request, secret)) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const repositories = runtimeRepositories();
    const results = [];
    for (const tenantId of configuredMarketRefreshTenants()) results.push(await runPunMarketRefresh({ tenantId, repositories, trigger: "CRON" }));
    return Response.json({ status: "OK", results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PUN_REFRESH_FAILED";
    return Response.json({ error: message }, { status: 500 });
  }
}
