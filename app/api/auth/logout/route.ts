import { cookies } from "next/headers";
import { getRuntimeConfig } from "../../../lib/auth/config";
import { isSameOriginRequest } from "../../../lib/auth/origin";
import { revokeProductionSession, createSupabaseProviderClient, readProductionProviderConfig, findProductionSessionId } from "../../../lib/production/supabase";

export const runtime = "nodejs";

const responseHeaders = { "cache-control": "no-store, private", "content-type": "application/json", "vary": "Origin, Host, Cookie", "x-content-type-options": "nosniff" };

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ authenticated: false, error: { code: "ORIGIN_REJECTED", message: "Richiesta non autorizzata" } }, { status: 403, headers: responseHeaders });
  const cookieStore = await cookies();
  try {
    const runtime = getRuntimeConfig();
    const provider = readProductionProviderConfig();
    if (runtime.runtimeMode === "production" && provider.valid) {
      const client = createSupabaseProviderClient(provider.config);
      const sessionId = await findProductionSessionId(client, request, provider.config.sessionCookieName);
      if (sessionId) await revokeProductionSession(client, sessionId);
      cookieStore.set({ name: provider.config.sessionCookieName, value: "", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    } else {
      cookieStore.set({ name: "__Host-simulatore_session", value: "", httpOnly: true, secure: runtime.runtimeMode === "production", sameSite: "lax", path: "/", maxAge: 0 });
    }
  } catch {
    cookieStore.set({ name: "__Host-simulatore_session", value: "", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  return Response.json({ authenticated: false }, { status: 200, headers: responseHeaders });
}
