import { createHash, randomUUID } from "node:crypto";
import type { AuthenticatedPrincipal } from "../auth/types";
import type { AuditEvent, AuditEventRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PERSISTENCE_SCHEMA_VERSION } from "./types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runtimeRepositories } from "./adapter.ts";

const unsafeKey = /password|token|cookie|cookies|authorization|secret|credential|document|raw|body|file|bytes|request|header|headers|exception|error|stack|trace|session|payload/i;
const identifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const tenantPattern = /^tenant_[a-z0-9-]+$/;
const principalPattern = /^user_[a-z0-9-]+$/;
const roles = ["ADMIN", "ANALYST", "VIEWER"] as const;

function safeMetadata(value: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, string | number | boolean | null>> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (unsafeKey.test(key) || typeof item === "object" || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") throw new Error("AUDIT_REDACTION_REQUIRED");
    if (typeof item === "string" && item.length > 256) throw new Error("AUDIT_REDACTION_REQUIRED");
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("AUDIT_REDACTION_REQUIRED");
    result[key] = item as string | number | boolean | null;
  }
  return result;
}

export interface AuditInput {
  readonly tenantId?: string;
  readonly principal?: AuthenticatedPrincipal;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly timestamp?: string;
  readonly outcome: AuditEvent["outcome"];
  readonly correlationId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createAuditEvent(input: AuditInput): AuditEvent {
  if (!identifierPattern.test(input.action) || !identifierPattern.test(input.resourceType) || (input.resourceId !== undefined && !identifierPattern.test(input.resourceId)) || !identifierPattern.test(input.correlationId)) throw new Error("AUDIT_IDENTIFIER_INVALID");
  const timestampValue = input.timestamp ?? new Date().toISOString();
  const parsedTimestamp = Date.parse(timestampValue);
  if (!Number.isFinite(parsedTimestamp)) throw new Error("AUDIT_TIMESTAMP_INVALID");
  const timestamp = new Date(parsedTimestamp).toISOString();
  const tenantId = input.tenantId ?? input.principal?.tenantId;
  if (tenantId !== undefined && !tenantPattern.test(tenantId)) throw new Error("AUDIT_TENANT_INVALID");
  if (input.principal && (!principalPattern.test(input.principal.userId) || !roles.includes(input.principal.role))) throw new Error("AUDIT_PRINCIPAL_INVALID");
  if (input.principal && tenantId !== undefined && input.principal.tenantId !== tenantId) throw new Error("AUDIT_TENANT_MISMATCH");
  const stable = `${tenantId ?? "none"}|${input.principal?.userId ?? "none"}|${input.action}|${input.resourceType}|${input.resourceId ?? "none"}|${timestamp}|${input.outcome}|${input.correlationId}|${JSON.stringify(safeMetadata(input.metadata))}`;
  return { schemaVersion: PERSISTENCE_SCHEMA_VERSION, eventId: `audit_${createHash("sha256").update(`${stable}|${randomUUID()}`, "utf8").digest("hex").slice(0, 32)}`, ...(tenantId ? { tenantId } : {}), ...(input.principal ? { principalId: input.principal.userId, role: input.principal.role } : {}), action: input.action, resourceType: input.resourceType, ...(input.resourceId ? { resourceId: input.resourceId } : {}), timestamp, outcome: input.outcome, correlationId: input.correlationId, metadata: safeMetadata(input.metadata) };
}

export class AuditLogger {
  private readonly repository: AuditEventRepository;
  constructor(repository: AuditEventRepository) { this.repository = repository; }
  async record(input: AuditInput): Promise<AuditEvent> { const event = createAuditEvent(input); if (event.tenantId) await this.repository.append({ tenantId: event.tenantId, recordId: event.eventId, payload: event, idempotencyKey: event.eventId, now: event.timestamp }); else await this.repository.appendUnscoped({ recordId: event.eventId, payload: event, idempotencyKey: event.eventId, now: event.timestamp }); return event; }
}

let auditRepositoryOverride: AuditEventRepository | null = null;
export function registerAuditRepository(repository: AuditEventRepository): void { auditRepositoryOverride = repository; }
export function clearAuditRepository(): void { auditRepositoryOverride = null; }
export async function recordRuntimeAudit(input: AuditInput): Promise<AuditEvent> {
  return new AuditLogger(auditRepositoryOverride ?? runtimeRepositories().auditEvents).record(input);
}
