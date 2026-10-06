import "server-only";
import { AuthError } from "../../core/errors/auth-error";
import { resolveAccess, authorize } from "./access";
import { credentials } from "./schema";
import { createSession, verifySession } from "./session";
import type { AccessRepository, AuthProvider, SessionRepository } from "./repository";
import type { LoginResult, Permission } from "./types";

export interface AuthDependencies {
  readonly provider: AuthProvider;
  readonly access: AccessRepository;
  readonly sessions: SessionRepository;
  readonly sessionSeconds: number;
}

export function loginFailure(error: unknown): LoginResult {
  if (!(error instanceof AuthError)) return { kind: "AUTHENTICATION_UNAVAILABLE" };
  switch (error.code) {
    case "TENANT_SELECTION_REQUIRED": return { kind: "TENANT_SELECTION_REQUIRED" };
    case "LEGACY_ROLE_REQUIRES_REVIEW":
    case "ACCESS_CONFIGURATION_INVALID": return { kind: "ACCESS_CONFIGURATION_INVALID" };
    case "ACCESS_DENIED":
    case "INVALID_CREDENTIALS":
    case "SESSION_INVALID": return { kind: "AUTHENTICATION_FAILED" };
    default: return { kind: "AUTHENTICATION_UNAVAILABLE" };
  }
}

export async function login(input: unknown, deps: AuthDependencies): Promise<LoginResult> {
  try {
    const authUserId = await deps.provider.verify(credentials(input));
    const principal = await resolveAccess(deps.access, authUserId);
    if (!principal.permissions.includes("auth:login") || !principal.permissions.includes("auth:session")) {
      throw new AuthError("ACCESS_DENIED");
    }
    const session = await createSession(principal, deps.sessions, deps.access, deps.sessionSeconds);
    return { kind: "AUTHENTICATED", ...session };
  } catch (error) { return loginFailure(error); }
}

/** The public authorization entry accepts a session token, never browser-supplied claims. */
export async function authorizedSession(token: string, deps: AuthDependencies, permission: Permission,
  scope?: "PLATFORM" | "TENANT", targetTenantId?: string): Promise<boolean> {
  const principal = await verifySession(token, deps.sessions, deps.access);
  // A resource target requires an explicit scope; never discard an ambiguous target.
  if (scope === undefined && targetTenantId !== undefined) return false;
  return authorize(principal, permission, scope ?? principal.scope, deps.access,
    scope ? targetTenantId : principal.tenantId);
}
