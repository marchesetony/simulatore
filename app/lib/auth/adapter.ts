// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { authFail, AuthenticationError } from "./errors.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { getRuntimeConfig } from "./config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";
import type { AuthenticatedPrincipal } from "./types";

const safeFailureCategories = ["AUTH_CONFIGURATION_INVALID", "AUTH_ADAPTER_UNAVAILABLE", "AUTHENTICATION_REQUIRED", "AUTHENTICATION_EXPIRED", "AUTHENTICATION_INVALID"] as const;
type SafeFailureCategory = typeof safeFailureCategories[number];

export interface ServerSessionAdapter {
  resolve(request: Request): AuthenticatedPrincipal | null | Promise<AuthenticatedPrincipal | null>;
}

let productionAdapter: ServerSessionAdapter | null = null;

export function registerProductionSessionAdapter(adapter: ServerSessionAdapter): void {
  if (typeof adapter?.resolve !== "function") authFail("AUTH_ADAPTER_UNAVAILABLE");
  productionAdapter = adapter;
}
export function clearProductionSessionAdapter(): void { productionAdapter = null; }
export function productionSessionAdapterConfigured(): boolean { return productionAdapter !== null; }

function assertPrincipal(principal: AuthenticatedPrincipal, now: Date): AuthenticatedPrincipal {
  if (typeof principal !== "object" || principal === null) authFail("AUTHENTICATION_INVALID");
  if (!/^user_[a-z0-9-]+$/.test(principal.userId) || !/^tenant_[a-z0-9-]+$/.test(principal.tenantId) || !/^session_[a-z0-9-]+$/.test(principal.sessionId)) authFail("AUTHENTICATION_INVALID");
  if (!["ADMIN", "ANALYST", "VIEWER"].includes(principal.role)) authFail("AUTHENTICATION_INVALID");
  if (!Number.isFinite(Date.parse(principal.issuedAt)) || !Number.isFinite(Date.parse(principal.expiresAt)) || Date.parse(principal.expiresAt) <= now.getTime() || Date.parse(principal.issuedAt) > now.getTime()) authFail("AUTHENTICATION_EXPIRED");
  if (principal.source !== "VERIFIED_SESSION") authFail("AUTHENTICATION_INVALID");
  return Object.freeze({ ...principal });
}

function failureCategory(error: unknown): SafeFailureCategory {
  if (error instanceof AuthenticationError && safeFailureCategories.includes(error.code as SafeFailureCategory)) return error.code as SafeFailureCategory;
  if (error instanceof Error && error.message.startsWith("AUTH_CONFIGURATION_INVALID")) return "AUTH_CONFIGURATION_INVALID";
  return "AUTHENTICATION_INVALID";
}

async function persistAuthenticationFailure(error: unknown): Promise<void> {
  const category = failureCategory(error);
  try { await recordRuntimeAudit({ action: "AUTHENTICATION_FAILURE", resourceType: "AUTHENTICATION", outcome: "FAILED", correlationId: "phase6-authentication", metadata: { failureCategory: category } }); }
  catch { console.error("phase6-auth-audit-failure", { category }); }
}

export async function resolvePrincipal(request: Request, now = new Date()): Promise<AuthenticatedPrincipal> {
  let principal: AuthenticatedPrincipal;
  try {
    const config = getRuntimeConfig();
    if (config.runtimeMode === "local") principal = Object.freeze({ userId: "user_local-dev", tenantId: config.localTenantId, role: config.localRole, sessionId: "session_local-dev", issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" });
    else {
      // @ts-expect-error Node's strip-only test runner requires the explicit extension.
      const { bootstrapProductionRuntime } = await import("../production/bootstrap.ts");
      bootstrapProductionRuntime();
      if (!productionAdapter) authFail("AUTH_ADAPTER_UNAVAILABLE");
      let resolved: AuthenticatedPrincipal | null;
      try { resolved = await productionAdapter.resolve(request); } catch { authFail("AUTHENTICATION_INVALID"); }
      if (!resolved) authFail("AUTHENTICATION_REQUIRED");
      principal = assertPrincipal(resolved, now);
    }
  } catch (error) {
    await persistAuthenticationFailure(error);
    throw error;
  }
  try { await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "AUTHENTICATION_SUCCESS", resourceType: "AUTHENTICATION", outcome: "ALLOWED", correlationId: "phase6-authentication", metadata: { source: principal.source } }); }
  catch { authFail("AUTH_AUDIT_UNAVAILABLE"); }
  return principal;
}
