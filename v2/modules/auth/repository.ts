import type { Credentials, Identity, SessionRecord } from "./types";

export interface AuthProvider {
  verify(credentials: Credentials): Promise<string>;
}

export interface AccessRepository {
  identity(authUserId: string): Promise<Identity | null>;
  assignments(userId: string): Promise<readonly unknown[]>;
  legacyRoles(userId: string): Promise<readonly unknown[]>;
  tenantActive(tenantId: string): Promise<boolean>;
}

export interface SessionRepository {
  insert(session: SessionRecord): Promise<void>;
  find(hash: string): Promise<SessionRecord | null>;
}
