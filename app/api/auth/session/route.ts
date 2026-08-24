import { getRuntimeConfig } from "../../../lib/auth/config";
import { createSupabaseProviderClient, readProductionProviderConfig, SupabaseServerSessionAdapter } from "../../../lib/production/supabase";

export const runtime = "nodejs";

const responseHeaders = { "cache-control": "no-store, private", "content-type": "application/json", "vary": "Cookie", "x-content-type-options": "nosniff" };

export async function GET(request: Request): Promise<Response> {
  try {
    const runtime = getRuntimeConfig();
    if (runtime.runtimeMode === "local") return Response.json({ authenticated: true, displayName: "Sviluppo locale", role: runtime.localRole, tenantId: runtime.localTenantId }, { headers: responseHeaders });
    const provider = readProductionProviderConfig();
    if (!provider.valid) return Response.json({ authenticated: false }, { headers: responseHeaders });
    const client = createSupabaseProviderClient(provider.config);
    const principal = await new SupabaseServerSessionAdapter(client, provider.config.sessionCookieName).resolve(request);
    if (!principal) return Response.json({ authenticated: false }, { headers: responseHeaders });
    const userQuery = client.from("runtime_users").select("user_id,display_name,active").eq("user_id", principal.userId).maybeSingle();
    const { data: user, error } = await userQuery;
    if (error || !user || user.active !== true) return Response.json({ authenticated: false }, { headers: responseHeaders });
    return Response.json({ authenticated: true, displayName: user.display_name, role: principal.role, tenantId: principal.tenantId }, { headers: responseHeaders });
  } catch {
    return Response.json({ authenticated: false }, { headers: responseHeaders });
  }
}
