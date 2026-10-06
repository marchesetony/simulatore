import { AuthError } from "../../core/errors/auth-error";
import type { Credentials, Role, Permission } from "./types";

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("ACCESS_CONFIGURATION_INVALID");
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) {
    throw new AuthError("ACCESS_CONFIGURATION_INVALID");
  }
  return value;
}

export function canonicalRole(value: unknown): Role {
  if (["PRODUCT_OWNER", "ADMIN", "ANALYST", "VIEWER"].includes(String(value))) {
    throw new AuthError("LEGACY_ROLE_REQUIRES_REVIEW");
  }
  if (value === "PLATFORM_OWNER" || value === "TENANT_ADMIN" ||
      value === "SALES_MANAGER" || value === "SALES_OPERATOR") return value;
  throw new AuthError("ACCESS_CONFIGURATION_INVALID");
}

export function permissions(value: unknown): readonly Permission[] {
  if (!Array.isArray(value) || value.some(p => p !== "auth:login" && p !== "auth:session") ||
      new Set(value).size !== value.length) throw new AuthError("ACCESS_CONFIGURATION_INVALID");
  return Object.freeze([...value]) as readonly Permission[];
}

export function credentials(value: unknown): Credentials {
  const row = record(value);
  if (Object.keys(row).length !== 2 || typeof row.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || row.email.length > 254 ||
      typeof row.password !== "string" || !row.password || row.password.length > 1024) {
    throw new AuthError("INVALID_CREDENTIALS");
  }
  return { email: row.email, password: row.password };
}
