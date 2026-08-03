export type AuthErrorCode =
  | "AUTH_CONFIGURATION_INVALID"
  | "AUTH_ADAPTER_UNAVAILABLE"
  | "AUTH_AUDIT_UNAVAILABLE"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATION_EXPIRED"
  | "AUTHENTICATION_INVALID"
  | "AUTHORIZATION_DENIED"
  | "TENANT_MISMATCH"
  | "TENANT_PRINCIPAL_INVALID";

export class AuthenticationError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) { super(code); this.name = "AuthenticationError"; this.code = code; }
}

export function authFail(code: AuthErrorCode): never { throw new AuthenticationError(code); }
