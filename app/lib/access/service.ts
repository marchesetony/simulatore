import { randomUUID } from "node:crypto";
import type { AuthenticatedPrincipal, AuthRole } from "../auth/types";
import type { FoundationMembershipRecord, TenantRecord } from "../persistence/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { permissionsForMembershipRole } from "../foundation/memberships.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PLATFORM_TENANT_ID } from "./types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildOrgChainIndex, childUserIds, ORG_LEVELS, orgNodeRecordId, saveOrgNode, subtreeUserIds } from "../hierarchy/service.ts";
import type { HierarchyActor } from "../hierarchy/service";
import type { OrgLevel } from "../hierarchy/types";
import type { AccessAccount, AccessStores, AccountLevel, AccountStatus, Company } from "./types";

const TENANT_PATTERN = /^tenant_[a-z0-9-]+$/;
const USER_PATTERN = /^user_[a-z0-9-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ACCOUNT_LEVELS: readonly AccountLevel[] = ["AMMINISTRATORE", "DIRETTORE", "AREA_MANAGER", "AGENTE", "SUB_AGENTE"];
const LEVEL_ROLES: Readonly<Record<AccountLevel, { readonly foundation: FoundationMembershipRecord["role"]; readonly runtime: AuthRole }>> = {
  AMMINISTRATORE: { foundation: "TENANT_ADMIN", runtime: "ADMIN" },
  DIRETTORE: { foundation: "SALES_MANAGER", runtime: "ANALYST" },
  AREA_MANAGER: { foundation: "SALES_MANAGER", runtime: "ANALYST" },
  AGENTE: { foundation: "SALES_OPERATOR", runtime: "VIEWER" },
  SUB_AGENTE: { foundation: "SALES_OPERATOR", runtime: "VIEWER" },
};

function fail(code: string): never { throw new Error(code); }

export function isPlatformOwner(principal: Pick<AuthenticatedPrincipal, "tenantId" | "role">): boolean {
  return principal.tenantId === PLATFORM_TENANT_ID && principal.role === "ADMIN";
}

/** Company administrators manage their own team; the platform owner manages every company. */
export function canManageTeam(principal: Pick<AuthenticatedPrincipal, "tenantId" | "role">): boolean {
  return principal.tenantId !== PLATFORM_TENANT_ID && principal.role === "ADMIN";
}

/**
 * Tony (24/11/2026, "RIPRISTINO GESTIONE GERARCHICA"): besides the administrator (whole company), every responsabile manages
 * the people of their own branch of the chain, and only the levels below their own:
 * - direttore and area manager: agenti and sub-agenti of their branch;
 * - agente: only the sub-agenti assigned to them;
 * - sub-agente: nobody.
 * Nobody acts on themselves, on their superiors or on another branch; the company is always the caller's own.
 */
const BRANCH_LEVELS: Readonly<Partial<Record<AccountLevel, readonly AccountLevel[]>>> = { DIRETTORE: ["AGENTE", "SUB_AGENTE"], AREA_MANAGER: ["AGENTE", "SUB_AGENTE"], AGENTE: ["SUB_AGENTE"] };

export type TeamAuthority =
  | { readonly scope: "COMPANY"; readonly tenantId: string; readonly levels: readonly AccountLevel[] }
  | { readonly scope: "BRANCH"; readonly tenantId: string; readonly levels: readonly AccountLevel[]; readonly selfUserId: string; readonly branch: ReadonlySet<string> };

/** Who the caller may manage, read from their own account and their place in the chain; anything missing denies. */
export async function teamAuthority(stores: Pick<AccessStores, "accounts" | "orgChain">, principal: AuthenticatedPrincipal, requested?: unknown): Promise<TeamAuthority> {
  if (isPlatformOwner(principal) || canManageTeam(principal)) return { scope: "COMPANY", tenantId: managedTenant(principal, requested), levels: ACCOUNT_LEVELS };
  if (principal.tenantId === PLATFORM_TENANT_ID) fail("ACCESS_DENIED");
  if (requested !== undefined && requested !== null && requested !== principal.tenantId) fail("ACCESS_DENIED");
  const tenantId = principal.tenantId;
  const own = await stores.accounts.get(tenantId, principal.userId);
  const levels = own && own.tenantId === tenantId && own.payload.tenantId === tenantId && own.payload.status === "ACTIVE" ? BRANCH_LEVELS[own.payload.level] : undefined;
  if (!own || !levels || LEVEL_ROLES[own.payload.level].runtime !== principal.role) fail("ACCESS_DENIED");
  const index = buildOrgChainIndex(await stores.orgChain.list(tenantId));
  if (index.nodes.get(principal.userId)?.payload.level !== own.payload.level) fail("ACCESS_DENIED");
  return { scope: "BRANCH", tenantId, levels, selfUserId: principal.userId, branch: subtreeUserIds(index, principal.userId) };
}

/** A branch responsabile acts only on people below them, at a level they manage. */
function assertManages(authority: TeamAuthority, account: AccessAccount): void {
  if (authority.scope === "COMPANY") return;
  if (account.userId === authority.selfUserId || !authority.branch.has(account.userId) || !authority.levels.includes(account.level)) fail("ACCESS_SCOPE_DENIED");
}

function assertLevelAllowed(authority: TeamAuthority, value: AccountLevel): void {
  if (!authority.levels.includes(value)) fail("ACCESS_LEVEL_NOT_ALLOWED");
}

/** The responsabile chosen by a branch manager is themselves or somebody of their branch. */
function assertParentInBranch(authority: TeamAuthority, parentUserId: string): void {
  if (authority.scope === "BRANCH" && !authority.branch.has(parentUserId)) fail("ACCESS_SCOPE_DENIED");
}

function defaultParent(authority: TeamAuthority): string | undefined { return authority.scope === "BRANCH" ? authority.selfUserId : undefined; }

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

function chainLevel(level: AccountLevel): OrgLevel | null { return level === "AMMINISTRATORE" ? null : level; }

// Whoever manages a team acts on its chain with company authority.
function chainActor(principal: AuthenticatedPrincipal, tenantId: string): HierarchyActor { return { userId: principal.userId, tenantId, role: "SUPER_ADMIN" }; }

async function placeInChain(stores: AccessStores, principal: AuthenticatedPrincipal, tenantId: string, input: { readonly userId: string; readonly level: OrgLevel; readonly parentUserId: string | null; readonly displayName: string }, now: string): Promise<void> {
  const memberships = (await stores.memberships.list(tenantId)).map((record) => record.payload);
  await saveOrgNode({ orgChain: stores.orgChain, memberships }, chainActor(principal, tenantId), input, now);
}

/** The company node at the top of the chain; companies created before the chain existed get it from their first administrator. */
async function companyRoot(stores: AccessStores, principal: AuthenticatedPrincipal, tenantId: string, now: string): Promise<string | null> {
  const index = buildOrgChainIndex(await stores.orgChain.list(tenantId));
  const root = [...index.nodes.values()].find((record) => record.payload.level === "AZIENDA");
  if (root) return root.payload.userId;
  const admin = (await stores.accounts.list(tenantId)).map((record) => record.payload).filter((account) => account.level === "AMMINISTRATORE" && account.status === "ACTIVE").sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
  if (!admin) return null;
  const company = await stores.companies.get(PLATFORM_TENANT_ID, tenantId);
  await placeInChain(stores, principal, tenantId, { userId: admin.userId, level: "AZIENDA", parentUserId: null, displayName: company?.payload.name ?? admin.displayName }, now);
  return admin.userId;
}

/** The responsabile must already sit in the chain at a higher level than the new account. */
async function resolveParent(stores: AccessStores, principal: AuthenticatedPrincipal, tenantId: string, level: OrgLevel, requested: unknown, now: string, fallback?: string): Promise<string> {
  const empty = requested === undefined || requested === null || requested === "";
  // A branch manager's people go under the manager by default; the company root is the administrator's default only.
  const parentUserId = empty ? fallback ?? await companyRoot(stores, principal, tenantId, now) : requested;
  if (typeof parentUserId !== "string" || !USER_PATTERN.test(parentUserId)) fail("ACCESS_PARENT_REQUIRED");
  const parent = buildOrgChainIndex(await stores.orgChain.list(tenantId)).nodes.get(parentUserId);
  if (!parent) fail("ACCESS_PARENT_NOT_FOUND");
  if (ORG_LEVELS.indexOf(parent.payload.level) >= ORG_LEVELS.indexOf(level)) fail("ACCESS_PARENT_LEVEL_INVALID");
  return parentUserId;
}

export async function createCompany(stores: AccessStores, principal: AuthenticatedPrincipal, body: Record<string, unknown>, now = new Date().toISOString()): Promise<{ readonly company: Company; readonly admin: AccessAccount }> {
  if (!isPlatformOwner(principal)) fail("ACCESS_DENIED");
  const name = text(body.name, "ACCESS_COMPANY_NAME_INVALID", 2, 120);
  const tenantId = companyTenantId(name);
  if (await stores.companies.get(PLATFORM_TENANT_ID, tenantId)) fail("ACCESS_COMPANY_EXISTS");
  const admin = typeof body.admin === "object" && body.admin !== null && !Array.isArray(body.admin) ? body.admin as Record<string, unknown> : fail("ACCESS_ADMIN_REQUIRED");
  const account = await provisionAccount(stores, { tenantId, email: normalizeEmail(admin.email), displayName: text(admin.displayName, "ACCESS_NAME_INVALID", 2, 120), level: "AMMINISTRATORE", password: validatePassword(admin.password), createdBy: principal.userId, now });
  const company = await stores.companies.put({ tenantId: PLATFORM_TENANT_ID, recordId: tenantId, payload: { tenantId, name, createdBy: principal.userId, createdAt: now }, now });
  await placeInChain(stores, principal, tenantId, { userId: account.payload.userId, level: "AZIENDA", parentUserId: null, displayName: name }, now);
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
  const authority = await teamAuthority(stores, principal, body.tenantId);
  const tenantId = authority.tenantId;
  if (isPlatformOwner(principal) && !(await stores.companies.get(PLATFORM_TENANT_ID, tenantId))) fail("ACCESS_COMPANY_NOT_FOUND");
  const input = { tenantId, email: normalizeEmail(body.email), displayName: text(body.displayName, "ACCESS_NAME_INVALID", 2, 120), level: level(body.level), password: validatePassword(body.password), createdBy: principal.userId, now };
  assertLevelAllowed(authority, input.level);
  const orgLevel = chainLevel(input.level);
  const parentUserId = orgLevel === null ? null : await resolveParent(stores, principal, tenantId, orgLevel, body.parentUserId, now, defaultParent(authority));
  if (parentUserId !== null) assertParentInBranch(authority, parentUserId);
  const record = await provisionAccount(stores, input);
  if (orgLevel !== null) await placeInChain(stores, principal, tenantId, { userId: record.payload.userId, level: orgLevel, parentUserId, displayName: input.displayName }, now);
  return record.payload;
}

export async function listTeam(stores: AccessStores, principal: AuthenticatedPrincipal, requestedTenantId?: unknown): Promise<readonly (AccessAccount & { readonly version: number; readonly chainLevel: OrgLevel | null; readonly parentUserId: string | null; readonly manageable: boolean })[]> {
  const authority = await teamAuthority(stores, principal, requestedTenantId);
  const tenantId = authority.tenantId;
  const [accounts, nodes] = await Promise.all([stores.accounts.list(tenantId), stores.orgChain.list(tenantId)]);
  const index = buildOrgChainIndex(nodes);
  // A branch manager sees themselves and their branch only: never superiors or other branches.
  const visible = authority.scope === "COMPANY" ? accounts : accounts.filter((record) => authority.branch.has(record.payload.userId));
  const manageable = (account: AccessAccount) => { if (account.userId === principal.userId) return false; try { assertManages(authority, account); return true; } catch { return false; } };
  return visible.map((record) => { const node = index.nodes.get(record.payload.userId)?.payload; return { ...record.payload, version: record.version, chainLevel: node?.level ?? null, parentUserId: node?.parentUserId ?? null, manageable: manageable(record.payload) }; }).sort(byName);
}

export async function setAccountStatus(stores: AccessStores, principal: AuthenticatedPrincipal, body: Record<string, unknown>, now = new Date().toISOString()): Promise<AccessAccount> {
  const authority = await teamAuthority(stores, principal, body.tenantId);
  const tenantId = authority.tenantId;
  const userId = typeof body.userId === "string" && USER_PATTERN.test(body.userId) ? body.userId : fail("ACCESS_USER_INVALID");
  const status: AccountStatus = body.status === "ACTIVE" || body.status === "SUSPENDED" ? body.status : fail("ACCESS_STATUS_INVALID");
  if (userId === principal.userId) fail("ACCESS_SELF_EDIT_DENIED");
  const current = await stores.accounts.get(tenantId, userId);
  if (!current) fail("ACCESS_USER_NOT_FOUND");
  assertManages(authority, current.payload);
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion !== current.version) fail("PERSISTENCE_VERSION_CONFLICT");
  await stores.directory.setMembership({ userId, tenantId, role: LEVEL_ROLES[current.payload.level].runtime, status });
  const membership = await stores.memberships.get(tenantId, membershipId(userId));
  if (membership) await stores.memberships.put({ tenantId, recordId: membership.recordId, payload: { ...membership.payload, status, updatedAt: now }, expectedVersion: membership.version, now });
  return (await stores.accounts.put({ tenantId, recordId: userId, payload: { ...current.payload, status }, expectedVersion: current.version, now })).payload;
}

/**
 * Tony (24/11/2026, "PERMESSI GERARCHICI"): the administrator changes the role of a person of the company and, with it, the
 * responsabile (e.g. a sub-agente moved under another agente, an agente promoted to area manager). Server-side rules:
 * - only who manages the team of that company (its administrator, or the platform owner), never on their own account;
 * - the chain levels only: administrators are created and suspended, never converted to or from another role;
 * - the responsabile must be above the new level and the people below must stay below it (no cycles);
 * - login role, membership permissions, account and chain change together; the person's open sessions stop being valid
 *   because the role they were issued for no longer matches (they sign in again with the new role).
 * Nothing is written when a check fails; a failure after the first write restores what was already written.
 */
export async function changeAccountLevel(stores: AccessStores, principal: AuthenticatedPrincipal, body: Record<string, unknown>, now = new Date().toISOString()): Promise<{ readonly account: AccessAccount; readonly previousLevel: AccountLevel; readonly parentUserId: string }> {
  const authority = await teamAuthority(stores, principal, body.tenantId);
  const tenantId = authority.tenantId;
  const userId = typeof body.userId === "string" && USER_PATTERN.test(body.userId) ? body.userId : fail("ACCESS_USER_INVALID");
  if (userId === principal.userId) fail("ACCESS_SELF_EDIT_DENIED");
  const nextLevel = level(body.level);
  const current = await stores.accounts.get(tenantId, userId);
  if (!current) fail("ACCESS_USER_NOT_FOUND");
  assertManages(authority, current.payload);
  if (nextLevel !== "AMMINISTRATORE") assertLevelAllowed(authority, nextLevel);
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion !== current.version) fail("PERSISTENCE_VERSION_CONFLICT");
  if (current.payload.level === "AMMINISTRATORE" || nextLevel === "AMMINISTRATORE") fail("ACCESS_LEVEL_CHANGE_ADMIN");
  if (current.payload.status !== "ACTIVE") fail("ACCESS_USER_SUSPENDED");
  const orgLevel = nextLevel as OrgLevel;
  const parentUserId = await resolveParent(stores, principal, tenantId, orgLevel, body.parentUserId, now, defaultParent(authority));
  assertParentInBranch(authority, parentUserId);
  const index = buildOrgChainIndex(await stores.orgChain.list(tenantId));
  const existing = index.nodes.get(userId) ?? null;
  if (parentUserId === userId || (existing && subtreeUserIds(index, userId).has(parentUserId))) fail("ACCESS_PARENT_LEVEL_INVALID");
  if (existing && childUserIds(index, userId).some((childId) => ORG_LEVELS.indexOf((index.nodes.get(childId) as NonNullable<typeof existing>).payload.level) <= ORG_LEVELS.indexOf(orgLevel))) fail("ACCESS_CHILDREN_LEVEL_CONFLICT");
  const roles = LEVEL_ROLES[nextLevel];
  const previousRoles = LEVEL_ROLES[current.payload.level];
  const membershipRecord = await stores.memberships.get(tenantId, membershipId(userId));
  if (!membershipRecord) fail("ACCESS_USER_NOT_FOUND");
  const nextMembership: FoundationMembershipRecord = { ...membershipRecord.payload, role: roles.foundation, permissions: [...permissionsForMembershipRole(roles.foundation)], updatedAt: now };
  // The chain is checked against the membership the person will have, before anything is written.
  const memberships = (await stores.memberships.list(tenantId)).map((record) => record.payload.userId === userId ? nextMembership : record.payload);
  const keep = existing?.payload;
  const saved = await saveOrgNode({ orgChain: stores.orgChain, memberships }, chainActor(principal, tenantId), { userId, level: orgLevel, parentUserId, displayName: keep?.displayName ?? current.payload.displayName, limits: keep?.limits, canAuthorizeCte: keep?.canAuthorizeCte, canDelegateCte: keep?.canDelegateCte, canManageDiscount: keep?.canManageDiscount, expectedVersion: existing?.version }, now);
  const restoreChain = async () => {
    const recordId = orgNodeRecordId(tenantId, userId);
    if (existing) await stores.orgChain.put({ tenantId, recordId, payload: existing.payload, expectedVersion: saved.version, now });
    else await stores.orgChain.delete({ tenantId, recordId, expectedVersion: saved.version });
  };
  let membershipVersion: number | null = null;
  let directoryChanged = false;
  try {
    membershipVersion = (await stores.memberships.put({ tenantId, recordId: membershipRecord.recordId, payload: nextMembership, expectedVersion: membershipRecord.version, now })).version;
    await stores.directory.setMembership({ userId, tenantId, role: roles.runtime, status: "ACTIVE" });
    directoryChanged = true;
    const account = await stores.accounts.put({ tenantId, recordId: userId, payload: { ...current.payload, level: nextLevel }, expectedVersion: current.version, now });
    return { account: account.payload, previousLevel: current.payload.level, parentUserId };
  } catch (error) {
    if (directoryChanged) await stores.directory.setMembership({ userId, tenantId, role: previousRoles.runtime, status: "ACTIVE" }).catch(() => undefined);
    if (membershipVersion !== null) await stores.memberships.put({ tenantId, recordId: membershipRecord.recordId, payload: membershipRecord.payload, expectedVersion: membershipVersion, now }).catch(() => undefined);
    await restoreChain().catch(() => undefined);
    throw error;
  }
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
