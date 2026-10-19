import { requestPrincipal } from "../../../lib/auth/request";
import { checkOfficialSources } from "../../../lib/regulatory-refresh/official-sources-check";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Administrators check, from the server, what Terna and ARERA publish today. Nothing is saved. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requestPrincipal(request, "ADMIN");
  } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo gli amministratori" } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  return Response.json(await checkOfficialSources(), { headers: { "cache-control": "no-store, private" } });
}
