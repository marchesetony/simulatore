import "server-only";
import { verifySession } from "../../modules/auth/session";
import { authorize } from "../../modules/auth/access";
import { AuthError } from "../../core/errors/auth-error";
import type { AuthDependencies } from "../../modules/auth/service";

export type DashboardView = { readonly userId: string; readonly roleLabel: string } & (
  | { readonly scope: "PLATFORM" }
  | { readonly scope: "TENANT"; readonly tenantId: string }
);

const roleLabels = {
  PLATFORM_OWNER: "Amministratore piattaforma", TENANT_ADMIN: "Amministratore azienda",
  SALES_MANAGER: "Responsabile commerciale", SALES_OPERATOR: "Operatore commerciale",
} as const;

export async function dashboardView(token: string | undefined, deps: AuthDependencies): Promise<DashboardView> {
  if (!token) throw new AuthError("SESSION_INVALID");
  const principal = await verifySession(token, deps.sessions, deps.access);
  if (!await authorize(principal, "auth:session", principal.scope, deps.access, principal.tenantId)) {
    throw new AuthError("ACCESS_DENIED");
  }
  const identity = { userId: principal.userId, roleLabel: roleLabels[principal.role] };
  return principal.scope === "PLATFORM" ? { ...identity, scope: "PLATFORM" } :
    { ...identity, scope: "TENANT", tenantId: principal.tenantId };
}
