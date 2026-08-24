import { cookies } from "next/headers";
import { getRuntimeConfig } from "../../../lib/auth/config";
import { isSameOriginRequest } from "../../../lib/auth/origin";
import { authenticateProductionLogin } from "../../../lib/production/login";
import { createSupabaseAuthClient, createSupabaseProviderClient, readProductionProviderConfig } from "../../../lib/production/supabase";

export const runtime = "nodejs";

const responseHeaders = { "cache-control": "no-store, private", "content-type": "application/json", "vary": "Origin, Host, Cookie", "x-content-type-options": "nosniff" };

function response(body: Record<string, unknown>, status: number): Response { return Response.json(body, { status, headers: responseHeaders }); }
function genericFailure(status = 401): Response { return response({ authenticated: false, error: { code: "AUTHENTICATION_FAILED", message: "Credenziali non valide" } }, status); }
function unavailable(): Response { return response({ authenticated: false, error: { code: "AUTHENTICATION_UNAVAILABLE", message: "Autenticazione temporaneamente non disponibile" } }, 503); }

function normalizeCredentials(value: unknown): { readonly email: string; readonly password: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.email !== "string" || typeof input.password !== "string") return null;
  const email = input.email.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || input.password.length === 0 || input.password.length > 4096) return null;
  return { email, password: input.password };
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return response({ authenticated: false, error: { code: "ORIGIN_REJECTED", message: "Richiesta non autorizzata" } }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return genericFailure(); }
  const credentials = normalizeCredentials(body);
  if (!credentials) return genericFailure();

  let runtime;
  try { runtime = getRuntimeConfig(); } catch { return unavailable(); }
  if (runtime.runtimeMode !== "production") return unavailable();

  const provider = readProductionProviderConfig();
  if (!provider.valid) return unavailable();

  try {
    const authClient = createSupabaseAuthClient(provider.config);
    const providerClient = createSupabaseProviderClient(provider.config);
    const result = await authenticateProductionLogin(authClient, providerClient, credentials, provider.config.sessionCookieName, provider.config.sessionMaxAgeSeconds);
    if (result.kind === "TENANT_SELECTION_REQUIRED") return response({ authenticated: false, state: "TENANT_SELECTION_REQUIRED", error: { code: "TENANT_SELECTION_REQUIRED", message: "Selezionare un tenant" } }, 409);
    if (result.kind === "AUTHENTICATION_FAILED") return genericFailure();
    if (result.kind !== "AUTHENTICATED") return unavailable();
    const cookieStore = await cookies();
    cookieStore.set({ name: provider.config.sessionCookieName, value: result.token, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: provider.config.sessionMaxAgeSeconds });
    return response({ authenticated: true, displayName: result.displayName, role: result.role, tenantId: result.tenantId }, 200);
  } catch {
    return unavailable();
  }
}
