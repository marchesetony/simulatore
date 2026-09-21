import type { AuthRole, CanonicalProductRole } from "./types";
import type { Role as FoundationRole } from "../foundation/types";

export const CANONICAL_PRODUCT_ROLES: readonly CanonicalProductRole[] = ["SUPER_ADMIN", "ADMIN", "AGENT"];
export const LEGACY_AUTH_ROLES: readonly AuthRole[] = ["ADMIN", "ANALYST", "VIEWER"];
export const FOUNDATION_ROLES: readonly FoundationRole[] = ["PRODUCT_OWNER", "PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"];

export function legacyAuthRoleToCanonical(role: AuthRole): CanonicalProductRole {
  if (role === "ADMIN") return "SUPER_ADMIN";
  if (role === "ANALYST") return "ADMIN";
  if (role === "VIEWER") return "AGENT";
  throw new Error("ROLE_INVALID");
}

export function canonicalToLegacyRuntimeRole(role: CanonicalProductRole): AuthRole {
  if (role === "SUPER_ADMIN") return "ADMIN";
  if (role === "ADMIN") return "ANALYST";
  if (role === "AGENT") return "VIEWER";
  throw new Error("ROLE_INVALID");
}

export function foundationRoleToCanonical(role: FoundationRole): CanonicalProductRole {
  if (role === "PRODUCT_OWNER" || role === "PLATFORM_OWNER" || role === "TENANT_ADMIN") return "SUPER_ADMIN";
  if (role === "SALES_MANAGER") return "ADMIN";
  if (role === "SALES_OPERATOR") return "AGENT";
  throw new Error("ROLE_INVALID");
}

export function canonicalToFoundationRole(role: CanonicalProductRole): FoundationRole {
  if (role === "SUPER_ADMIN") return "PLATFORM_OWNER";
  if (role === "ADMIN") return "SALES_MANAGER";
  if (role === "AGENT") return "SALES_OPERATOR";
  throw new Error("ROLE_INVALID");
}

export function canonicalProductRole(role: AuthRole | FoundationRole | CanonicalProductRole): CanonicalProductRole {
  if (CANONICAL_PRODUCT_ROLES.includes(role as CanonicalProductRole)) return role as CanonicalProductRole;
  if (LEGACY_AUTH_ROLES.includes(role as AuthRole)) return legacyAuthRoleToCanonical(role as AuthRole);
  if (FOUNDATION_ROLES.includes(role as FoundationRole)) return foundationRoleToCanonical(role as FoundationRole);
  throw new Error("ROLE_INVALID");
}

export function canManageCanonicalRole(actor: CanonicalProductRole, target: CanonicalProductRole): boolean {
  if (actor === "AGENT") return false;
  if (actor === "ADMIN") return target !== "SUPER_ADMIN";
  return true;
}
