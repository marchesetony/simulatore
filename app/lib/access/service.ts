import { randomUUID } from "node:crypto";
import type { AuthenticatedPrincipal, AuthRole } from "../auth/types";
import type { FoundationMembershipRecord, TenantRecord } from "../persistence/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { permissionsForMembershipRole } from "../foundation/memberships.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PLATFORM_TENANT_ID } from "./types.ts";
import type { AccessAccount, AccessStores, AccountLevel, AccountStatus, Company } from "./types";

const TENANT_PATTERN = /^tenant_[a-z0-9-]+$/;
const USER_PATTERN = /^user_[a-z0-9-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ACCOUNT_LEVELS: readonly AccountLevel[] = ["AMMINISTRATORE", "DIRETTORE", "AREA_MANAGER", "AGENTE"];
const LEVEL_ROLES: Readonly<Record<AccountLevel, { readonly foundation: FoundationMembershipRecord["role"]; readonly runtime: AuthRole }>> = {
  AMMINISTRATORE: { foundation: "TENANT_ADMIN", runtime: "ADMIN" },
  DIRETTORE: { foundation: "SALES_MANAGER", runtime: "ANALYST" },
  AREA_MANAGER: { foundation: "SALES_MANAGER", runtime: "ANALYST" },
  AGENTE: { foundation: "SALES_OPERATOR", runtime: "VIEWER" },
};

function fail(code: string): never { throw new Error(code); }

export function isPlatformOwner(principal: Pick<AuthenticatedPrincipal, "tenantId" | "role">): boolean {
  return principal.tenantId === PLATFORM_TENANT_ID && principal.role === "ADMIN";
}

/** Company administrators manage their own team; the platform owner manages every company. */
export function canManageTeam(principal: Pick<AuthenticatedPrincipal, "tenantId" | "role">): boolean {
  return principal.tenantId !== PLATFORM_TENANT_ID && principal.role === "ADMIN";
}

function managedTenant(principal: AuthenticatedPrincipal, requested: unknown): string {
  if (isPlatformOwner(principal)) {
    if (typeof requested !== "string" || !TENANT_PATTERN.test(requested) || requested === PLATFORM_TENANT_ID) fail("ACCESS_COMPANY_REQUIRED");
    return requested;
  }
  if (!canManageTeam(principal)) fail("ACCESS_DENIED");
  if (requested !== undefined && requested !== principal.tenantId) fail("ACCESS_DENIED");
  return principal.tenantId;
}

function text(value: unknown, code: string, min: number, max: number): string {
  if (typeof value !== "string") fail(code);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < min || trimmed.length > max) fail(code);
  return trimmed;
}

export function normalizeEmail(value: unknown): string {
  const email = text(value, "ACCESS_EMAIL_INVALID", 3, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail("ACCESS_EMAIL_INVALID");
  return email;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 128 || value.trim() !== value) fail("ACCESS_PASSWORD_WEAK");
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) fail("ACCESS_PASSWORD_WEAK");
  return value;
}

function level(value: unknown): AccountLevel {
  if (typeof value !== "string" || !ACCOUNT_LEVELS.includes(value as AccountLevel)) fail("ACCESS_LEVEL_INVALID");
  return value as AccountLevel;
}

/** "Lumenica Energia S.r.l." becomes tenant_lumenica-energia-srl. */
export function companyTenantId(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  if (!slug || slug === "piattaforma") fail("ACCESS_COMPANY_NAME_INVALID");
  return `tenant_${slug}`;
}

function membershipId(userId: string): string { return `membership_${userId.slice("user_".length)}`; }

async function provisionAccount(stores: AccessStores, input: { readonly tenantId: string; readonly email: string; readonly displayName: string; readonly level: AccountLevel; readonly password: string; readonly createdBy: string; readonly now: string }): Promise<TenantRecord<AccessAccount>> {
  const roles = LEVEL_ROLES[input.level];
  const userId = `user_${randomUUID()}`;
  const { authUserId } = await stores.directory.createLogin({ email: input.email, password: input.password, displayName: input.displayName });
  try {
    await stores.directory.linkUser({ userId, authUserId, displayName: input.displayName });
    await stores.directory.setMembership({ userId, tenantId: input.tenantId, role: roles.runtime, status: "ACTIVE" });
    await stores.memberships.put({ tenantId: input.tenantId, recordId: membershipId(userId), payload: { id: membershipId(userId), userId, tenantId: input.tenantId, role: roles.foundation, status: "ACTIVE", permissions: [...permissionsForMembershipRole(roles.foundation)], createdAt: input.now, updatedAt: input.now }, now: input.now });
    return await stores.accounts.put({ tenantId: input.tenantId, recordId: userId, payload: { userId, tenantId: input.tenantId, email: input.email, displayName: input.displayName, level: input.level, status: "ACTIVE", createdBy: input.createdBy, createdAt: input.now }, now: input.now });
  } catch (error) {
    const membership = await stores.memberships.get(input.tenantId, membershipId(userId)).catch(() => null);
    if (membership) await stores.memberships.delete({ tenantId: input.tenantId, recordId: membership.recordId, expectedVersion: membership.version }).catch(() => undefined);
    await stores.directory.removeLogin({ userId, authUserId }).catch(() => undefined);
    throw error;
  }
}

export async function createCompany(stores: AccessStores, principal: AuthenticatedPrincipal, body: Record<string, unknown>, now = new Date().toISOString()): Promise<{ readonly company: Company; readonly admin: AccessAccount }> {
  if (!isPlatformOwner(principal)) fail("ACCESS_DENIED");
  const name = text(body.name, "ACCESS_COMPANY_NAME_INVALID", 2, 120);
  const tenantId = companyTenantId(name);
  if (await stores.companies.get(PLATFORM_TENANT_ID, tenantId)) fail("ACCESS_COMPANY_EXISTS");
  const admin = typeof body.admin === "object" && body.admin !== null && !Array.isArray(body.admin) ? body.admin as Record<string, unknown> : fail("ACCESS_ADMIN_REQUIRED");
  const account = await provisionAccount(stores, { tenantId, email: normalizeEmail(admin.email), displayName: text(admin.displayName, "ACCESS_NAME_INVALID", 2, 120), level: "AMMINISTRATORE", password: validatePassword(admin.password), createdBy: principal.userId, now });
  const company = await stores.companies.put({ tenantId: PLATFORM_TENANT_ID, recordId: tenantId, payload: { tenantId, name, createdBy: principal.userId, createdAt: now }, now });
  return { company: company.payload, admin: account.payload };
}

export async function listCompanies(stores: AccessStores, principal: AuthenticatedPrincipal): Promise<readonly (Company & { readonly accounts: readonly AccessAccount[] })[]> {
  if (!isPlatformOwner(principal)) fail("ACCESS_DENIED");
  const companies = await stores.companies.list(PLATFORM_TENANT_ID);
  return Promise.all(companies.map(async (record) => ({ ...record.payload, accounts: (await stores.accounts.list(record.payload.tenantId)).map((item) => item.payload).sort(byName) })))
    .then((items) => items.sort((left, right) => left.name.localeCompare(right.name)));
}

function byName(left: AccessAccount, right: AccessAccount): number { return left.displayName.localeCompare(right.displayName) || left.userId.localeCompare(right.userId); }

export async function createAccount(stores: AccessStores, principal: AuthenticatedPrincipal, body: Record<string, unknown>, now = new Date().toISOString()): Promise<AccessAccount> {
  const tenantId = managedTenant(principal, body.tenantId);
  if (isPlatformOwner(principal) && !(await stores.companies.get(PLATFORM_TENANT_ID, tenantId))) fail("ACCESS_COMPANY_NOT_FOUND");
  const record = await provisionAccount(stores, { tenantId, email: normalizeEmail(body.email), displayName: text(body.displayName, "ACCESS_NAME_INVALID", 2, 120), level: level(body.level), password: validatePassword(body.password), createdBy: principal.userId, now });
  return record.payload;
}

export async function listTeam(stores: AccessStores, principal: AuthenticatedPrincipal, requestedTenantId?: unknown): Promise<readonly (AccessAccount & { readonly version: number })[]> {
  const tenantId = managedTenant(principal, requestedTenantId);
  return (await stores.accounts.list(tenantId)).map((record) => ({ ...record.payload, version: record.version })).sort(byName);
}

export async function setAccountStatus(stores: AccessStores, principal: AuthenticatedPrincipal, body: Record<string, unknown>, now = new Date().toISOString()): Promise<AccessAccount> {
  const tenantId = managedTenant(principal, body.tenantId);
  const userId = typeof body.userId === "string" && USER_PATTERN.test(body.userId) ? body.userId : fail("ACCESS_USER_INVALID");
  const status: AccountStatus = body.status === "ACTIVE" || body.status === "SUSPENDED" ? body.status : fail("ACCESS_STATUS_INVALID");
  if (userId === principal.userId) fail("ACCESS_SELF_EDIT_DENIED");
  const current = await stores.accounts.get(tenantId, userId);
  if (!current) fail("ACCESS_USER_NOT_FOUND");
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion !== current.version) fail("PERSISTENCE_VERSION_CONFLICT");
  await stores.directory.setMembership({ userId, tenantId, role: LEVEL_ROLES[current.payload.level].runtime, status });
  const membership = await stores.memberships.get(tenantId, membershipId(userId));
  if (membership) await stores.memberships.put({ tenantId, recordId: membership.recordId, payload: { ...membership.payload, status, updatedAt: now }, expectedVersion: membership.version, now });
  return (await stores.accounts.put({ tenantId, recordId: userId, payload: { ...current.payload, status }, expectedVersion: current.version, now })).payload;
}

export async function changeOwnPassword(stores: Pick<AccessStores, "directory">, principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<void> {
  if (typeof body.currentPassword !== "string" || body.currentPassword.length === 0) fail("ACCESS_PASSWORD_INCORRECT");
  const next = validatePassword(body.newPassword);
  if (next === body.currentPassword) fail("ACCESS_PASSWORD_UNCHANGED");
  const login = await stores.directory.loginFor(principal.userId);
  if (!login) fail("ACCESS_LOGIN_NOT_FOUND");
  const verified = await stores.directory.verifyPassword(login.email, body.currentPassword);
  if (verified !== login.authUserId) fail("ACCESS_PASSWORD_INCORRECT");
  await stores.directory.setPassword(login.authUserId, next);
}
