import { ImmutablePermissions } from "./types";
import type { Identity, Membership, MembershipId, Permission, Role, TenantId, UserId } from "./types";

class VerifiedMembershipEvidenceImpl {
  private readonly proof = "SERVER_VERIFIED_MEMBERSHIP";
  private constructor(private readonly membership: Membership) {
    Object.freeze(this);
  }

  static verify(membership: Membership): VerifiedMembershipEvidenceImpl {
    if (!membership.userId || !membership.tenantId || !membership.id || membership.status !== "ACTIVE" || !membership.permissions) {
      throw new Error("MEMBERSHIP_EVIDENCE_DENIED");
    }
    return new VerifiedMembershipEvidenceImpl({ ...membership, permissions: ImmutablePermissions.from(membership.permissions).toArray() });
  }

  get userId(): UserId { return this.membership.userId; }
  get tenantId(): TenantId { return this.membership.tenantId; }
  get membershipId(): MembershipId { return this.membership.id; }
  get role(): Role { return this.membership.role; }
  private get immutablePermissions(): ImmutablePermissions { return ImmutablePermissions.from(this.membership.permissions); }
  hasPermission(permission: Permission): boolean { return this.immutablePermissions.has(permission); }
  permissionsCopy(): ReadonlyArray<Permission> { return this.immutablePermissions.toArray(); }
  isValid(): boolean { return this.proof === "SERVER_VERIFIED_MEMBERSHIP" && this.membership.status === "ACTIVE"; }
}

export type VerifiedMembershipEvidence = VerifiedMembershipEvidenceImpl;

export class TenantContext {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly role: Role;
  readonly membershipStatus: "ACTIVE";
  private readonly immutablePermissions: ImmutablePermissions;

  private constructor(private readonly evidence: VerifiedMembershipEvidenceImpl) {
    this.userId = evidence.userId;
    this.tenantId = evidence.tenantId;
    this.membershipId = evidence.membershipId;
    this.role = evidence.role;
    this.membershipStatus = "ACTIVE";
    this.immutablePermissions = ImmutablePermissions.from(evidence.permissionsCopy());
    Object.freeze(this);
  }

  static fromVerifiedMembership(evidence: VerifiedMembershipEvidence): TenantContext {
    if (!evidence.isValid()) throw new Error("TENANT_CONTEXT_DENIED");
    return new TenantContext(evidence);
  }

  isActive(): boolean {
    return this.membershipStatus === "ACTIVE" && this.evidence.isValid();
  }

  hasPermission(permission: Permission): boolean { return this.immutablePermissions.has(permission); }
  permissionsCopy(): ReadonlyArray<Permission> { return this.immutablePermissions.toArray(); }
}

export function resolveTenantContext(
  identity: Identity,
  membership: Membership | undefined,
  requestedTenantId: TenantId | undefined,
): TenantContext {
  if (!membership || !identity.active || membership.userId !== identity.userId || membership.status !== "ACTIVE") {
    throw new Error("TENANT_ACCESS_DENIED");
  }
  if (requestedTenantId && requestedTenantId !== membership.tenantId) {
    throw new Error("CROSS_TENANT_DENIED");
  }
  return TenantContext.fromVerifiedMembership(VerifiedMembershipEvidenceImpl.verify(membership));
}

export function assertSameTenant(expected: TenantId, actual: TenantId): void {
  if (expected !== actual) throw new Error("CROSS_TENANT_DENIED");
}
