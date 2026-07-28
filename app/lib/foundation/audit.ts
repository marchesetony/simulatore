import { CorrelationId } from "./errors";
import type { IsoDateTime, TenantId, UserId } from "./types";

export type AuditOutcome = "ALLOWED" | "DENIED" | "FAILED";
export type AuditCategory = "IDENTITY" | "INVITATION" | "MEMBERSHIP" | "AUTHORIZATION" | "CONFIGURATION";
export type AuditOperation =
  | "IDENTITY_RESOLVED"
  | "SESSION_CREATED"
  | "SESSION_REVOKED"
  | "INVITATION_ISSUED"
  | "INVITATION_ACCEPTED"
  | "INVITATION_REVOKED"
  | "MEMBERSHIP_ACTIVATED"
  | "MEMBERSHIP_DENIED"
  | "AUTHORIZATION_ALLOWED"
  | "AUTHORIZATION_DENIED"
  | "CONFIGURATION_DENIED";
export type AuditTargetType = "IDENTITY" | "SESSION" | "INVITATION" | "MEMBERSHIP" | "TENANT" | "AUTHORIZATION" | "CONFIGURATION";

export class AuditTargetId {
  private constructor(private readonly value: string) {
    Object.freeze(this);
  }

  static from(input: unknown): AuditTargetId {
    if (typeof input !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input)) throw new Error("AUDIT_REDACTION_REQUIRED");
    if (/secret|token|password|credential|document.?content|raw.?document|bearer/i.test(input)) throw new Error("AUDIT_REDACTION_REQUIRED");
    return new AuditTargetId(input);
  }

  toJSON(): string { return this.value; }
}

export interface AuditEventInput {
  readonly category: AuditCategory;
  readonly actorId?: UserId;
  readonly tenantId?: TenantId;
  readonly operation: AuditOperation;
  readonly targetType: AuditTargetType;
  readonly targetId: AuditTargetId;
  readonly outcome: AuditOutcome;
  readonly correlationId: CorrelationId;
  readonly occurredAt: IsoDateTime;
}

export interface AuditEvent extends AuditEventInput {
  readonly details: null;
}

export function createAuditEvent(input: AuditEventInput): AuditEvent {
  return { ...input, details: null };
}
