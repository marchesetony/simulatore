export type FoundationErrorCode =
  | "IDENTITY_INVALID"
  | "IDENTITY_INACTIVE"
  | "SESSION_DENIED"
  | "INVITATION_DENIED"
  | "TENANT_ACCESS_DENIED"
  | "CROSS_TENANT_DENIED"
  | "AUTHORIZATION_DENIED"
  | "CONFIGURATION_INVALID"
  | "REPOSITORY_SCOPE_DENIED"
  | "AUDIT_REDACTION_REQUIRED";

export class CorrelationId {
  private constructor(private readonly value: string) {
    Object.freeze(this);
  }

  static from(input: unknown): CorrelationId {
    if (typeof input !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/.test(input)) {
      throw new Error("CORRELATION_ID_INVALID");
    }
    if (/secret|token|password|credential|document.?content|raw.?document|bearer/i.test(input)) {
      throw new Error("CORRELATION_ID_INVALID");
    }
    return new CorrelationId(input);
  }

  toJSON(): string { return this.value; }
}

export interface RedactedError {
  readonly code: FoundationErrorCode;
  readonly message: "Request denied";
  readonly correlationId: CorrelationId;
}

export function redactError(code: FoundationErrorCode, correlationId: CorrelationId): RedactedError {
  return { code, message: "Request denied", correlationId };
}
