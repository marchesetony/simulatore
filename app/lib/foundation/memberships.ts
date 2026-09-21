// Domain-only membership lifecycle. Persistence adapters implement this port;
// this module does not select or access a storage provider.
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ImmutablePermissions, canonicalTimestamp, isValidTimestamp } from "./types.ts";
import type { Identity, IsoDateTime, Membership, MembershipId, Permission, Role, TenantId, UserId } from "./types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { requirePermission } from "./authorization.ts";
import type { TenantContext } from "./tenants.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { canManageCanonicalRole, foundationRoleToCanonical } from "../auth/roles.ts";

export interface MembershipRecord extends Membership {
  readonly version: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
}

export interface MembershipRepository {
  get(tenantId: TenantId, membershipId: MembershipId): Promise<MembershipRecord | null>;
  list(tenantId: TenantId): Promise<readonly MembershipRecord[]>;
  append(input: { readonly record: MembershipRecord }): Promise<MembershipRecord>;
  put(input: { readonly record: MembershipRecord; readonly expectedVersion: number }): Promise<MembershipRecord>;
}

export interface CreateMembershipInput {
  readonly actor: TenantContext;
  readonly identity: Identity;
  readonly membershipId: MembershipId;
  readonly tenantId: TenantId;
  readonly role: Role;
  readonly permissions: ReadonlyArray<Permission>;
  readonly now: IsoDateTime;
}

export interface AssignMembershipManagerInput extends MembershipMutationInput {
  readonly managerUserId: UserId | null;
}

export interface MembershipMutationInput {
  readonly actor: TenantContext;
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly expectedVersion: number;
  readonly now: IsoDateTime;
}

export interface ChangeMembershipRoleInput extends MembershipMutationInput {
  readonly role: Role;
}

const roles: readonly Role[] = ["PRODUCT_OWNER", "PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"];
const statuses = ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;

export function permissionsForMembershipRole(role: Role): ReadonlyArray<Permission> {
  if (role === "PRODUCT_OWNER" || role === "PLATFORM_OWNER") return ["tenant:read", "tenant:manage", "membership:read", "membership:manage", "customer:read", "customer:manage", "document:read", "document:manage", "audit:read"];
  if (role === "TENANT_ADMIN") return ["tenant:read", "tenant:manage", "membership:read", "membership:manage", "document:read", "document:manage", "audit:read"];
  if (role === "SALES_MANAGER") return ["tenant:read", "membership:read", "customer:read", "customer:manage", "document:read", "document:manage"];
  return ["tenant:read", "customer:read", "document:read"];
}

function fail(code: string): never { throw new Error(code); }
function clone<T>(value: T): T { return structuredClone(value); }
function assertRole(value: unknown): asserts value is Role { if (typeof value !== "string" || !roles.includes(value as Role)) fail("MEMBERSHIP_ROLE_INVALID"); }
function assertTenantBinding(record: MembershipRecord, tenantId: TenantId): void { if (record.tenantId !== tenantId) fail("CROSS_TENANT_DENIED"); }

export function validateMembershipRecord(value: unknown): MembershipRecord {
  if (typeof value !== "object" || value === null) fail("MEMBERSHIP_RECORD_INVALID");
  const record = value as MembershipRecord;
  if (!record.id || !record.userId || !record.tenantId || !record.version || !Number.isSafeInteger(record.version) || record.version < 1) fail("MEMBERSHIP_RECORD_INVALID");
  assertRole(record.role);
  if (!statuses.includes(record.status)) fail("MEMBERSHIP_STATUS_INVALID");
  if (!Array.isArray(record.permissions)) fail("MEMBERSHIP_PERMISSIONS_INVALID");
  ImmutablePermissions.from(record.permissions);
  if (!isValidTimestamp(record.createdAt) || !isValidTimestamp(record.updatedAt) || Date.parse(record.updatedAt) < Date.parse(record.createdAt)) fail("MEMBERSHIP_TIMESTAMP_INVALID");
  if (record.revokedAt !== undefined && !isValidTimestamp(record.revokedAt)) fail("MEMBERSHIP_TIMESTAMP_INVALID");
  if (record.status === "DEACTIVATED" && record.revokedAt === undefined) fail("MEMBERSHIP_REVOCATION_EVIDENCE_REQUIRED");
  if (record.managerUserId !== undefined && (typeof record.managerUserId !== "string" || record.managerUserId.trim().length === 0 || record.role !== "SALES_OPERATOR")) fail("MEMBERSHIP_ASSIGNMENT_INVALID");
  if (record.groupIds !== undefined && (!Array.isArray(record.groupIds) || record.groupIds.some((groupId) => typeof groupId !== "string" || !/^group_[a-z0-9_-]+$/.test(groupId)))) fail("MEMBERSHIP_GROUP_INVALID");
  return clone({ ...record, permissions: ImmutablePermissions.from(record.permissions).toArray() });
}

function authorizeMutation(actor: TenantContext, tenantId: TenantId): void {
  requirePermission(actor, tenantId, "membership:manage");
}

function assertRoleMutationAllowed(actor: TenantContext, targetUserId: UserId, targetRole: Role): void {
  const actorRole = foundationRoleToCanonical(actor.role);
  const targetCanonicalRole = foundationRoleToCanonical(targetRole);
  if (!canManageCanonicalRole(actorRole, targetCanonicalRole)) fail("ROLE_ESCALATION_DENIED");
  if (actor.userId === targetUserId && actorRole !== "SUPER_ADMIN" && targetCanonicalRole !== actorRole) fail("SELF_ESCALATION_DENIED");
}

async function current(repository: MembershipRepository, tenantId: TenantId, membershipId: MembershipId, expectedVersion: number): Promise<MembershipRecord> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail("MEMBERSHIP_VERSION_INVALID");
  const record = await repository.get(tenantId, membershipId);
  if (!record) fail("MEMBERSHIP_NOT_FOUND");
  const valid = validateMembershipRecord(record);
  assertTenantBinding(valid, tenantId);
  if (valid.id !== membershipId) fail("MEMBERSHIP_ID_MISMATCH");
  if (valid.version !== expectedVersion) fail("MEMBERSHIP_VERSION_CONFLICT");
  return valid;
}

async function save(repository: MembershipRepository, previous: MembershipRecord, next: MembershipRecord): Promise<MembershipRecord> {
  const valid = validateMembershipRecord(next);
  const saved = await repository.put({ record: valid, expectedVersion: previous.version });
  const checked = validateMembershipRecord(saved);
  assertTenantBinding(checked, previous.tenantId);
  if (checked.id !== previous.id) fail("MEMBERSHIP_ID_MISMATCH");
  return checked;
}

export async function createMembership(repository: MembershipRepository, input: CreateMembershipInput): Promise<MembershipRecord> {
  authorizeMutation(input.actor, input.tenantId);
  if (!input.identity.active) fail("MEMBERSHIP_IDENTITY_INVALID");
  if (input.tenantId !== input.actor.tenantId) fail("CROSS_TENANT_DENIED");
  assertRoleMutationAllowed(input.actor, input.identity.userId, input.role);
  const record = validateMembershipRecord({ id: input.membershipId, userId: input.identity.userId, tenantId: input.tenantId, role: input.role, status: "ACTIVE", permissions: input.permissions, version: 1, createdAt: input.now, updatedAt: input.now });
  const existing = await repository.get(input.tenantId, input.membershipId);
  if (existing) fail("MEMBERSHIP_ALREADY_EXISTS");
  const saved = await repository.append({ record });
  return validateMembershipRecord(saved);
}

export async function changeMembershipRole(repository: MembershipRepository, input: ChangeMembershipRoleInput): Promise<MembershipRecord> {
  authorizeMutation(input.actor, input.tenantId);
  assertRole(input.role);
  const previous = await current(repository, input.tenantId, input.membershipId, input.expectedVersion);
  if (previous.status === "DEACTIVATED") fail("MEMBERSHIP_DEACTIVATED_IMMUTABLE");
  if (previous.role === input.role) return clone(previous);
  assertRoleMutationAllowed(input.actor, previous.userId, input.role);
  if (previous.userId === input.actor.userId && foundationRoleToCanonical(input.role) !== "SUPER_ADMIN") {
    const remainingAuthority = (await repository.list(input.tenantId)).some((candidate) => candidate.userId !== input.actor.userId && candidate.status === "ACTIVE" && foundationRoleToCanonical(candidate.role) === "SUPER_ADMIN");
    if (!remainingAuthority) fail("SELF_DEMOTION_LOCKOUT_DENIED");
  }
  return save(repository, previous, { ...previous, role: input.role, permissions: permissionsForMembershipRole(input.role), version: previous.version + 1, updatedAt: canonicalTimestamp(input.now), ...(input.role === "SALES_OPERATOR" && previous.managerUserId ? { managerUserId: previous.managerUserId } : { managerUserId: undefined }) });
}

/**
 * The reporting line is a hierarchy control, not a client-selected profile
 * attribute. It is intentionally separate from role mutation and requires a
 * platform owner plus a same-tenant active manager and agent membership.
 */
export async function assignMembershipManager(repository: MembershipRepository, input: AssignMembershipManagerInput): Promise<MembershipRecord> {
  if (input.actor.role !== "PLATFORM_OWNER") fail("ASSIGNMENT_SUPER_ADMIN_ONLY");
  if (input.tenantId !== input.actor.tenantId) fail("CROSS_TENANT_DENIED");
  const previous = await current(repository, input.tenantId, input.membershipId, input.expectedVersion);
  if (previous.status !== "ACTIVE" || previous.role !== "SALES_OPERATOR") fail("ASSIGNMENT_TARGET_INVALID");
  if (input.managerUserId !== null) {
    if (!input.managerUserId || input.managerUserId === previous.userId) fail("ASSIGNMENT_MANAGER_INVALID");
    const manager = (await repository.list(input.tenantId)).find((candidate) => candidate.userId === input.managerUserId && candidate.status === "ACTIVE" && candidate.role === "SALES_MANAGER");
    if (!manager) fail("ASSIGNMENT_MANAGER_INVALID");
  }
  if (previous.managerUserId === input.managerUserId) return clone(previous);
  return save(repository, previous, { ...previous, ...(input.managerUserId === null ? {} : { managerUserId: input.managerUserId }), ...(input.managerUserId === null ? { managerUserId: undefined } : {}), version: previous.version + 1, updatedAt: canonicalTimestamp(input.now) });
}

export async function suspendMembership(repository: MembershipRepository, input: MembershipMutationInput): Promise<MembershipRecord> {
  authorizeMutation(input.actor, input.tenantId);
  const previous = await current(repository, input.tenantId, input.membershipId, input.expectedVersion);
  if (previous.status === "DEACTIVATED") fail("MEMBERSHIP_DEACTIVATED_IMMUTABLE");
  if (previous.status === "SUSPENDED") return clone(previous);
  return save(repository, previous, { ...previous, status: "SUSPENDED", version: previous.version + 1, updatedAt: canonicalTimestamp(input.now) });
}

export async function reactivateMembership(repository: MembershipRepository, input: MembershipMutationInput): Promise<MembershipRecord> {
  authorizeMutation(input.actor, input.tenantId);
  const previous = await current(repository, input.tenantId, input.membershipId, input.expectedVersion);
  if (previous.status === "DEACTIVATED") fail("MEMBERSHIP_DEACTIVATED_IMMUTABLE");
  if (previous.status === "ACTIVE") return clone(previous);
  return save(repository, previous, { ...previous, status: "ACTIVE", version: previous.version + 1, updatedAt: canonicalTimestamp(input.now) });
}

export async function revokeMembership(repository: MembershipRepository, input: MembershipMutationInput): Promise<MembershipRecord> {
  authorizeMutation(input.actor, input.tenantId);
  const previous = await current(repository, input.tenantId, input.membershipId, input.expectedVersion);
  if (previous.status === "DEACTIVATED") return clone(previous);
  return save(repository, previous, { ...previous, status: "DEACTIVATED", version: previous.version + 1, updatedAt: canonicalTimestamp(input.now), revokedAt: canonicalTimestamp(input.now) });
}
