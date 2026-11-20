import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { cronAuthorizationMatches, cronSecretConfigured } from "../../../lib/regulatory-refresh/config";
import { runOfficialMonitor } from "../../../lib/official-monitor/monitor";
import { liveProbes } from "../../../lib/official-monitor/probes";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Control Room produttore: controlli giornalieri degli archivi ufficiali (GME dal 5 al 14; ARERA, Terna, ADM il 1 e il 16). */
export async function GET(request: Request): Promise<Response> {
  if (!request.headers.get("authorization")) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
  try {
    if (!cronAuthorizationMatches(request, cronSecretConfigured())) return Response.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
    const repositories = runtimeRepositories();
    const checks = await runOfficialMonitor({ repositories: { alerts: repositories.officialAlerts, checks: repositories.officialChecks }, probes: liveProbes(repositories), now: new Date().toISOString() });
    return Response.json({ status: "OK", checks: checks.map((check) => ({ code: check.code, period: check.period, outcome: check.outcome })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "OFFICIAL_MONITOR_FAILED" }, { status: 500 });
  }
}
