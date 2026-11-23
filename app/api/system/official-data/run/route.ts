import { isPlatformOwner } from "../../../../lib/access/service";
import { requestPrincipal } from "../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { describeServiceError } from "../../../../lib/official-monitor/service-overview";
import { activeServiceJob, isManualCommand, MANUAL_COMMANDS, serviceTriggerConfig, triggerServiceJob } from "../../../../lib/official-monitor/service-trigger";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Control Room → Dati ufficiali, comandi manuali (Tony 23/11/2026): «Aggiorna GME», «Aggiorna ARERA», «Aggiorna Terna».
 * POST { command: "gme" | "arera" | "terna" }. Only the producer (ADMIN of tenant_piattaforma, from the session). The call to the
 * independent service happens here, on the server, with a secret the browser never sees; the service stays in its own mode
 * (test mode: nothing is published) and a job already running is never started again.
 */
const headers = { "cache-control": "no-store, private" };
const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  try { if (!isPlatformOwner(await requestPrincipal(request, "ADMIN"))) throw new Error("AUTHORIZATION_DENIED"); }
  catch { return fail(403, "AUTHORIZATION_DENIED", "Riservato all'amministratore della piattaforma"); }
  const body = await request.json().catch(() => null) as { readonly command?: unknown } | null;
  if (!isManualCommand(body?.command)) return fail(400, "OFFICIAL_COMMAND_UNKNOWN", "Comando non riconosciuto");
  const command = body.command;
  const config = serviceTriggerConfig();
  if (!config) return fail(503, "OFFICIAL_SERVICE_NOT_CONNECTED", "Comandi non attivi: il collegamento tra Simulatore e servizio dati ufficiali non è configurato in questo ambiente.");
  const active = await activeServiceJob(runtimeRepositories().officialServiceLocks, MANUAL_COMMANDS[command].job, new Date().toISOString()).catch(() => null);
  if (active) return Response.json({ command, status: "ALREADY_RUNNING", outcome: null, message: "Il servizio sta già eseguendo questo aggiornamento: attendi la fine.", errors: [] }, { headers });
  const result = await triggerServiceJob({ command, config });
  // The outcome travels in the body (COMPLETED, RUNNING, ALREADY_RUNNING, FAILED): the panel shows it as it is.
  return Response.json({ ...result, errors: result.errors.map(describeServiceError) }, { status: result.status === "RUNNING" ? 202 : 200, headers });
}
