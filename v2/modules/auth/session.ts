import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AuthError } from "../../core/errors/auth-error";
import { resolveAccess } from "./access";
import type { AccessRepository, SessionRepository } from "./repository";
import type { Principal, SessionRecord } from "./types";

export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export async function verifySession(token: string, sessions: SessionRepository,
  access: AccessRepository, now = Date.now()): Promise<Principal> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthError("SESSION_INVALID");
  const row = await sessions.find(tokenHash(token));
  if (!row || row.sessionHash !== tokenHash(token) || row.revokedAt !== null ||
      !Number.isFinite(Date.parse(row.issuedAt)) || !Number.isFinite(Date.parse(row.expiresAt)) ||
      Date.parse(row.issuedAt) > now || Date.parse(row.expiresAt) <= now ||
      Date.parse(row.expiresAt) <= Date.parse(row.issuedAt)) throw new AuthError("SESSION_INVALID");
  const principal = await resolveAccess(access, row.authUserId, row.assignmentId);
  if (principal.userId !== row.userId) throw new AuthError("SESSION_INVALID");
  return principal;
}

export async function createSession(principal: Principal, sessions: SessionRepository,
  access: AccessRepository, seconds: number): Promise<{ token: string; expiresAt: string }> {
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 86400) throw new AuthError("CONFIGURATION_INVALID");
  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  const row: SessionRecord = { sessionId: randomUUID(), sessionHash: tokenHash(token),
    authUserId: principal.authUserId, userId: principal.userId, assignmentId: principal.assignmentId,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + seconds * 1000).toISOString(), revokedAt: null };
  try {
    await sessions.insert(row);
    const verified = await verifySession(token, sessions, access);
    if (verified.assignmentId !== principal.assignmentId ||
        !verified.permissions.includes("auth:login") || !verified.permissions.includes("auth:session")) {
      throw new AuthError("SESSION_CREATION_FAILED");
    }
  } catch { throw new AuthError("SESSION_CREATION_FAILED"); }
  return { token, expiresAt: row.expiresAt };
}
