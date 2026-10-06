import "server-only";
import { AuthError } from "../../core/errors/auth-error";
import { record, requiredString } from "./schema";
import type { AccessRepository, SessionRepository } from "./repository";
import type { Identity, SessionRecord } from "./types";
import type { SupabaseHttp } from "./supabase-http";

function single(rows: readonly unknown[]): Record<string, unknown> | null {
  if (rows.length > 1) throw new AuthError("ACCESS_CONFIGURATION_INVALID");
  return rows.length ? record(rows[0]) : null;
}

export class SupabaseAccessRepository implements AccessRepository {
  constructor(private readonly http: SupabaseHttp) {}

  async identity(authUserId: string): Promise<Identity | null> {
    const link = single(await this.http.rows("runtime_identities", { auth_user_id: `eq.${authUserId}` }));
    if (!link) return null;
    if (link.provider !== "supabase" || link.auth_user_id !== authUserId) throw new AuthError("ACCESS_DENIED");
    const userId = requiredString(link.user_id);
    const user = single(await this.http.rows("runtime_users", { user_id: `eq.${userId}` }));
    return user?.active === true && user.user_id === userId ? { userId, authUserId } : null;
  }

  assignments(userId: string): Promise<readonly unknown[]> {
    return this.http.rows("v2_auth_assignments", { user_id: `eq.${userId}` });
  }

  async legacyRoles(userId: string): Promise<readonly unknown[]> {
    return (await this.http.rows("runtime_memberships", { user_id: `eq.${userId}` }, "role"))
      .map(row => record(row).role);
  }

  async tenantActive(tenantId: string): Promise<boolean> {
    const row = single(await this.http.rows("v2_auth_tenants", { tenant_id: `eq.${tenantId}` }));
    return row?.tenant_id === tenantId && row.active === true;
  }
}

export class SupabaseSessionRepository implements SessionRepository {
  constructor(private readonly http: SupabaseHttp) {}

  async insert(session: SessionRecord): Promise<void> {
    await this.http.request("/rest/v1/v2_auth_sessions", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ session_id: session.sessionId, session_hash: session.sessionHash,
        auth_user_id: session.authUserId, user_id: session.userId, assignment_id: session.assignmentId,
        issued_at: session.issuedAt, expires_at: session.expiresAt, revoked_at: session.revokedAt }),
    });
  }

  async find(hash: string): Promise<SessionRecord | null> {
    const row = single(await this.http.rows("v2_auth_sessions", { session_hash: `eq.${hash}` }));
    if (!row) return null;
    return { sessionId: requiredString(row.session_id), sessionHash: requiredString(row.session_hash),
      authUserId: requiredString(row.auth_user_id), userId: requiredString(row.user_id),
      assignmentId: requiredString(row.assignment_id), issuedAt: requiredString(row.issued_at),
      expiresAt: requiredString(row.expires_at),
      revokedAt: row.revoked_at === null ? null : requiredString(row.revoked_at) };
  }
}
