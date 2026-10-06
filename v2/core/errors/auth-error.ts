export type AuthErrorCode =
  | "INVALID_CREDENTIALS" | "PROVIDER_UNAVAILABLE" | "CONFIGURATION_INVALID"
  | "ACCESS_DENIED" | "ACCESS_CONFIGURATION_INVALID" | "LEGACY_ROLE_REQUIRES_REVIEW"
  | "TENANT_SELECTION_REQUIRED" | "SESSION_CREATION_FAILED" | "SESSION_INVALID";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}
