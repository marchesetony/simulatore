import type { RegulatoryValueRecord } from "./foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateChecksum, validateTenantId } from "./foundation/regulatory-validation.ts";
import type { TenantRecord, TenantRecordRepository } from "./persistence/types.ts";
import type { RegulatoryApprovalDomainState } from "./regulatory-approval-domain.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { collisionDomainKey, isEffectiveApproval, regulatoryApprovalDomainId, validateRegulatoryApprovalDomainState } from "./regulatory-approval-domain.ts";

export interface RegulatoryValueQuery {
  readonly componentCode?: RegulatoryValueRecord["componentCode"];
  readonly customerScope?: RegulatoryValueRecord["customerScope"];
  readonly normalizedUnit?: RegulatoryValueRecord["normalizedUnit"];
  readonly effectiveAt?: string;
}

export type RegulatoryValueRepository = TenantRecordRepository<RegulatoryValueRecord>;

function fail(code: string): never { throw new Error(code); }

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") return fail(code);
  return value;
}

function assertEffectiveInterval(value: RegulatoryValueRecord): void {
  const from = Date.parse(value.effectiveFrom);
  const to = value.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(value.effectiveTo);
  if (!Number.isFinite(from) || (value.effectiveTo !== null && !Number.isFinite(to)) || from >= to) fail("REGULATORY_EFFECTIVE_INTERVAL_INVALID");
}

function assertRecordShape(value: RegulatoryValueRecord, tenantId: string): void {
  validateTenantId(tenantId);
  if (value.tenantId !== tenantId) fail("REGULATORY_TENANT_MISMATCH");
  if (value.vector !== "EE") fail("REGULATORY_VECTOR_UNSUPPORTED");
  if (value.authority !== "ARERA" && value.authority !== "TERNA") fail("REGULATORY_AUTHORITY_INVALID");
  requiredString(value.id, "REGULATORY_ID_INVALID");
  requiredString(value.identityKey, "REGULATORY_IDENTITY_INVALID");
  requiredString(value.componentCode, "REGULATORY_COMPONENT_INVALID");
  requiredString(value.customerScope, "REGULATORY_SCOPE_INVALID");
  requiredString(value.officialIdentifier, "REGULATORY_OFFICIAL_IDENTIFIER_INVALID");
  requiredString(value.applicationBasis, "REGULATORY_APPLICATION_BASIS_INVALID");
  if (!/^https:\/\//.test(value.sourceReference)) fail("REGULATORY_PROVENANCE_INVALID");
  if (!/^[a-f0-9]{64}$/i.test(value.sourceSha256)) fail("REGULATORY_PROVENANCE_INVALID");
  if (!Array.isArray(value.conversionProvenance) || value.conversionProvenance.some((item) => typeof item !== "string" || item.trim() === "")) fail("REGULATORY_PROVENANCE_INVALID");
  if (!Number.isFinite(value.originalValue) || !Number.isFinite(value.normalizedValue)) fail("REGULATORY_VALUE_INVALID");
  requiredString(value.originalUnit, "REGULATORY_UNIT_INVALID");
  requiredString(value.normalizedUnit, "REGULATORY_UNIT_INVALID");
  if (!Number.isFinite(Date.parse(value.publicationDate)) || !Number.isFinite(Date.parse(value.retrievedAt))) fail("REGULATORY_PROVENANCE_INVALID");
  assertEffectiveInterval(value);
  if (typeof value.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(value.checksum)) fail("REGULATORY_CHECKSUM_INVALID");
  try { validateChecksum(value); } catch { fail("REGULATORY_CHECKSUM_INVALID"); }
}

function isApplicable(value: RegulatoryValueRecord, instant: string): boolean {
  const at = Date.parse(instant);
  if (!Number.isFinite(at)) fail("REGULATORY_EFFECTIVE_DATE_INVALID");
  const from = Date.parse(value.effectiveFrom);
  const to = value.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(value.effectiveTo);
  return from <= at && at < to;
}

function valueFromRecord(record: TenantRecord<RegulatoryValueRecord>, tenantId: string): RegulatoryValueRecord {
  const value = record.payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("REGULATORY_RECORD_INVALID");
  assertRecordShape(value, tenantId);
  return value;
}

export class ProductionRegulatoryPersistenceBridge {
  private readonly repository: RegulatoryValueRepository;
  private readonly approvalDomains: TenantRecordRepository<RegulatoryApprovalDomainState>;

  constructor(repository: RegulatoryValueRepository, approvalDomains: TenantRecordRepository<RegulatoryApprovalDomainState>) { this.repository = repository; this.approvalDomains = approvalDomains; }

  async save(tenantId: string, value: RegulatoryValueRecord): Promise<TenantRecord<RegulatoryValueRecord>> {
    assertRecordShape(value, tenantId);
    const existing = await this.repository.get(tenantId, value.id);
    if (existing) {
      const existingValue = valueFromRecord(existing, tenantId);
      if (existingValue.checksum === value.checksum) return existing;
      fail("REGULATORY_RECORD_CONFLICT");
    }
    return this.repository.append({ tenantId, recordId: value.id, payload: value, idempotencyKey: value.checksum });
  }

  async list(tenantId: string, query: RegulatoryValueQuery = {}): Promise<readonly RegulatoryValueRecord[]> {
    validateTenantId(tenantId);
    const records = await this.repository.list(tenantId);
    const visible = await Promise.all(records.map(async (record) => {
      const candidate = valueFromRecord(record, tenantId);
      if (query.componentCode !== undefined && candidate.componentCode !== query.componentCode) return [];
      if (query.customerScope !== undefined && candidate.customerScope !== query.customerScope) return [];
      if (query.normalizedUnit !== undefined && candidate.normalizedUnit !== query.normalizedUnit) return [];
      if (query.effectiveAt !== undefined && !isApplicable(candidate, query.effectiveAt)) return [];
      const domainKey = collisionDomainKey(candidate);
      const stateId = regulatoryApprovalDomainId(tenantId, domainKey);
      const stored = await this.approvalDomains.get(tenantId, stateId);
      if (!stored) return [];
      const state = validateRegulatoryApprovalDomainState(stored.payload, domainKey);
      return isEffectiveApproval(state, candidate) ? [candidate] : [];
    }));
    return visible.flat();
  }

  async resolve(tenantId: string, query: Required<Pick<RegulatoryValueQuery, "componentCode" | "customerScope" | "effectiveAt">>): Promise<RegulatoryValueRecord | null> {
    const matches = await this.list(tenantId, query);
    if (matches.length > 1) fail("REGULATORY_APPROVED_VALUE_CONFLICT");
    return matches[0] ?? null;
  }
}
