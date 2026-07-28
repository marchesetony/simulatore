import type { Identity, UserId } from "./types";

export interface IdentityClaims {
  readonly subject: string;
  readonly email: string;
  readonly userId: UserId;
  readonly active: boolean;
}

export interface IdentityPort {
  resolve(claims: IdentityClaims): Identity;
}

export function resolveIdentity(claims: IdentityClaims): Identity {
  if (!claims.subject.trim() || !claims.email.trim() || !claims.userId) {
    throw new Error("IDENTITY_INVALID");
  }
  if (!claims.active) {
    throw new Error("IDENTITY_INACTIVE");
  }
  return {
    userId: claims.userId,
    subject: claims.subject,
    email: claims.email,
    active: true,
  };
}
