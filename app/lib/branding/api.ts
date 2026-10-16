import { AuthenticationError } from "../auth/errors";
import type { AuthenticatedPrincipal } from "../auth/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { getRuntimeConfig } from "../auth/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runtimeRepositories } from "../persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { BRANDING_CORRELATION_ID, readTenantBranding, saveTenantBranding } from "./service.ts";
import type { TenantBrandingRepository } from "./service";
import type { TenantBrandingInput, TenantBrandingView } from "./types";

const noStore = { "cache-control": "no-store, private", "x-content-type-options": "nosniff" };

function brandingRepository(): TenantBrandingRepository | null { return runtimeRepositories().tenantBranding ?? null; }
function syntheticAllowed(): boolean { return getRuntimeConfig().runtimeMode === "local"; }

/** Branding used on screen and in printable exports; local synthetic mode falls back to invented company data. */
export async function runtimeTenantBranding(tenantId: string): Promise<TenantBrandingView | null> {
  const repository = brandingRepository();
  return repository ? readTenantBranding(repository, tenantId, syntheticAllowed()) : null;
}

export async function brandingResponse(tenantId: string): Promise<Response> {
  return Response.json({ branding: await runtimeTenantBranding(tenantId) }, { headers: noStore });
}

export async function saveBrandingResponse(body: Record<string, unknown>, principal: AuthenticatedPrincipal): Promise<Response> {
  const repository = brandingRepository();
  if (!repository) throw new Error("BRANDING_STORAGE_UNAVAILABLE");
  const branding = await saveTenantBranding(repository, principal.tenantId, body as TenantBrandingInput);
  await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "TENANT_BRANDING_UPDATE", resourceType: "TENANT_BRANDING", outcome: "ALLOWED", correlationId: BRANDING_CORRELATION_ID, metadata: { version: branding.version, logo: branding.logo !== null } });
  return Response.json({ branding }, { headers: noStore });
}

export function brandingError(error: unknown): Response {
  const code = error instanceof AuthenticationError ? error.code : error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "BRANDING_REQUEST_INVALID";
  const status = error instanceof AuthenticationError
    ? code === "AUTHORIZATION_DENIED" || code === "TENANT_MISMATCH" ? 403 : code.startsWith("AUTH_") ? 503 : 401
    : code === "BRANDING_VERSION_CONFLICT" ? 409 : code === "BRANDING_STORAGE_UNAVAILABLE" ? 503 : code === "BRANDING_LOGO_TOO_LARGE" ? 413 : 400;
  return Response.json({ error: { code, message: "Branding request denied", correlationId: BRANDING_CORRELATION_ID } }, { status, headers: noStore });
}
