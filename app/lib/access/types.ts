import type { AuthRole } from "../auth/types";
import type { DeletableTenantRecordRepository, FoundationMembershipRecord, TenantRecordRepository } from "../persistence/types";

/** The platform owner's own tenant: whoever is ADMIN here creates the client companies. */
export const PLATFORM_TENANT_ID = "tenant_piattaforma";

export type AccountLevel = "AMMINISTRATORE" | "DIRETTORE" | "AREA_MANAGER" | "AGENTE";
export type AccountStatus = "ACTIVE" | "SUSPENDED";

export interface Company {
  readonly tenantId: string;
  readonly name: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface AccessAccount {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly level: AccountLevel;
  readonly status: AccountStatus;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Login identities live outside the tenant records: Supabase Auth plus the runtime_* tables in production. */
export interface AccessDirectory {
  createLogin(input: { readonly email: string; readonly password: string; readonly displayName: string }): Promise<{ readonly authUserId: string }>;
  linkUser(input: { readonly userId: string; readonly authUserId: string; readonly displayName: string }): Promise<void>;
  setMembership(input: { readonly userId: string; readonly tenantId: string; readonly role: AuthRole; readonly status: AccountStatus }): Promise<void>;
  /** Compensates a half-finished provisioning; never used on accounts that people already use. */
  removeLogin(input: { readonly userId: string; readonly authUserId: string }): Promise<void>;
  loginFor(userId: string): Promise<{ readonly authUserId: string; readonly email: string } | null>;
  verifyPassword(email: string, password: string): Promise<string | null>;
  setPassword(authUserId: string, password: string): Promise<void>;
}

export interface AccessStores {
  readonly companies: TenantRecordRepository<Company>;
  readonly accounts: TenantRecordRepository<AccessAccount>;
  readonly memberships: DeletableTenantRecordRepository<FoundationMembershipRecord>;
  readonly directory: AccessDirectory;
}
