import "server-only";
import { AuthError } from "../../core/errors/auth-error";
import { simulationPermissions, billPermissions, canonicalRole, customerPermissions, permissions, record, requiredString } from "./schema";
import type { AccessRepository } from "./repository";
import type { Identity, Permission, Principal } from "./types";

async function principalFromAssignment(identity: Identity, value: unknown, repo: AccessRepository): Promise<Principal> {
  const row = record(value);
  const role = canonicalRole(row.role);
  if (row.user_id !== identity.userId || row.status !== "ACTIVE") throw new AuthError("ACCESS_DENIED");
  const base = { ...identity, assignmentId: requiredString(row.id), permissions: permissions(row.permissions) };
  if (role === "PLATFORM_OWNER") {
    if (row.scope !== "PLATFORM" || row.tenant_id !== null) throw new AuthError("ACCESS_CONFIGURATION_INVALID");
    return Object.freeze({ ...base, role, scope: "PLATFORM" });
  }
  const tenantId = requiredString(row.tenant_id);
  if (row.scope !== "TENANT" || !await repo.tenantActive(tenantId)) throw new AuthError("ACCESS_DENIED");
  return Object.freeze({ ...base, role, scope: "TENANT", tenantId, membershipStatus: "ACTIVE" });
}

export async function resolveAccess(repo: AccessRepository, authUserId: string, assignmentId?: string): Promise<Principal> {
  const identity = await repo.identity(authUserId);
  if (!identity || identity.authUserId !== authUserId || !identity.userId) throw new AuthError("ACCESS_DENIED");
  const rows = await repo.assignments(identity.userId);
  if (rows.length === 0) {
    for (const role of await repo.legacyRoles(identity.userId)) canonicalRole(role);
    throw new AuthError("ACCESS_DENIED");
  }
  const active = rows.filter(row => record(row).status === "ACTIVE");
  const principals = await Promise.all(active.map(row => principalFromAssignment(identity, row, repo)));
  if (assignmentId) {
    const selected = principals.find(principal => principal.assignmentId === assignmentId);
    if (!selected) throw new AuthError("ACCESS_DENIED");
    return selected;
  }
  if (principals.length > 1) throw new AuthError("TENANT_SELECTION_REQUIRED");
  if (principals.length !== 1) throw new AuthError("ACCESS_DENIED");
  return principals[0];
}

/** Internal server policy; callers must obtain the principal through session verification. */
export async function authorize(principal: Principal, permission: Permission,
  scope: "PLATFORM" | "TENANT", repo: AccessRepository, targetTenantId?: string): Promise<boolean> {
  if (!principal.userId || !principal.authUserId || !principal.assignmentId) return false;
  try { canonicalRole(principal.role); } catch { return false; }
  const allowed: readonly Permission[] = [...principal.permissions.filter(p => p === "auth:login" || p === "auth:session"),
    ...customerPermissions(principal.role), ...billPermissions(principal.role), ...simulationPermissions(principal.role)];
  if (!allowed.includes(permission)) return false;
  if (principal.scope === "PLATFORM") {
    if (principal.role !== "PLATFORM_OWNER" || principal.tenantId !== undefined) return false;
    return scope === "PLATFORM" ? targetTenantId === undefined :
      Boolean(targetTenantId && await repo.tenantActive(targetTenantId));
  }
  return principal.scope === "TENANT" && ["TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"].includes(principal.role) &&
    scope === "TENANT" && principal.membershipStatus === "ACTIVE" &&
    principal.tenantId === targetTenantId && Boolean(targetTenantId) && await repo.tenantActive(principal.tenantId);
}
