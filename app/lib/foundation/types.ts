export type IsoDateTime = string & { readonly __isoDateTime: unique symbol };
export type UserId = string & { readonly __userId: unique symbol };
export type TenantId = string & { readonly __tenantId: unique symbol };
export type MembershipId = string & { readonly __membershipId: unique symbol };
export type InvitationId = string & { readonly __invitationId: unique symbol };
export type SessionId = string & { readonly __sessionId: unique symbol };

export type Role =
  | "PRODUCT_OWNER"
  | "PLATFORM_OWNER"
  | "TENANT_ADMIN"
  | "SALES_MANAGER"
  | "SALES_OPERATOR";

export type Permission =
  | "tenant:read"
  | "tenant:manage"
  | "membership:read"
  | "membership:manage"
  | "customer:read"
  | "customer:manage"
  | "document:read"
  | "document:manage"
  | "audit:read";

export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export class ImmutablePermissions {
  private constructor(private readonly values: ReadonlyArray<Permission>) {
    Object.freeze(this);
  }

  static from(input: ReadonlyArray<Permission>): ImmutablePermissions {
    const allowed: ReadonlyArray<Permission> = [
      "tenant:read", "tenant:manage", "membership:read", "membership:manage",
      "customer:read", "customer:manage", "document:read", "document:manage", "audit:read",
    ];
    const unique = new Set<Permission>();
    for (const permission of input) {
      if (!allowed.includes(permission) || unique.has(permission)) throw new Error("PERMISSIONS_INVALID");
      unique.add(permission);
    }
    return new ImmutablePermissions(Object.freeze(Array.from(unique)));
  }

  has(permission: Permission): boolean { return this.values.includes(permission); }
  toArray(): ReadonlyArray<Permission> { return Object.freeze(Array.from(this.values)); }
}

export function isValidTimestamp(value: unknown): value is IsoDateTime {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function canonicalTimestamp(value: unknown): IsoDateTime {
  if (!isValidTimestamp(value)) throw new Error("TIMESTAMP_INVALID");
  return value;
}

export interface Identity {
  readonly userId: UserId;
  readonly subject: string;
  readonly email: string;
  readonly active: boolean;
}

export interface Session {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly version: number;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly rotatedFrom?: SessionId;
  readonly revokedAt?: IsoDateTime;
}

export interface Invitation {
  readonly id: InvitationId;
  readonly tenantId: TenantId;
  readonly recipientEmail: string;
  readonly role: Role;
  readonly tokenDigest: string;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly status: InvitationStatus;
  readonly acceptedAt?: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
}

export interface Membership {
  readonly id: MembershipId;
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly role: Role;
  readonly status: MembershipStatus;
  readonly permissions: ReadonlyArray<Permission>;
}
