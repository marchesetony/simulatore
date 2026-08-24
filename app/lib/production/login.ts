import type { AuthRole } from "../auth/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createProductionSession, resolveProductionIdentity, type ProductionIdentityResolution } from "./supabase.ts";

export type PasswordAuthVerifier = {
  readonly auth: {
    signInWithPassword(credentials: { readonly email: string; readonly password: string }): Promise<{ readonly data: { readonly user?: { readonly id?: string } | null }; readonly error: unknown }>
  }
};

export type ProductionLoginResult =
  | { readonly kind: "AUTHENTICATION_FAILED" }
  | { readonly kind: "AUTHENTICATION_UNAVAILABLE" }
  | { readonly kind: "TENANT_SELECTION_REQUIRED" }
  | { readonly kind: "AUTHENTICATED"; readonly token: string; readonly sessionId: string; readonly displayName: string; readonly role: AuthRole; readonly tenantId: string };

function resultForIdentity(identity: ProductionIdentityResolution): ProductionLoginResult | null {
  if (identity.kind === "TENANT_SELECTION_REQUIRED") return { kind: "TENANT_SELECTION_REQUIRED" };
  if (identity.kind !== "READY") return { kind: "AUTHENTICATION_FAILED" };
  return null;
}

export async function authenticateProductionLogin(
  authClient: PasswordAuthVerifier,
  providerClient: Parameters<typeof createProductionSession>[0],
  credentials: { readonly email: string; readonly password: string },
  cookieName: string,
  maxAgeSeconds: number,
): Promise<ProductionLoginResult> {
  let authResult: Awaited<ReturnType<PasswordAuthVerifier["auth"]["signInWithPassword"]>>;
  try { authResult = await authClient.auth.signInWithPassword(credentials); } catch { return { kind: "AUTHENTICATION_UNAVAILABLE" }; }
  if (authResult.error || !authResult.data.user?.id) return { kind: "AUTHENTICATION_FAILED" };

  try {
    const identity = await resolveProductionIdentity(providerClient, authResult.data.user.id);
    const identityResult = resultForIdentity(identity);
    if (identityResult) return identityResult;
    if (identity.kind !== "READY") return { kind: "AUTHENTICATION_FAILED" };
    const session = await createProductionSession(providerClient, { userId: identity.userId, tenantId: identity.membership.tenantId, role: identity.membership.role }, cookieName, maxAgeSeconds);
    return { kind: "AUTHENTICATED", token: session.token, sessionId: session.sessionId, displayName: identity.displayName, role: identity.membership.role, tenantId: identity.membership.tenantId };
  } catch { return { kind: "AUTHENTICATION_UNAVAILABLE" }; }
}
