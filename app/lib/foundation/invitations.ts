import { isValidTimestamp } from "./types";
import type { Invitation, InvitationId, InvitationStatus, IsoDateTime, Role, TenantId } from "./types";

function assertInvitationTimes(invitation: Invitation, now: IsoDateTime): void {
  if (
    !isValidTimestamp(invitation.issuedAt) ||
    !isValidTimestamp(invitation.expiresAt) ||
    !isValidTimestamp(now) ||
    (invitation.acceptedAt !== undefined && !isValidTimestamp(invitation.acceptedAt)) ||
    (invitation.revokedAt !== undefined && !isValidTimestamp(invitation.revokedAt)) ||
    Date.parse(invitation.expiresAt) <= Date.parse(invitation.issuedAt)
  ) {
    throw new Error("INVITATION_DENIED");
  }
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
  if (
    !input.recipientEmail.includes("@") ||
    !input.tokenDigest ||
    !isValidTimestamp(input.issuedAt) ||
    !isValidTimestamp(input.expiresAt) ||
    Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)
  ) {
    throw new Error("INVITATION_INVALID");
  }
  return { ...input, status: "PENDING" };
}

export function revokeInvitation(invitation: Invitation, now: IsoDateTime): Invitation {
  assertInvitationTimes(invitation, now);
  if (invitation.status === "ACCEPTED") throw new Error("INVITATION_ALREADY_ACCEPTED");
  return { ...invitation, status: "REVOKED", revokedAt: now };
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
