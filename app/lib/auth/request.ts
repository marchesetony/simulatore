// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolvePrincipal } from "./adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { requireAuthorization } from "./authorization.ts";
import type { AccessLevel, AuthenticatedPrincipal } from "./types";

function defaultAccess(request: Request): AccessLevel { return request.method === "GET" || request.method === "HEAD" ? "READ" : "WRITE"; }

export async function requireRequestAccess(request: Request, access: AccessLevel = defaultAccess(request), requestedTenantId?: string): Promise<AuthenticatedPrincipal> {
  const principal = await resolvePrincipal(request);
  await requireAuthorization(principal, access, requestedTenantId);
  return principal;
}

export async function requestPrincipal(request: Request, access?: AccessLevel): Promise<AuthenticatedPrincipal> { return requireRequestAccess(request, access); }
export async function requestTenant(request: Request, access?: AccessLevel): Promise<string> { return (await requireRequestAccess(request, access)).tenantId; }
