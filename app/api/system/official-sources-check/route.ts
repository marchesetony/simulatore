import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { checkOfficialSources } from "../../../lib/regulatory-refresh/official-sources-check";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The platform owner checks, from the server, what Terna and ARERA publish today. Nothing is saved. */
export async function POST(request: Request): Promise<Response> {
  try {
    // Official sources are platform configuration, not something the companies using the app manage.
    if (!isPlatformOwner(await requestPrincipal(request, "ADMIN"))) throw new Error("AUTHORIZATION_DENIED");
  } catch {
    return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo il proprietario della piattaforma" } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  return Response.json(await checkOfficialSources(), { headers: { "cache-control": "no-store, private" } });
}
