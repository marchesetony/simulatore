import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { officialDataTenants } from "../../../lib/automation/official-data-tenants";
import { configuredMarketRefreshTenants } from "../../../lib/market-refresh/config";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { officialArchiveReport } from "../../../lib/regulatory-refresh/archive-report";

export const runtime = "nodejs";

/** Shows what the ARERA/Terna archive holds per domain and which recent months are not covered. */
export async function GET(request: Request): Promise<Response> {
  let principal;
  try { principal = await requestPrincipal(request, "ADMIN"); } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo gli amministratori" } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const repositories = runtimeRepositories();
  const tenants = isPlatformOwner(principal) ? await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies) : [principal.tenantId];
  const reports = await Promise.all(tenants.map((tenantId) => officialArchiveReport(repositories, tenantId)));
  return Response.json({ reports }, { headers: { "cache-control": "no-store, private" } });
}
