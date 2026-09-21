// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { isValidTimestamp } from "./types.ts";
import type { Invitation, InvitationId, InvitationStatus, IsoDateTime, Role, TenantId } from "./types.ts";

const invitationRoles: readonly Role[] = ["PRODUCT_OWNER", "PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"];

function assertInvitationTimes(invitation: Invitation, now: IsoDateTime): void {
  const issuedAt = Date.parse(invitation.issuedAt);
  const expiresAt = Date.parse(invitation.expiresAt);
  const currentTime = Date.parse(now);
  const acceptedAt = invitation.acceptedAt === undefined ? undefined : Date.parse(invitation.acceptedAt);
  const revokedAt = invitation.revokedAt === undefined ? undefined : Date.parse(invitation.revokedAt);
  if (
    !isValidTimestamp(invitation.issuedAt) ||
    !isValidTimestamp(invitation.expiresAt) ||
    !isValidTimestamp(now) ||
    (invitation.acceptedAt !== undefined && !isValidTimestamp(invitation.acceptedAt)) ||
    (invitation.revokedAt !== undefined && !isValidTimestamp(invitation.revokedAt)) ||
    typeof invitation.id !== "string" ||
    !invitation.id.trim() ||
    typeof invitation.tenantId !== "string" ||
    !invitation.tenantId.trim() ||
    typeof invitation.recipientEmail !== "string" ||
    !invitation.recipientEmail.trim() ||
    !invitation.recipientEmail.includes("@") ||
    typeof invitation.tokenDigest !== "string" ||
    !invitation.tokenDigest.trim() ||
    !invitationRoles.includes(invitation.role) ||
    !["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"].includes(invitation.status) ||
    expiresAt <= issuedAt ||
    currentTime < issuedAt ||
    (acceptedAt !== undefined && (acceptedAt < issuedAt || acceptedAt > currentTime)) ||
    (revokedAt !== undefined && (revokedAt < issuedAt || revokedAt > currentTime)) ||
    (invitation.status === "PENDING" && (acceptedAt !== undefined || revokedAt !== undefined)) ||
    (invitation.status === "ACCEPTED" && (acceptedAt === undefined || revokedAt !== undefined)) ||
    (invitation.status === "REVOKED" && (revokedAt === undefined || acceptedAt !== undefined)) ||
    (invitation.status === "EXPIRED" && (acceptedAt !== undefined || revokedAt !== undefined)) ||
    (invitation.status === "EXPIRED" && currentTime < expiresAt)
  ) {
    throw new Error("INVITATION_DENIED");
  }
}

export function validateInvitationRecord(value: unknown, now: IsoDateTime): Invitation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("INVITATION_DENIED");
  const invitation = value as Invitation;
  assertInvitationTimes(invitation, now);
  return structuredClone(invitation);
}

export interface InvitationInput {
  readonly id: InvitationId;
  readonly tenantId: TenantId;
  readonly recipientEmail: string;
  readonly role: Role;
  readonly tokenDigest: string;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export function issueInvitation(input: InvitationInput): Invitation {
  const recipientEmail = typeof input.recipientEmail === "string" ? input.recipientEmail.trim().toLowerCase() : "";
  if (
    typeof input.id !== "string" ||
    !input.id.trim() ||
    typeof input.tenantId !== "string" ||
    !input.tenantId.trim() ||
    !recipientEmail.includes("@") ||
    typeof input.tokenDigest !== "string" ||
    !input.tokenDigest.trim() ||
    !invitationRoles.includes(input.role) ||
    !isValidTimestamp(input.issuedAt) ||
    !isValidTimestamp(input.expiresAt) ||
    Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)
  ) {
    throw new Error("INVITATION_INVALID");
  }
  return {
    id: input.id,
    tenantId: input.tenantId,
    recipientEmail,
    role: input.role,
    tokenDigest: input.tokenDigest,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    status: "PENDING",
  };
}

export function revokeInvitation(invitation: Invitation, now: IsoDateTime): Invitation {
  const current = expireInvitation(invitation, now);
  if (current.status === "ACCEPTED") throw new Error("INVITATION_ALREADY_ACCEPTED");
  if (current.status === "EXPIRED") throw new Error("INVITATION_ALREADY_EXPIRED");
  if (current.status === "REVOKED") throw new Error("INVITATION_ALREADY_REVOKED");
  return { ...current, status: "REVOKED", revokedAt: now };
}

export function expireInvitation(invitation: Invitation, now: IsoDateTime): Invitation {
  assertInvitationTimes(invitation, now);
  if (invitation.status !== "PENDING") return invitation;
  return Date.parse(now) >= Date.parse(invitation.expiresAt)
    ? { ...invitation, status: "EXPIRED" }
    : invitation;
}

export function acceptInvitation(
  invitation: Invitation,
  recipientEmail: string,
  tenantId: TenantId,
  tokenDigest: string,
  now: IsoDateTime,
): Invitation {
  const current = expireInvitation(invitation, now);
  if (
    current.status !== "PENDING" ||
    current.recipientEmail.toLowerCase() !== recipientEmail.toLowerCase() ||
    current.tenantId !== tenantId ||
    current.tokenDigest !== tokenDigest
  ) {
    throw new Error("INVITATION_DENIED");
  }
  return { ...current, status: "ACCEPTED", acceptedAt: now };
}

export function invitationStatus(invitation: Invitation, now: IsoDateTime): InvitationStatus {
  return expireInvitation(invitation, now).status;
}
