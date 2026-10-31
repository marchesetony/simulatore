import type { AuthenticatedPrincipal } from "../auth/types";
import { AuthenticationError } from "../auth/errors";
import { recordMutationAudit } from "../auth/mutation-audit";
import { runtimeRepositories } from "../persistence/adapter";
import { canManageTeam, changeOwnPassword, createAccount, createCompany, isPlatformOwner, listCompanies, listTeam, setAccountStatus } from "./service";
import type { AccessStores } from "./types";

const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };

function stores(): AccessStores {
  const repositories = runtimeRepositories();
  return { companies: repositories.companies, accounts: repositories.accessAccounts, memberships: repositories.foundationMemberships, orgChain: repositories.orgChain, directory: repositories.accessDirectory };
}

/** What the signed-in person may manage: drives which access screens the shell shows. */
export function accessCapabilitiesResponse(principal: AuthenticatedPrincipal): Response {
  return Response.json({ userId: principal.userId, platformOwner: isPlatformOwner(principal), teamManager: canManageTeam(principal) }, { headers: HEADERS });
}

export async function companiesResponse(principal: AuthenticatedPrincipal): Promise<Response> {
  return Response.json({ companies: await listCompanies(stores(), principal) }, { headers: HEADERS });
}

export async function createCompanyResponse(principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<Response> {
  const result = await createCompany(stores(), principal, body);
  await recordMutationAudit({ principal, action: "COMPANY_CREATED", resourceType: "COMPANY", resourceId: result.company.tenantId, targetUserId: result.admin.userId, metadata: { level: result.admin.level } });
  return Response.json(result, { status: 201, headers: HEADERS });
}

export async function teamResponse(principal: AuthenticatedPrincipal, tenantId: string | null): Promise<Response> {
  return Response.json({ accounts: await listTeam(stores(), principal, tenantId ?? undefined) }, { headers: HEADERS });
}

export async function createAccountResponse(principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<Response> {
  const account = await createAccount(stores(), principal, body);
  await recordMutationAudit({ principal, action: "ACCOUNT_CREATED", resourceType: "ACCOUNT", resourceId: account.userId, targetUserId: account.userId, metadata: { level: account.level, tenantId: account.tenantId } });
  return Response.json({ account }, { status: 201, headers: HEADERS });
}

export async function accountStatusResponse(principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<Response> {
  const account = await setAccountStatus(stores(), principal, body);
  await recordMutationAudit({ principal, action: account.status === "ACTIVE" ? "ACCOUNT_REACTIVATED" : "ACCOUNT_SUSPENDED", resourceType: "ACCOUNT", resourceId: account.userId, targetUserId: account.userId, metadata: { tenantId: account.tenantId } });
  return Response.json({ account }, { headers: HEADERS });
}

export async function changePasswordResponse(principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<Response> {
  await changeOwnPassword(stores(), principal, body);
  await recordMutationAudit({ principal, action: "PASSWORD_CHANGED", resourceType: "ACCOUNT", resourceId: principal.userId, targetUserId: principal.userId, metadata: {} });
  return Response.json({ changed: true }, { headers: HEADERS });
}

export function accessError(error: unknown): Response {
  const code = error instanceof AuthenticationError ? error.code : error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "ACCESS_REQUEST_INVALID";
  const status = error instanceof AuthenticationError
    ? code === "AUTHORIZATION_DENIED" || code === "TENANT_MISMATCH" ? 403 : code.startsWith("AUTH_") ? 503 : 401
    : code === "ACCESS_DENIED" || code === "ACCESS_SELF_EDIT_DENIED" ? 403
    : code.endsWith("_NOT_FOUND") ? 404
    : code === "ACCESS_EMAIL_TAKEN" || code === "ACCESS_COMPANY_EXISTS" || code === "PERSISTENCE_VERSION_CONFLICT" ? 409
    : code === "ACCESS_DIRECTORY_UNAVAILABLE" || code === "HIERARCHY_STORAGE_UNAVAILABLE" ? 503 : 422;
  return Response.json({ error: { code, message: "Access request denied" } }, { status, headers: HEADERS });
}
