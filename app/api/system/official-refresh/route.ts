import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { officialDataTenants } from "../../../lib/automation/official-data-tenants";
import { configuredMarketRefreshTenants } from "../../../lib/market-refresh/config";
import { runPsvMarketRefresh } from "../../../lib/market-refresh/psv";
import { runPunMarketRefresh } from "../../../lib/market-refresh/service";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { runRegulatoryRefresh } from "../../../lib/regulatory-refresh/service";
import { runTernaCapacityRefresh } from "../../../lib/regulatory-refresh/terna";

export const runtime = "nodejs";
export const maxDuration = 300;

const failure = (error: unknown) => ({ status: "FAILED", errors: [error instanceof Error ? error.message : "REFRESH_FAILED"] });

/** The platform owner runs the nightly official-data refresh now, for every company. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isPlatformOwner(await requestPrincipal(request, "ADMIN"))) throw new Error("AUTHORIZATION_DENIED");
  } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo il proprietario della piattaforma" } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const repositories = runtimeRepositories();
  const tenants = await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies);
  const results = [];
  for (const tenantId of tenants) {
    const pun = await runPunMarketRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const psv = await runPsvMarketRefresh({ tenantId, repositories }).catch(failure);
    const arera = await runRegulatoryRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const terna = await runTernaCapacityRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    results.push({ tenantId, pun: { status: pun.status, errors: pun.errors }, psv: { status: psv.status, errors: psv.errors }, arera: { status: arera.status, errors: arera.errors }, terna: { status: terna.status, errors: terna.errors } });
  }
  return Response.json({ refreshedAt: new Date().toISOString(), results }, { headers: { "cache-control": "no-store, private" } });
}
