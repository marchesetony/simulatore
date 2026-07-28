import { isValidTimestamp } from "./types";
import type { IsoDateTime, Session, SessionId, UserId } from "./types";

export interface SessionPolicy {
  readonly lifetimeSeconds: number;
  readonly rotationWindowSeconds: number;
}

/**
 * A server verifier creates this nominal capability only after checking the
 * persisted session, its version and its revocation state.
 */
export class VerifiedActiveSession {
  private constructor(private readonly session: Session) {
    Object.freeze(this);
  }

  static fromServerRecord(session: Session): VerifiedActiveSession {
    validateSession(session, session.issuedAt);
    if (session.revokedAt !== undefined || !Number.isInteger(session.version) || session.version <= 0) {
      throw new Error("SESSION_EVIDENCE_DENIED");
    }
    return new VerifiedActiveSession(freezeSession(session));
  }

  get id(): SessionId { return this.session.id; }
  get userId(): UserId { return this.session.userId; }
  get version(): number { return this.session.version; }

  isValid(now: IsoDateTime): boolean {
    try {
      validateSession(this.session, now);
      return true;
    } catch {
      return false;
    }
  }
}

export interface SessionRotationCommand {
  readonly evidence: VerifiedActiveSession;
  readonly sessionId: SessionId;
  readonly expectedVersion: number;
  readonly expectedRevokedAt: undefined;
  readonly replacementId: SessionId;
  readonly now: IsoDateTime;
  readonly policy: SessionPolicy;
}

/** The only rotation operation: the provider must compare-and-revoke atomically. */
export interface SessionPort {
  rotate(command: SessionRotationCommand): Promise<SessionRotationReceipt>;
}

export class SessionRotationReceipt {
  private constructor(
    readonly previousSessionId: SessionId,
    readonly previousVersion: number,
    readonly newSession: Session,
  ) {
    Object.freeze(this);
  }

  static fromAtomicCommit(
    evidence: VerifiedActiveSession,
    newSession: Session,
    revocationConfirmed: boolean,
  ): SessionRotationReceipt {
    if (!revocationConfirmed || newSession.id === evidence.id || newSession.userId !== evidence.userId ||
      !Number.isInteger(newSession.version) || newSession.version <= evidence.version) {
      throw new Error("SESSION_ROTATION_DENIED");
    }
    validateSession(newSession, newSession.issuedAt);
    if (newSession.rotatedFrom !== evidence.id || newSession.version <= evidence.version) {
      throw new Error("SESSION_ROTATION_DENIED");
    }
    return new SessionRotationReceipt(evidence.id, evidence.version, freezeSession(newSession));
  }
}

function assertSessionTimes(session: Session, now: IsoDateTime): void {
  if (
    !isValidTimestamp(session.issuedAt) ||
    !isValidTimestamp(session.expiresAt) ||
    !isValidTimestamp(now) ||
    (session.revokedAt !== undefined && !isValidTimestamp(session.revokedAt)) ||
    Date.parse(session.expiresAt) <= Date.parse(session.issuedAt)
  ) {
    throw new Error("SESSION_DENIED");
  }
}

function freezeSession(session: Session): Session {
  return Object.freeze({ ...session });
}

export function validateSession(session: Session, now: IsoDateTime): Session {
  assertSessionTimes(session, now);
  if (session.revokedAt !== undefined || Date.parse(now) >= Date.parse(session.expiresAt)) {
    throw new Error("SESSION_DENIED");
  }
  return session;
}

export function validateRotationCommand(command: SessionRotationCommand): void {
  if (
    command.sessionId !== command.evidence.id ||
    command.expectedVersion !== command.evidence.version ||
    command.expectedRevokedAt !== undefined ||
    !command.evidence.isValid(command.now) ||
    !Number.isFinite(command.policy.lifetimeSeconds) || command.policy.lifetimeSeconds <= 0 ||
    !Number.isFinite(command.policy.rotationWindowSeconds) || command.policy.rotationWindowSeconds < 0 ||
    command.replacementId === command.sessionId
  ) {
    throw new Error("SESSION_ROTATION_DENIED");
  }
}
