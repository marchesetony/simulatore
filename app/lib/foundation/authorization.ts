import type { Permission, TenantId } from "./types";
import type { TenantContext } from "./tenants";

export interface AuthorizationRequest {
  readonly context: TenantContext;
  readonly tenantId: TenantId;
  readonly permission: Permission;
}

export interface AuthorizationResult {
  readonly allowed: boolean;
  readonly reason: "ALLOWED" | "TENANT_MISMATCH" | "PERMISSION_MISSING" | "CONTEXT_INVALID";
}

export function authorize(request: AuthorizationRequest): AuthorizationResult {
  if (!request.context.isActive() || !request.context.userId || !request.context.membershipId) {
    return { allowed: false, reason: "CONTEXT_INVALID" };
  }
  if (request.context.tenantId !== request.tenantId) {
    return { allowed: false, reason: "TENANT_MISMATCH" };
  }
  if (!request.context.hasPermission(request.permission)) {
    return { allowed: false, reason: "PERMISSION_MISSING" };
  }
  return { allowed: true, reason: "ALLOWED" };
}

export function requirePermission(context: TenantContext, tenantId: TenantId, permission: Permission): void {
  const result = authorize({ context, tenantId, permission });
  if (!result.allowed) throw new Error(`AUTHORIZATION_DENIED:${result.reason}`);
}
