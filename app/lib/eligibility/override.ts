import { randomUUID } from "node:crypto";
import type { AuthenticatedPrincipal } from "../auth/types";
import type { RuntimeRepositories } from "../persistence/adapter";
import type { TenantRecord } from "../persistence/types";
import type { EligibilityReasonCode } from "./domain";
import type { CteArchiveRecord } from "../cte/archive/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billVisibilityScope, getBillInScope } from "../foundation/bill-visibility.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { currentApprovedCteVersion, commercialStatusOf } from "../cte/archive/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { canAuthorizeCte, loadHierarchyAccess } from "../hierarchy/service.ts";

export type EligibilityOverrideStatus = "REQUESTED" | "AUTHORIZED" | "REJECTED" | "EXPIRED" | "USED";
// Tony (29/10): every commercial condition of a CTE can be authorized; what makes the calculation impossible cannot.
export type EligibilityOverrideScope = Extract<EligibilityReasonCode, "CUSTOMER_LEGAL_TYPE_MISMATCH" | "SUPPLY_USE_MISMATCH" | "IDENTIFIER_TYPE_MISMATCH" | "VOLTAGE_MISMATCH" | "CONSUMPTION_THRESHOLD_MISMATCH" | "POWER_THRESHOLD_MISMATCH" | "CONDOMINIUM_ONLY">;

export interface EligibilityOverride {
  readonly overrideId: string;
  readonly tenantId: string;
  readonly billId: string;
  readonly billVersionId: string;
  readonly cteId: string;
  readonly requestedByUserId: string;
  readonly authorizedByUserId: string | null;
  readonly createdAt: string;
  readonly authorizedAt: string | null;
  readonly reason: string;
  readonly overrideScope: readonly EligibilityOverrideScope[];
  readonly originalMismatchReasons: readonly EligibilityReasonCode[];
  readonly status: EligibilityOverrideStatus;
  readonly expiresAt?: string;
  readonly oneShot: boolean;
  readonly simulationId?: string;
  /** Authorized straight away by someone holding the permission in the company chain, for this bill only. */
  readonly grantedDirectly?: boolean;
}

export interface EligibilityOverrideProvenance {
  readonly overrideId: string;
  readonly authorizedByUserId: string;
  readonly authorizedAt: string;
  readonly reason: string;
  readonly originalMismatchReasons: readonly EligibilityReasonCode[];
}

export interface EligibilityOverrideCapabilities {
  readonly role: "SUPER_ADMIN" | "ADMIN" | "AGENT";
  readonly canRequest: boolean;
  readonly canAuthorize: boolean;
  readonly canReject: boolean;
}

const overrideable = new Set<EligibilityReasonCode>(["CUSTOMER_LEGAL_TYPE_MISMATCH", "SUPPLY_USE_MISMATCH", "IDENTIFIER_TYPE_MISMATCH", "VOLTAGE_MISMATCH", "CONSUMPTION_THRESHOLD_MISMATCH", "POWER_THRESHOLD_MISMATCH", "CONDOMINIUM_ONLY"]);
export function isEligibilityOverrideable(reason: EligibilityReasonCode): boolean { return overrideable.has(reason); }
const id = (value: string, code: string): string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : (() => { throw new Error(code); })();
const reasonText = (value: string): string => typeof value === "string" && value.trim().length > 0 && value.length <= 2000 ? value.trim() : (() => { throw new Error("OVERRIDE_REASON_INVALID"); })();
const nowIso = (value?: string): string => { const result = value ?? new Date().toISOString(); if (!Number.isFinite(Date.parse(result))) throw new Error("OVERRIDE_TIMESTAMP_INVALID"); return new Date(result).toISOString(); };

function validateReasons(reasons: readonly EligibilityReasonCode[]): readonly EligibilityOverrideScope[] {
  if (!Array.isArray(reasons) || reasons.length === 0 || reasons.some((reason) => !overrideable.has(reason))) throw new Error("OVERRIDE_SCOPE_NOT_ALLOWED");
  return [...new Set(reasons)] as EligibilityOverrideScope[];
}

function recordOf(value: TenantRecord<EligibilityOverride> | null): EligibilityOverride {
  if (!value || value.payload.overrideId !== value.recordId || value.payload.tenantId !== value.tenantId) throw new Error("OVERRIDE_NOT_FOUND");
  return value.payload;
}

async function assertSourceIntegrity(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, input: Pick<EligibilityOverride, "billId" | "billVersionId" | "cteId">): Promise<CteArchiveRecord> {
  const bill = await getBillInScope(principal, repositories, input.billId);
  if (!bill || bill.tenantId !== principal.tenantId || bill.currentApprovedVersionId !== input.billVersionId) throw new Error("MISSING_SOURCE_DOCUMENT");
  const direct = await repositories.cteArchiveRepository.get(principal.tenantId, input.cteId);
  const cte = direct ?? (await repositories.cteArchiveRepository.list(principal.tenantId)).find((candidate) => candidate.cteId === input.cteId) ?? null;
  if (!cte || cte.tenantId !== principal.tenantId || (cte.archiveId !== input.cteId && cte.cteId !== input.cteId)) throw new Error("TENANT_MISMATCH");
  const version = currentApprovedCteVersion(cte);
  if (!version || version.status !== "APPROVED" || version.contract.approval.status !== "APPROVED" || commercialStatusOf(cte) !== "ACTIVE") throw new Error("INVALID_CTE");
  return cte as CteArchiveRecord;
}

export async function requestEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, input: { readonly billId: string; readonly billVersionId: string; readonly cteId: string; readonly reason: string; readonly originalMismatchReasons: readonly EligibilityReasonCode[]; readonly expiresAt?: string; readonly oneShot?: boolean; readonly simulationId?: string; readonly now?: string }): Promise<EligibilityOverride> {
  const sourceCte = await assertSourceIntegrity(principal, repositories, input);
  const originalMismatchReasons = [...new Set(input.originalMismatchReasons)];
  const overrideScope = validateReasons(originalMismatchReasons);
  const createdAt = nowIso(input.now);
  const override: EligibilityOverride = { overrideId: `override_${randomUUID().replaceAll("-", "")}`, tenantId: principal.tenantId, billId: id(input.billId, "BILL_ID_INVALID"), billVersionId: id(input.billVersionId, "BILL_VERSION_ID_INVALID"), cteId: sourceCte.cteId, requestedByUserId: principal.userId, authorizedByUserId: null, createdAt, authorizedAt: null, reason: reasonText(input.reason), overrideScope, originalMismatchReasons, status: "REQUESTED", ...(input.expiresAt ? { expiresAt: nowIso(input.expiresAt) } : {}), oneShot: input.oneShot ?? true, ...(input.simulationId ? { simulationId: id(input.simulationId, "SIMULATION_ID_INVALID") } : {}) };
  await repositories.eligibilityOverrides.append({ tenantId: principal.tenantId, recordId: override.overrideId, payload: override, idempotencyKey: override.overrideId, now: createdAt });
  await recordRuntimeAudit({ principal, action: "OVERRIDE_REQUESTED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: override.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: override.billId, billVersionId: override.billVersionId, cteId: override.cteId, reason: override.reason, originalMismatchCount: override.originalMismatchReasons.length } });
  return override;
}

// Tony (29/10): the company administrator, and whoever they pass the permission to down the chain, authorizes a CTE the
// rules leave out directly from the quote, with a reason; it holds for that bill and is recorded in the audit.
export async function grantEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, input: { readonly billId: string; readonly billVersionId: string; readonly cteId: string; readonly reason: string; readonly originalMismatchReasons: readonly EligibilityReasonCode[]; readonly now?: string }): Promise<EligibilityOverride> {
  const access = await loadHierarchyAccess(principal, repositories, (input.now ?? new Date().toISOString()).slice(0, 10));
  if (!canAuthorizeCte(access)) throw new Error("OVERRIDE_AUTHORIZATION_DENIED");
  const sourceCte = await assertSourceIntegrity(principal, repositories, input);
  const originalMismatchReasons = [...new Set(input.originalMismatchReasons)];
  const overrideScope = validateReasons(originalMismatchReasons);
  const at = nowIso(input.now);
  const override: EligibilityOverride = { overrideId: `override_${randomUUID().replaceAll("-", "")}`, tenantId: principal.tenantId, billId: id(input.billId, "BILL_ID_INVALID"), billVersionId: id(input.billVersionId, "BILL_VERSION_ID_INVALID"), cteId: sourceCte.cteId, requestedByUserId: principal.userId, authorizedByUserId: principal.userId, createdAt: at, authorizedAt: at, reason: reasonText(input.reason), overrideScope, originalMismatchReasons, status: "AUTHORIZED", oneShot: false, grantedDirectly: true };
  await repositories.eligibilityOverrides.append({ tenantId: principal.tenantId, recordId: override.overrideId, payload: override, idempotencyKey: override.overrideId, now: at });
  await recordRuntimeAudit({ principal, action: "OVERRIDE_AUTHORIZED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: override.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: override.billId, billVersionId: override.billVersionId, cteId: override.cteId, reason: override.reason, grantedDirectly: true } });
  return override;
}

export async function authorizeEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, overrideId: string, now?: string, authorizationReason?: string): Promise<EligibilityOverride> {
  const record = await repositories.eligibilityOverrides.get(principal.tenantId, id(overrideId, "OVERRIDE_ID_INVALID"));
  const current = recordOf(record);
  if (current.tenantId !== principal.tenantId || current.status !== "REQUESTED") throw new Error("OVERRIDE_STATE_INVALID");
  if (current.requestedByUserId === principal.userId) throw new Error("OVERRIDE_SELF_APPROVAL_DENIED");
  const scope = await billVisibilityScope(principal, repositories);
  if (scope.role === "AGENT") throw new Error("OVERRIDE_AUTHORIZATION_DENIED");
  await assertSourceIntegrity(principal, repositories, current);
  if (scope.role === "ADMIN") {
    const bill = await getBillInScope(principal, repositories, current.billId);
    if (!bill) throw new Error("OVERRIDE_SCOPE_DENIED");
  }
  const authorizedAt = nowIso(now);
  const authorized: EligibilityOverride = { ...current, authorizedByUserId: principal.userId, authorizedAt, status: "AUTHORIZED", reason: authorizationReason === undefined ? current.reason : reasonText(authorizationReason) };
  await repositories.eligibilityOverrides.put({ tenantId: principal.tenantId, recordId: current.overrideId, expectedVersion: record?.version, payload: authorized, now: authorizedAt });
  await recordRuntimeAudit({ principal, action: "OVERRIDE_AUTHORIZED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: current.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: current.billId, billVersionId: current.billVersionId, cteId: current.cteId } });
  return authorized;
}

export async function rejectEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, overrideId: string, rejectionReason: string, now?: string): Promise<EligibilityOverride> {
  const record = await repositories.eligibilityOverrides.get(principal.tenantId, id(overrideId, "OVERRIDE_ID_INVALID"));
  const current = recordOf(record);
  if (current.status !== "REQUESTED") throw new Error("OVERRIDE_STATE_INVALID");
  if (current.requestedByUserId === principal.userId) throw new Error("OVERRIDE_SELF_APPROVAL_DENIED");
  const scope = await billVisibilityScope(principal, repositories);
  if (scope.role === "AGENT") throw new Error("OVERRIDE_AUTHORIZATION_DENIED");
  await assertSourceIntegrity(principal, repositories, current);
  const rejectedAt = nowIso(now);
  const rejected: EligibilityOverride = { ...current, authorizedByUserId: principal.userId, authorizedAt: rejectedAt, status: "REJECTED", reason: reasonText(rejectionReason) };
  await repositories.eligibilityOverrides.put({ tenantId: principal.tenantId, recordId: current.overrideId, expectedVersion: record?.version, payload: rejected, now: rejectedAt });
  await recordRuntimeAudit({ principal, action: "OVERRIDE_REJECTED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: current.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: current.billId, billVersionId: current.billVersionId, cteId: current.cteId } });
  return rejected;
}

async function expireOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, record: TenantRecord<EligibilityOverride>, now: string): Promise<EligibilityOverride> {
  const current = recordOf(record);
  if (current.status !== "AUTHORIZED") return current;
  const expiredValue: EligibilityOverride = { ...current, status: "EXPIRED" };
  await repositories.eligibilityOverrides.put({ tenantId: principal.tenantId, recordId: current.overrideId, expectedVersion: record.version, payload: expiredValue, now });
  await recordRuntimeAudit({ principal, action: "OVERRIDE_EXPIRED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: current.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: current.billId, billVersionId: current.billVersionId, cteId: current.cteId } });
  return expiredValue;
}

export async function eligibilityOverrideUiState(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, billId: string, billVersionId: string, now = new Date().toISOString()): Promise<{ readonly capabilities: EligibilityOverrideCapabilities; readonly overrides: readonly EligibilityOverride[] }> {
  const bill = await getBillInScope(principal, repositories, billId);
  if (!bill || bill.currentApprovedVersionId !== billVersionId) throw new Error("SOURCE_BILL_VERSION_MISMATCH");
  const scope = await billVisibilityScope(principal, repositories);
  const records = await repositories.eligibilityOverrides.list(principal.tenantId);
  const at = nowIso(now);
  const overrides: EligibilityOverride[] = [];
  for (const record of records) {
    const current = recordOf(record);
    if (current.billId !== billId || current.billVersionId !== billVersionId) continue;
    if (current.status === "AUTHORIZED" && current.expiresAt && current.expiresAt <= at) overrides.push(await expireOverride(principal, repositories, record, at));
    else overrides.push(current);
  }
  return { capabilities: { role: scope.role, canRequest: true, canAuthorize: scope.role !== "AGENT", canReject: scope.role !== "AGENT" }, overrides };
}

export async function assertUsableEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, input: { readonly overrideId: string; readonly billId: string; readonly billVersionId: string; readonly cteId: string; readonly mismatchReasons: readonly EligibilityReasonCode[]; readonly now?: string }): Promise<{ readonly record: EligibilityOverride; readonly provenance: EligibilityOverrideProvenance }> {
  const overrideRecord = await repositories.eligibilityOverrides.get(principal.tenantId, id(input.overrideId, "OVERRIDE_ID_INVALID"));
  const override = recordOf(overrideRecord);
  const at = nowIso(input.now);
  if (override.tenantId !== principal.tenantId || override.status !== "AUTHORIZED" || override.billId !== input.billId || override.billVersionId !== input.billVersionId || override.cteId !== input.cteId || !override.authorizedByUserId || (override.authorizedByUserId === override.requestedByUserId && override.grantedDirectly !== true)) throw new Error("SECURITY_FAILURE");
  if (override.expiresAt && override.expiresAt <= at) {
    await expireOverride(principal, repositories, overrideRecord!, at);
    throw new Error("OVERRIDE_EXPIRED");
  }
  if (input.mismatchReasons.some((reason) => !override.overrideScope.includes(reason as EligibilityOverrideScope))) throw new Error("OVERRIDE_SCOPE_NOT_ALLOWED");
  const cte = await assertSourceIntegrity(principal, repositories, input);
  const version = currentApprovedCteVersion(cte);
  if (!version || version.contract.expiry.status === "EXPIRES_ON" && version.contract.expiry.date <= at.slice(0, 10)) throw new Error("EXPIRED_CTE");
  return { record: override, provenance: { overrideId: override.overrideId, authorizedByUserId: override.authorizedByUserId, authorizedAt: override.authorizedAt!, reason: override.reason, originalMismatchReasons: override.originalMismatchReasons } };
}

export async function markEligibilityOverrideUsed(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, overrideId: string, now?: string): Promise<void> {
  const record = await repositories.eligibilityOverrides.get(principal.tenantId, id(overrideId, "OVERRIDE_ID_INVALID"));
  const current = recordOf(record);
  if (current.tenantId !== principal.tenantId || current.status !== "AUTHORIZED") throw new Error("OVERRIDE_STATE_INVALID");
  const usedAt = nowIso(now);
  const updated: EligibilityOverride = { ...current, status: current.oneShot ? "USED" : "AUTHORIZED" };
  await repositories.eligibilityOverrides.put({ tenantId: principal.tenantId, recordId: current.overrideId, expectedVersion: record?.version, payload: updated, now: usedAt });
  await recordRuntimeAudit({ principal, action: "OVERRIDE_USED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: current.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { oneShot: current.oneShot } });
}

/** The CTEs authorized for one bill version, so the comparison and its later rebuild calculate them alike. */
export async function authorizedOverrideCteIds(repositories: Pick<RuntimeRepositories, "eligibilityOverrides">, tenantId: string, sourceBill: { readonly billId: string; readonly version: string } | undefined, now = new Date().toISOString()): Promise<ReadonlySet<string>> {
  if (!sourceBill) return new Set();
  const records = await repositories.eligibilityOverrides.list(tenantId);
  return new Set(records.map((record) => record.payload).filter((item) => item.tenantId === tenantId && item.billId === sourceBill.billId && item.billVersionId === sourceBill.version && (item.status === "AUTHORIZED" || item.status === "USED") && (!item.expiresAt || item.expiresAt > now)).map((item) => item.cteId));
}
