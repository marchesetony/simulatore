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
const SOURCES = ["pun", "psv", "arera", "terna", "capacity", "dispatching"] as const;
type Source = typeof SOURCES[number];

async function runSource(source: Source, tenantId: string, repositories: ReturnType<typeof runtimeRepositories>) {
  const run = source === "pun" ? runPunMarketRefresh({ tenantId, repositories, trigger: "MANUAL" })
    : source === "psv" ? runPsvMarketRefresh({ tenantId, repositories })
    : source === "arera" ? runRegulatoryRefresh({ tenantId, repositories, trigger: "MANUAL" })
    : source === "terna" ? runTernaCapacityRefresh({ tenantId, repositories, trigger: "MANUAL" })
    : source === "capacity" ? runAreraCapacityRefresh({ tenantId, repositories, trigger: "MANUAL" })
    : runTernaDispatchingRefresh({ tenantId, repositories, trigger: "MANUAL" });
  const result = await (run as Promise<{ readonly status: string; readonly errors: readonly string[] }>).catch(failure);
  return { status: result.status, errors: result.errors, ...("months" in result ? { months: (result as { readonly months: unknown }).months } : {}) };
}

async function platformPrincipal(request: Request): Promise<Response | Awaited<ReturnType<typeof requestPrincipal>>> {
  let principal;
  try { principal = await requestPrincipal(request, "ADMIN"); } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo gli amministratori" } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  // Tony (31/10): "gli archivi arera, terna gme, tutti i dati di mercato li gestisce solo l'azienda, no il cliente che compra
  // l'app": only the platform owner refreshes them; the nightly job keeps running for every company.
  if (!isPlatformOwner(principal)) return Response.json({ error: { code: "MARKET_OFFICIAL_DATA_READ_ONLY", message: "I dati ufficiali li aggiorna solo la piattaforma" } }, { status: 403, headers: { "cache-control": "no-store" } });
  return principal;
}

/** The companies and sources the page refreshes one request at a time (Tony, 6/11: HTTP_504 when everything ran in one request). */
export async function GET(request: Request): Promise<Response> {
  const principal = await platformPrincipal(request);
  if (principal instanceof Response) return principal;
  const repositories = runtimeRepositories();
  const tenants = [...new Set([principal.tenantId, ...await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies)])];
  return Response.json({ tenants, sources: SOURCES }, { headers: { "cache-control": "no-store, private" } });
}

/** Runs the nightly official-data refresh now (Tony, 27/10: "come aggiorno, manca il tasto" on Dati di mercato). GME, Terna and
 *  ARERA values are the same for everyone (Tony, 28/10). With { tenantId, source } it runs one source for one company, so each
 *  request stays within the time limit; without it, everything for every company (as before). */
export async function POST(request: Request): Promise<Response> {
  const principal = await platformPrincipal(request);
  if (principal instanceof Response) return principal;
  const repositories = runtimeRepositories();
  const tenants = [...new Set([principal.tenantId, ...await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies)])];
  const body = await request.json().catch(() => ({})) as { readonly tenantId?: unknown; readonly source?: unknown };
  if (body.source !== undefined || body.tenantId !== undefined) {
    const source = SOURCES.find((item) => item === body.source);
    if (!source || typeof body.tenantId !== "string" || !tenants.includes(body.tenantId)) return Response.json({ error: { code: "OFFICIAL_REFRESH_REQUEST_INVALID", message: "Azienda o fonte non prevista" } }, { status: 400, headers: { "cache-control": "no-store" } });
    return Response.json({ refreshedAt: new Date().toISOString(), tenantId: body.tenantId, source, result: await runSource(source, body.tenantId, repositories) }, { headers: { "cache-control": "no-store, private" } });
  }
  const results = [];
  for (const tenantId of tenants) {
    const entry: Record<string, unknown> = { tenantId };
    for (const source of SOURCES) entry[source] = await runSource(source, tenantId, repositories);
    results.push(entry);
  }
  return Response.json({ refreshedAt: new Date().toISOString(), results }, { headers: { "cache-control": "no-store, private" } });
}
