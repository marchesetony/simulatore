export type RuntimeMode = "local" | "production";
export type AuthAdapterKind = "local" | "server-session";
export type PersistenceAdapterKind = "filesystem" | "provider";
export type AuthRole = "ADMIN" | "ANALYST" | "VIEWER";
export type AuthSource = "LOCAL_SYNTHETIC" | "VERIFIED_SESSION";
export type AccessLevel = "READ" | "WRITE" | "ADMIN";

export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: AuthRole;
  readonly sessionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly source: AuthSource;
}

export interface AuthorizationResult {
  readonly allowed: boolean;
  readonly reason: "ALLOWED" | "UNAUTHENTICATED" | "TENANT_MISMATCH" | "ROLE_INSUFFICIENT" | "CONFIGURATION_INVALID";
}

export interface RuntimeConfig {
  readonly runtimeMode: RuntimeMode;
  readonly foundationLocalDev: boolean;
  readonly authAdapter: AuthAdapterKind;
  readonly persistenceAdapter: PersistenceAdapterKind;
  readonly localTenantId: string;
  readonly localRole: AuthRole;
}

export type RuntimeConfigResult =
  | { readonly valid: true; readonly config: RuntimeConfig }
  | { readonly valid: false; readonly errors: readonly string[] };
