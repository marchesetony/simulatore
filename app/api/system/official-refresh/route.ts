import { requestPrincipal } from "../../../lib/auth/request";
import { isPlatformOwner } from "../../../lib/access/service";
import { officialDataTenants } from "../../../lib/automation/official-data-tenants";
import { configuredMarketRefreshTenants } from "../../../lib/market-refresh/config";
import { runPsvMarketRefresh } from "../../../lib/market-refresh/psv";
import { runPunMarketRefresh } from "../../../lib/market-refresh/service";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { runAreraCapacityRefresh } from "../../../lib/regulatory-refresh/arera-capacity";
import { runRegulatoryRefresh } from "../../../lib/regulatory-refresh/service";
import { runTernaCapacityRefresh, runTernaDispatchingRefresh } from "../../../lib/regulatory-refresh/terna";

export const runtime = "nodejs";
export const maxDuration = 300;

const failure = (error: unknown) => ({ status: "FAILED", errors: [error instanceof Error ? error.message : "REFRESH_FAILED"] });

/** Runs the nightly official-data refresh now, for every company (Tony, 27/10: "come aggiorno, manca il tasto" on Dati di
 *  mercato). GME, Terna and ARERA values are the same for everyone (Tony, 28/10: "gli archivi gme, terna, arera, sono
 *  centralizzati e valgono per tutti gli utenti"), so an administrator of any company refreshes them for all. */
export async function POST(request: Request): Promise<Response> {
  let principal;
  try { principal = await requestPrincipal(request, "ADMIN"); } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo gli amministratori" } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  // Tony (31/10): "gli archivi arera, terna gme, tutti i dati di mercato li gestisce solo l'azienda, no il cliente che compra
  // l'app": only the platform owner refreshes them; the nightly job keeps running for every company.
  if (!isPlatformOwner(principal)) return Response.json({ error: { code: "MARKET_OFFICIAL_DATA_READ_ONLY", message: "I dati ufficiali li aggiorna solo la piattaforma" } }, { status: 403, headers: { "cache-control": "no-store" } });
  const repositories = runtimeRepositories();
  const tenants = [...new Set([principal.tenantId, ...await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies)])];
  const results = [];
  for (const tenantId of tenants) {
    const pun = await runPunMarketRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const psv = await runPsvMarketRefresh({ tenantId, repositories }).catch(failure);
    const arera = await runRegulatoryRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const terna = await runTernaCapacityRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const capacity = await runAreraCapacityRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    const dispatching = await runTernaDispatchingRefresh({ tenantId, repositories, trigger: "MANUAL" }).catch(failure);
    results.push({ tenantId, pun: { status: pun.status, errors: pun.errors }, psv: { status: psv.status, errors: psv.errors }, arera: { status: arera.status, errors: arera.errors }, terna: { status: terna.status, errors: terna.errors }, capacity: { status: capacity.status, errors: capacity.errors, months: "months" in capacity ? capacity.months : [] }, dispatching: { status: dispatching.status, errors: dispatching.errors } });
  }
  return Response.json({ refreshedAt: new Date().toISOString(), results }, { headers: { "cache-control": "no-store, private" } });
}
