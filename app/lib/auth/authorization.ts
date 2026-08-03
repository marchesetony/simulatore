// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { authFail } from "./errors.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";
import type { AccessLevel, AuthenticatedPrincipal, AuthRole, AuthorizationResult } from "./types";

function can(role: AuthRole, access: AccessLevel): boolean { return access === "READ" || role === "ADMIN" || role === "ANALYST" && access === "WRITE"; }

export function authorizePrincipal(principal: AuthenticatedPrincipal, access: AccessLevel, requestedTenantId?: string): AuthorizationResult {
  if (requestedTenantId !== undefined && requestedTenantId !== principal.tenantId) return { allowed: false, reason: "TENANT_MISMATCH" };
  if (!can(principal.role, access)) return { allowed: false, reason: "ROLE_INSUFFICIENT" };
  return { allowed: true, reason: "ALLOWED" };
}

export async function requireAuthorization(principal: AuthenticatedPrincipal, access: AccessLevel, requestedTenantId?: string): Promise<void> {
  const result = authorizePrincipal(principal, access, requestedTenantId);
  if (!result.allowed) {
    try { await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "AUTHORIZATION_DENIAL", resourceType: "AUTHORIZATION", outcome: "DENIED", correlationId: "phase6-authorization", metadata: { access, reason: result.reason } }); }
    catch { console.error("phase6-authz-audit-failure", { reason: result.reason }); }
    authFail(result.reason === "TENANT_MISMATCH" ? "TENANT_MISMATCH" : "AUTHORIZATION_DENIED");
  }
}
