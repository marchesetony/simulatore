// Server-side persistence mapping for the foundation invitation/membership lifecycle.
// Authentication remains authoritative for the runtime principal and tenant.
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateInvitationRecord } from "./invitations.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { permissionsForMembershipRole, validateMembershipRecord, type MembershipRecord, type MembershipRepository } from "./memberships.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveTenantContext } from "./tenants.ts";
import type { AuthenticatedPrincipal } from "../auth/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { canonicalToFoundationRole, legacyAuthRoleToCanonical } from "../auth/roles.ts";
import type { RuntimeRepositories } from "../persistence/adapter.ts";
import type { FoundationInvitationRecord, FoundationMembershipRecord, TenantRecord } from "../persistence/types.ts";
import type { Identity, Invitation, IsoDateTime, Membership, Permission, Role, TenantId, UserId, MembershipId, InvitationId } from "./types.ts";

export type FoundationRepositories = Pick<RuntimeRepositories, "foundationInvitations" | "foundationMemberships">;

export function permissionsForFoundationRole(role: Role): ReadonlyArray<Permission> {
  return permissionsForMembershipRole(role);
}

export function invitationFromStored(record: TenantRecord<FoundationInvitationRecord>, now: IsoDateTime): Invitation {
  if (record.tenantId !== record.payload.tenantId || record.recordId !== record.payload.id) throw new Error("INVITATION_DENIED");
  return validateInvitationRecord(record.payload, now);
}

export function invitationPayload(invitation: Invitation, recipientUserId: string, createdBy: string): FoundationInvitationRecord {
  return { ...invitation, recipientUserId, createdBy };
}

export function membershipFromStored(record: TenantRecord<FoundationMembershipRecord>): MembershipRecord {
  if (record.tenantId !== record.payload.tenantId || record.recordId !== record.payload.id) throw new Error("MEMBERSHIP_RECORD_INVALID");
  return validateMembershipRecord({ ...record.payload, version: record.version });
}

export function membershipPayload(record: MembershipRecord): FoundationMembershipRecord {
  return { id: record.id, userId: record.userId, tenantId: record.tenantId, role: record.role, status: record.status, permissions: record.permissions, createdAt: record.createdAt, updatedAt: record.updatedAt, ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}), ...(record.managerUserId ? { managerUserId: record.managerUserId } : {}), ...(record.groupIds?.length ? { groupIds: record.groupIds } : {}) };
}

export function membershipRepository(repositories: FoundationRepositories): MembershipRepository {
  return {
    async get(tenantId: TenantId, membershipId: MembershipId): Promise<MembershipRecord | null> {
      const record = await repositories.foundationMemberships.get(tenantId, membershipId);
      return record ? membershipFromStored(record) : null;
    },
    async list(tenantId: TenantId): Promise<readonly MembershipRecord[]> {
      const records = await repositories.foundationMemberships.list(tenantId);
      return records.map(membershipFromStored);
    },
    async append(input): Promise<MembershipRecord> {
      const saved = await repositories.foundationMemberships.append({ tenantId: input.record.tenantId, recordId: input.record.id, payload: membershipPayload(input.record), now: input.record.createdAt });
      return membershipFromStored(saved);
    },
    async put(input): Promise<MembershipRecord> {
      const saved = await repositories.foundationMemberships.put({ tenantId: input.record.tenantId, recordId: input.record.id, payload: membershipPayload(input.record), expectedVersion: input.expectedVersion, now: input.record.updatedAt });
      return membershipFromStored(saved);
    },
  };
}

export function principalFoundationActor(principal: AuthenticatedPrincipal): { readonly context: ReturnType<typeof resolveTenantContext>; readonly identity: Identity } {
  if (legacyAuthRoleToCanonical(principal.role) !== "SUPER_ADMIN" || principal.source !== "VERIFIED_SESSION" && principal.source !== "LOCAL_SYNTHETIC") throw new Error("AUTHORIZATION_DENIED:ROLE_INSUFFICIENT");
  // Runtime ADMIN is the authoritative platform-admin mapping. It is never
  // read from a request body and cannot be selected by the caller.
  const userId = principal.userId as UserId;
  const tenantId = principal.tenantId as TenantId;
  const identity: Identity = { userId, subject: principal.sessionId, email: "verified-session@internal.invalid", active: true };
  const role = canonicalToFoundationRole(legacyAuthRoleToCanonical(principal.role));
  const membership: Membership = { id: `runtime-${principal.sessionId}` as MembershipId, userId, tenantId, role, status: "ACTIVE", permissions: permissionsForFoundationRole(role) };
  return { identity, context: resolveTenantContext(identity, membership, tenantId) };
}

export function invitationId(value: string): InvitationId { return value as InvitationId; }
export function membershipId(value: string): MembershipId { return value as MembershipId; }
