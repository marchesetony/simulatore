import { createHash } from "node:crypto";
import type { AuthRole } from "./auth/types.ts";
import type { RegulatoryValueRecord } from "./foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateChecksum, validateTenantId } from "./foundation/regulatory-validation.ts";
import type { AuditEvent, AuditEventRepository, TenantRecord, TenantRecordRepository } from "./persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId, PERSISTENCE_SCHEMA_VERSION } from "./persistence/types.ts";

export type RegulatoryApprovalDecision = "APPROVE" | "REVOKE";

export interface RegulatoryApprovalEffectiveEntry {
  readonly targetRecordId: string;
  readonly targetRecordChecksum: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly decisionEventId: string;
}

export interface RegulatoryApprovalDomainState {
  readonly domainKey: string;
  readonly componentCode: RegulatoryValueRecord["componentCode"];
  readonly customerScope: RegulatoryValueRecord["customerScope"];
  readonly normalizedUnit: string;
  readonly effectiveApprovals: readonly RegulatoryApprovalEffectiveEntry[];
}

export interface RegulatoryApprovalRepositories {
  readonly regulatoryValues: TenantRecordRepository<RegulatoryValueRecord>;
  readonly approvalDomains: TenantRecordRepository<RegulatoryApprovalDomainState>;
  readonly auditEvents: AuditEventRepository;
}

export interface RegulatoryApprovalRequest {
  readonly tenantId: string;
  readonly targetRecordId: string;
  readonly principalId: string;
  readonly role: AuthRole;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly evidenceReference: string;
}

export interface RegulatoryApprovalReplacementRequest extends Omit<RegulatoryApprovalRequest, "targetRecordId"> {
  readonly oldTargetRecordId: string;
  readonly newTargetRecordId: string;
}

export interface RegulatoryApprovalResult {
  readonly effective: boolean;
  readonly idempotent: boolean;
  readonly decision: RegulatoryApprovalDecision | "REPLACE";
  readonly domainKey: string;
  readonly domainStateId: string;
  readonly targetRecordId: string;
  readonly targetRecordChecksum: string;
  readonly decisionEventId: string;
}

const DOMAIN_NAMESPACE = "regulatory-approval-domain";
const MAX_CAS_ATTEMPTS = 3;
const identifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const principalPattern = /^user_[a-z0-9-]+$/;
const checksumPattern = /^[a-f0-9]{64}$/i;

function fail(code: string): never { throw new Error(code); }

function assertIdentifier(value: string, code: string): void {
  if (typeof value !== "string" || !identifierPattern.test(value)) fail(code);
}

function assertRequest(input: RegulatoryApprovalRequest | RegulatoryApprovalReplacementRequest): void {
  validateTenantId(input.tenantId);
  const primaryTargetId = "targetRecordId" in input ? input.targetRecordId : input.newTargetRecordId;
  assertIdentifier(primaryTargetId, "REGULATORY_APPROVAL_TARGET_INVALID");
  if ("oldTargetRecordId" in input) assertIdentifier(input.oldTargetRecordId, "REGULATORY_APPROVAL_TARGET_INVALID");
  if (!principalPattern.test(input.principalId)) fail("REGULATORY_APPROVAL_PRINCIPAL_INVALID");
  if (input.role !== "ADMIN") fail("REGULATORY_APPROVAL_ADMIN_REQUIRED");
  assertIdentifier(input.correlationId, "REGULATORY_APPROVAL_CORRELATION_INVALID");
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0 || input.idempotencyKey.length > 160) fail("REGULATORY_APPROVAL_IDEMPOTENCY_INVALID");
  if (typeof input.evidenceReference !== "string" || input.evidenceReference.trim() === "" || input.evidenceReference.length > 256) fail("REGULATORY_APPROVAL_EVIDENCE_INVALID");
}

function assertInterval(effectiveFrom: string, effectiveTo: string | null): void {
  const from = Date.parse(effectiveFrom);
  const to = effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(effectiveTo);
  if (!Number.isFinite(from) || (effectiveTo !== null && !Number.isFinite(to)) || from >= to) fail("REGULATORY_EFFECTIVE_INTERVAL_INVALID");
}

function assertTargetRecord(value: RegulatoryValueRecord, tenantId: string): RegulatoryValueRecord {
  validateTenantId(tenantId);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("REGULATORY_RECORD_INVALID");
  if (value.tenantId !== tenantId) fail("REGULATORY_TENANT_MISMATCH");
  if (value.vector !== "EE" || (value.authority !== "ARERA" && value.authority !== "TERNA")) fail("REGULATORY_RECORD_INVALID");
  if (typeof value.id !== "string" || !identifierPattern.test(value.id) || typeof value.componentCode !== "string" || value.componentCode.trim() === "" || typeof value.customerScope !== "string" || value.customerScope.trim() === "" || typeof value.normalizedUnit !== "string" || value.normalizedUnit.trim() === "") fail("REGULATORY_RECORD_INVALID");
  if (typeof value.sourceReference !== "string" || !/^https:\/\//.test(value.sourceReference) || typeof value.sourceSha256 !== "string" || !checksumPattern.test(value.sourceSha256) || !Array.isArray(value.conversionProvenance)) fail("REGULATORY_PROVENANCE_INVALID");
  if (typeof value.checksum !== "string" || !checksumPattern.test(value.checksum)) fail("REGULATORY_CHECKSUM_INVALID");
  assertInterval(value.effectiveFrom, value.effectiveTo);
  try { validateChecksum(value); } catch { fail("REGULATORY_CHECKSUM_INVALID"); }
  return value;
}

export function collisionDomainKey(value: Pick<RegulatoryValueRecord, "componentCode" | "customerScope" | "normalizedUnit">): string {
  if ([value.componentCode, value.customerScope, value.normalizedUnit].some((item) => typeof item !== "string" || item.trim() === "" || item.includes("|"))) fail("REGULATORY_APPROVAL_DOMAIN_INVALID");
  return `${value.componentCode}|${value.customerScope}|${value.normalizedUnit}`;
}

export function regulatoryApprovalDomainId(tenantId: string, domainKey: string): string {
  validateTenantId(tenantId);
  if (typeof domainKey !== "string" || domainKey.length === 0 || domainKey.length > 4096) fail("REGULATORY_APPROVAL_DOMAIN_INVALID");
  return deterministicRecordId(DOMAIN_NAMESPACE, tenantId, domainKey);
}

function emptyState(value: RegulatoryValueRecord): RegulatoryApprovalDomainState {
  return { domainKey: collisionDomainKey(value), componentCode: value.componentCode, customerScope: value.customerScope, normalizedUnit: value.normalizedUnit, effectiveApprovals: [] };
}

function assertDomainState(state: RegulatoryApprovalDomainState, domainKey: string): RegulatoryApprovalDomainState {
  if (!state || typeof state !== "object" || Array.isArray(state) || state.domainKey !== domainKey || typeof state.componentCode !== "string" || typeof state.customerScope !== "string" || typeof state.normalizedUnit !== "string" || !Array.isArray(state.effectiveApprovals)) fail("REGULATORY_APPROVAL_STATE_INVALID");
  if (collisionDomainKey(state) !== domainKey) fail("REGULATORY_APPROVAL_STATE_INVALID");
  for (const entry of state.effectiveApprovals) {
    if (!entry || typeof entry !== "object" || !identifierPattern.test(entry.targetRecordId) || !checksumPattern.test(entry.targetRecordChecksum) || !identifierPattern.test(entry.decisionEventId)) fail("REGULATORY_APPROVAL_STATE_INVALID");
    assertInterval(entry.effectiveFrom, entry.effectiveTo);
  }
  assertNoOverlap(state.effectiveApprovals);
  return state;
}

export function validateRegulatoryApprovalDomainState(state: RegulatoryApprovalDomainState, domainKey: string): RegulatoryApprovalDomainState {
  return assertDomainState(state, domainKey);
}

function intervalOverlaps(left: Pick<RegulatoryApprovalEffectiveEntry, "effectiveFrom" | "effectiveTo">, right: Pick<RegulatoryApprovalEffectiveEntry, "effectiveFrom" | "effectiveTo">): boolean {
  const leftFrom = Date.parse(left.effectiveFrom);
  const rightFrom = Date.parse(right.effectiveFrom);
  const leftTo = left.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(left.effectiveTo);
  const rightTo = right.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(right.effectiveTo);
  return leftFrom < rightTo && rightFrom < leftTo;
}

function assertNoOverlap(entries: readonly RegulatoryApprovalEffectiveEntry[]): void {
  for (let index = 0; index < entries.length; index += 1) {
    for (let other = index + 1; other < entries.length; other += 1) {
      if (intervalOverlaps(entries[index], entries[other])) fail("REGULATORY_APPROVAL_OVERLAP");
    }
  }
}

function sortedEntries(entries: readonly RegulatoryApprovalEffectiveEntry[]): readonly RegulatoryApprovalEffectiveEntry[] {
  return [...entries].sort((left, right) => Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom)
    || (left.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(left.effectiveTo)) - (right.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(right.effectiveTo))
    || left.targetRecordId.localeCompare(right.targetRecordId)
    || left.targetRecordChecksum.localeCompare(right.targetRecordChecksum));
}

function sameTarget(entry: RegulatoryApprovalEffectiveEntry, value: RegulatoryValueRecord): boolean {
  return entry.targetRecordId === value.id && entry.targetRecordChecksum.toLowerCase() === value.checksum.toLowerCase();
}

export function isEffectiveApproval(state: RegulatoryApprovalDomainState, value: RegulatoryValueRecord): boolean {
  return state.effectiveApprovals.some((entry) => sameTarget(entry, value));
}

function persistenceConflict(error: unknown): boolean {
  const code = error instanceof Error ? error.message : String(error);
  return code === "PERSISTENCE_VERSION_CONFLICT"
    || code === "PERSISTENCE_RECORD_ALREADY_EXISTS"
    || code === "PERSISTENCE_APPEND_ONLY_CONFLICT"
    || code === "23505"
    || /unique_violation|duplicate key/i.test(code);
}

function concurrencyConflict(): never { fail("REGULATORY_APPROVAL_CONCURRENCY_CONFLICT"); }

interface DecisionEventInput {
  readonly tenantId: string;
  readonly domainStateId: string;
  readonly targetRecordId: string;
  readonly targetRecordChecksum: string;
  readonly decision: RegulatoryApprovalDecision;
  readonly principalId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly evidenceReference: string;
  readonly action: string;
  readonly replacesRecordId?: string;
  readonly replacesChecksum?: string;
}

export function deterministicApprovalEventId(input: DecisionEventInput): string {
  const stable = JSON.stringify([
    input.tenantId,
    input.domainStateId,
    input.targetRecordId,
    input.targetRecordChecksum.toLowerCase(),
    input.decision,
    input.principalId,
    input.idempotencyKey,
    input.correlationId,
    input.evidenceReference,
    input.action,
    input.replacesRecordId ?? null,
    input.replacesChecksum?.toLowerCase() ?? null,
  ]);
  return `audit_${createHash("sha256").update(stable, "utf8").digest("hex").slice(0, 32)}`;
}

function auditEquivalent(left: AuditEvent, right: AuditEvent): boolean {
  return left.eventId === right.eventId
    && left.tenantId === right.tenantId
    && left.principalId === right.principalId
    && left.role === right.role
    && left.action === right.action
    && left.resourceType === right.resourceType
    && left.resourceId === right.resourceId
    && left.outcome === right.outcome
    && left.correlationId === right.correlationId
    && JSON.stringify(Object.entries(left.metadata).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))) === JSON.stringify(Object.entries(right.metadata).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
}

async function appendOrReuseAudit(repository: AuditEventRepository, candidate: AuditEvent): Promise<AuditEvent> {
  const existing = await repository.get(candidate.tenantId!, candidate.eventId);
  if (existing) {
    if (auditEquivalent(existing.payload, candidate)) return existing.payload;
    fail("REGULATORY_APPROVAL_AUDIT_CONFLICT");
  }
  try {
    const saved = await repository.append({ tenantId: candidate.tenantId!, recordId: candidate.eventId, payload: candidate, idempotencyKey: candidate.eventId, now: candidate.timestamp });
    return saved.payload;
  } catch (error) {
    if (!persistenceConflict(error)) throw error;
    const raced = await repository.get(candidate.tenantId!, candidate.eventId);
    if (raced && auditEquivalent(raced.payload, candidate)) return raced.payload;
    return concurrencyConflict();
  }
}

function buildAuditEvent(input: DecisionEventInput): AuditEvent {
  const eventId = deterministicApprovalEventId(input);
  const timestamp = new Date().toISOString();
  const metadata: Record<string, string> = {
    decision: input.decision,
    targetChecksum: input.targetRecordChecksum,
    domainStateId: input.domainStateId,
    evidenceReference: input.evidenceReference,
  };
  if (input.replacesRecordId) metadata.replacesRecordId = input.replacesRecordId;
  if (input.replacesChecksum) metadata.replacesChecksum = input.replacesChecksum;
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    eventId,
    tenantId: input.tenantId,
    principalId: input.principalId,
    role: "ADMIN",
    action: input.action,
    resourceType: "REGULATORY_VALUE",
    resourceId: input.targetRecordId,
    timestamp,
    outcome: "ALLOWED",
    correlationId: input.correlationId,
    metadata,
  };
}

async function target(repository: TenantRecordRepository<RegulatoryValueRecord>, tenantId: string, recordId: string): Promise<RegulatoryValueRecord> {
  const stored = await repository.get(tenantId, recordId);
  if (!stored) fail("REGULATORY_RECORD_NOT_FOUND");
  return assertTargetRecord(stored.payload, tenantId);
}

async function state(repository: TenantRecordRepository<RegulatoryApprovalDomainState>, tenantId: string, stateId: string, domainKey: string): Promise<TenantRecord<RegulatoryApprovalDomainState> | null> {
  const stored = await repository.get(tenantId, stateId);
  if (!stored) return null;
  assertDomainState(stored.payload, domainKey);
  return stored;
}

function result(decision: RegulatoryApprovalResult["decision"], effective: boolean, idempotent: boolean, domainKey: string, domainStateId: string, value: RegulatoryValueRecord, decisionEventId: string): RegulatoryApprovalResult {
  return { effective, idempotent, decision, domainKey, domainStateId, targetRecordId: value.id, targetRecordChecksum: value.checksum, decisionEventId };
}

export class RegulatoryApprovalDomainService {
  private readonly repositories: RegulatoryApprovalRepositories;

  constructor(repositories: RegulatoryApprovalRepositories) { this.repositories = repositories; }

  async approveRegulatoryValue(input: RegulatoryApprovalRequest): Promise<RegulatoryApprovalResult> {
    assertRequest(input);
    const value = await target(this.repositories.regulatoryValues, input.tenantId, input.targetRecordId);
    const domainKey = collisionDomainKey(value);
    const domainStateId = regulatoryApprovalDomainId(input.tenantId, domainKey);
    let current = await state(this.repositories.approvalDomains, input.tenantId, domainStateId, domainKey);
    const existingEntry = current?.payload.effectiveApprovals.find((entry) => sameTarget(entry, value));
    if (existingEntry) return result("APPROVE", true, true, domainKey, domainStateId, value, existingEntry.decisionEventId);
    if (current?.payload.effectiveApprovals.some((entry) => intervalOverlaps(entry, value))) fail("REGULATORY_APPROVAL_BLOCKED");

    const eventInput: DecisionEventInput = { tenantId: input.tenantId, domainStateId, targetRecordId: value.id, targetRecordChecksum: value.checksum, decision: "APPROVE", principalId: input.principalId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, evidenceReference: input.evidenceReference, action: "REGULATORY_VALUE_APPROVAL" };
    const event = await appendOrReuseAudit(this.repositories.auditEvents, buildAuditEvent(eventInput));

    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
      const freshEntry = current?.payload.effectiveApprovals.find((entry) => sameTarget(entry, value));
      if (freshEntry) return result("APPROVE", true, true, domainKey, domainStateId, value, freshEntry.decisionEventId);
      if (current?.payload.effectiveApprovals.some((entry) => intervalOverlaps(entry, value))) fail("REGULATORY_APPROVAL_BLOCKED");
      const base = current?.payload ?? emptyState(value);
      const payload: RegulatoryApprovalDomainState = { ...base, effectiveApprovals: sortedEntries([...base.effectiveApprovals, { targetRecordId: value.id, targetRecordChecksum: value.checksum, effectiveFrom: value.effectiveFrom, effectiveTo: value.effectiveTo, decisionEventId: event.eventId }]) };
      assertNoOverlap(payload.effectiveApprovals);
      try {
        await this.repositories.approvalDomains.put({ tenantId: input.tenantId, recordId: domainStateId, payload, expectedVersion: current?.version, idempotencyKey: event.eventId });
        return result("APPROVE", true, false, domainKey, domainStateId, value, event.eventId);
      } catch (error) {
        if (!persistenceConflict(error)) throw error;
        current = await state(this.repositories.approvalDomains, input.tenantId, domainStateId, domainKey);
        if (attempt === MAX_CAS_ATTEMPTS) return concurrencyConflict();
      }
    }
    return concurrencyConflict();
  }

  async revokeRegulatoryValue(input: RegulatoryApprovalRequest): Promise<RegulatoryApprovalResult> {
    assertRequest(input);
    const value = await target(this.repositories.regulatoryValues, input.tenantId, input.targetRecordId);
    const domainKey = collisionDomainKey(value);
    const domainStateId = regulatoryApprovalDomainId(input.tenantId, domainKey);
    let current = await state(this.repositories.approvalDomains, input.tenantId, domainStateId, domainKey);
    const eventInput: DecisionEventInput = { tenantId: input.tenantId, domainStateId, targetRecordId: value.id, targetRecordChecksum: value.checksum, decision: "REVOKE", principalId: input.principalId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, evidenceReference: input.evidenceReference, action: "REGULATORY_VALUE_REVOCATION" };
    const event = await appendOrReuseAudit(this.repositories.auditEvents, buildAuditEvent(eventInput));

    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
      if (!current) return result("REVOKE", false, true, domainKey, domainStateId, value, event.eventId);
      const matching = current.payload.effectiveApprovals.some((entry) => sameTarget(entry, value));
      if (!matching) return result("REVOKE", false, true, domainKey, domainStateId, value, event.eventId);
      const payload: RegulatoryApprovalDomainState = { ...current.payload, effectiveApprovals: sortedEntries(current.payload.effectiveApprovals.filter((entry) => !sameTarget(entry, value))) };
      try {
        await this.repositories.approvalDomains.put({ tenantId: input.tenantId, recordId: domainStateId, payload, expectedVersion: current.version, idempotencyKey: event.eventId });
        return result("REVOKE", true, false, domainKey, domainStateId, value, event.eventId);
      } catch (error) {
        if (!persistenceConflict(error)) throw error;
        current = await state(this.repositories.approvalDomains, input.tenantId, domainStateId, domainKey);
        if (attempt === MAX_CAS_ATTEMPTS) return concurrencyConflict();
      }
    }
    return concurrencyConflict();
  }

  async replaceRegulatoryValue(input: RegulatoryApprovalReplacementRequest): Promise<RegulatoryApprovalResult> {
    assertRequest({ ...input, targetRecordId: input.newTargetRecordId });
    const oldValue = await target(this.repositories.regulatoryValues, input.tenantId, input.oldTargetRecordId);
    const newValue = await target(this.repositories.regulatoryValues, input.tenantId, input.newTargetRecordId);
    const oldDomainKey = collisionDomainKey(oldValue);
    const newDomainKey = collisionDomainKey(newValue);
    if (oldDomainKey !== newDomainKey) fail("REGULATORY_APPROVAL_DOMAIN_MISMATCH");
    const domainKey = oldDomainKey;
    const domainStateId = regulatoryApprovalDomainId(input.tenantId, domainKey);
    let current = await state(this.repositories.approvalDomains, input.tenantId, domainStateId, domainKey);
    const eventInput: DecisionEventInput = { tenantId: input.tenantId, domainStateId, targetRecordId: newValue.id, targetRecordChecksum: newValue.checksum, decision: "APPROVE", principalId: input.principalId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, evidenceReference: input.evidenceReference, action: "REGULATORY_VALUE_REPLACEMENT", replacesRecordId: oldValue.id, replacesChecksum: oldValue.checksum };
    const eventId = deterministicApprovalEventId(eventInput);
    const existingNew = current?.payload.effectiveApprovals.find((entry) => sameTarget(entry, newValue));
    if (!current || !current.payload.effectiveApprovals.some((entry) => sameTarget(entry, oldValue))) {
      if (existingNew?.decisionEventId === eventId) return result("REPLACE", true, true, domainKey, domainStateId, newValue, eventId);
      fail("REGULATORY_APPROVAL_NOT_EFFECTIVE");
    }
    if (existingNew) fail("REGULATORY_APPROVAL_BLOCKED");
    const event = await appendOrReuseAudit(this.repositories.auditEvents, buildAuditEvent(eventInput));

    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
      const oldEntry = current?.payload.effectiveApprovals.find((entry) => sameTarget(entry, oldValue));
      const newEntry = current?.payload.effectiveApprovals.find((entry) => sameTarget(entry, newValue));
      if (!oldEntry && newEntry?.decisionEventId === event.eventId) return result("REPLACE", true, true, domainKey, domainStateId, newValue, event.eventId);
      if (!oldEntry) fail("REGULATORY_APPROVAL_NOT_EFFECTIVE");
      if (newEntry) fail("REGULATORY_APPROVAL_BLOCKED");
      const base = current!.payload;
      const retained = base.effectiveApprovals.filter((entry) => !sameTarget(entry, oldValue));
      const replacement: RegulatoryApprovalEffectiveEntry = { targetRecordId: newValue.id, targetRecordChecksum: newValue.checksum, effectiveFrom: newValue.effectiveFrom, effectiveTo: newValue.effectiveTo, decisionEventId: event.eventId };
      if (retained.some((entry) => intervalOverlaps(entry, newValue))) fail("REGULATORY_APPROVAL_BLOCKED");
      const payload: RegulatoryApprovalDomainState = { ...base, effectiveApprovals: sortedEntries([...retained, replacement]) };
      assertNoOverlap(payload.effectiveApprovals);
      try {
        await this.repositories.approvalDomains.put({ tenantId: input.tenantId, recordId: domainStateId, payload, expectedVersion: current!.version, idempotencyKey: event.eventId });
        return result("REPLACE", true, false, domainKey, domainStateId, newValue, event.eventId);
      } catch (error) {
        if (!persistenceConflict(error)) throw error;
        current = await state(this.repositories.approvalDomains, input.tenantId, domainStateId, domainKey);
        if (attempt === MAX_CAS_ATTEMPTS) return concurrencyConflict();
      }
    }
    return concurrencyConflict();
  }
}

export function approveRegulatoryValue(repositories: RegulatoryApprovalRepositories, input: RegulatoryApprovalRequest): Promise<RegulatoryApprovalResult> {
  return new RegulatoryApprovalDomainService(repositories).approveRegulatoryValue(input);
}

export function revokeRegulatoryValue(repositories: RegulatoryApprovalRepositories, input: RegulatoryApprovalRequest): Promise<RegulatoryApprovalResult> {
  return new RegulatoryApprovalDomainService(repositories).revokeRegulatoryValue(input);
}

export function replaceRegulatoryValue(repositories: RegulatoryApprovalRepositories, input: RegulatoryApprovalReplacementRequest): Promise<RegulatoryApprovalResult> {
  return new RegulatoryApprovalDomainService(repositories).replaceRegulatoryValue(input);
}
