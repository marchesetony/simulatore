export type Role = "PLATFORM_OWNER" | "TENANT_ADMIN" | "SALES_MANAGER" | "SALES_OPERATOR";
export type Permission = "auth:login" | "auth:session";
export interface Credentials { readonly email: string; readonly password: string }
export interface Identity { readonly userId: string; readonly authUserId: string }

interface PrincipalBase extends Identity {
  readonly assignmentId: string;
  readonly permissions: readonly Permission[];
}
export type Principal = PrincipalBase & (
  | { readonly scope: "PLATFORM"; readonly role: "PLATFORM_OWNER"; readonly tenantId?: never }
  | { readonly scope: "TENANT"; readonly role: Exclude<Role, "PLATFORM_OWNER">;
      readonly tenantId: string; readonly membershipStatus: "ACTIVE" }
);

export interface SessionRecord {
  readonly sessionId: string;
  readonly sessionHash: string;
  readonly authUserId: string;
  readonly userId: string;
  readonly assignmentId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}
export type LoginFailure = "AUTHENTICATION_FAILED" | "AUTHENTICATION_UNAVAILABLE" |
  "TENANT_SELECTION_REQUIRED" | "ACCESS_CONFIGURATION_INVALID";
export type LoginResult = { readonly kind: LoginFailure } |
  { readonly kind: "AUTHENTICATED"; readonly token: string; readonly expiresAt: string };
