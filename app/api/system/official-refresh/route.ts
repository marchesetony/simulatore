import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { officialDataTenants } from "../../../lib/automation/official-data-tenants";
import { configuredMarketRefreshTenants } from "../../../lib/market-refresh/config";
import { runPsvMarketRefresh } from "../../../lib/market-refresh/psv";
import { runPunMarketRefresh } from "../../../lib/market-refresh/service";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { runAreraCapacityRefresh } from "../../../lib/regulatory-refresh/arera-capacity";
import { runRegulatoryRefresh } from "../../../lib/regulatory-refresh/service";
import { runTernaCapacityRefresh } from "../../../lib/regulatory-refresh/terna";

export const runtime = "nodejs";
export const maxDuration = 300;

const failure = (error: unknown) => ({ status: "FAILED", errors: [error instanceof Error ? error.message : "REFRESH_FAILED"] });

/** Runs the nightly official-data refresh now: the platform owner for every company, a company administrator for their
 *  own company (Tony, 27/10: "come aggiorno, manca il tasto" on Dati di mercato). */
export async function POST(request: Request): Promise<Response> {
  let principal;
  try { principal = await requestPrincipal(request, "ADMIN"); } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo gli amministratori" } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const repositories = runtimeRepositories();
  const tenants = isPlatformOwner(principal) ? await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies) : [principal.tenantId];
  const results = [];
  for (const tenantId of tenants) {
    const pun = await runPunMarketRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const psv = await runPsvMarketRefresh({ tenantId, repositories }).catch(failure);
    const arera = await runRegulatoryRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const terna = await runTernaCapacityRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const capacity = await runAreraCapacityRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    results.push({ tenantId, pun: { status: pun.status, errors: pun.errors }, psv: { status: psv.status, errors: psv.errors }, arera: { status: arera.status, errors: arera.errors }, terna: { status: terna.status, errors: terna.errors }, capacity: { status: capacity.status, errors: capacity.errors, months: "months" in capacity ? capacity.months : [] } });
  }
  return Response.json({ refreshedAt: new Date().toISOString(), results }, { headers: { "cache-control": "no-store, private" } });
}
