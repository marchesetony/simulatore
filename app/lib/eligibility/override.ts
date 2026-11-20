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
import { buildOrgChainIndex, canAuthorizeCte, loadHierarchyAccess, nodeCanAuthorizeCte, subtreeUserIds } from "../hierarchy/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { foundationRoleToCanonical, legacyAuthRoleToCanonical } from "../auth/roles.ts";
import type { CtePermissionGrant } from "../hierarchy/types";
import type { CanonicalProductRole } from "../auth/types";

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
  /** Tony (20/11/2026): the approved CTE version in force when the forcing was authorized. */
  readonly cteVersionId?: string;
  /** Tony (20/11/2026): the permission the authorizer held when authorizing ("autorizzazione utilizzata"). */
  readonly authorization?: ForcingAuthority;
}

/**
 * The permission on which a forcing rests, read from the company's own memberships and commercial chain: the company
 * administrator by role, anybody else by "Può forzare" held along the whole chain above them (Tony, 20/11/2026).
 */
export interface ForcingAuthority {
  readonly basis: "COMPANY_ADMIN" | "CHAIN_PERMISSION";
  readonly userId: string;
  /** Who turned "Può forzare" on for this user, and when (absent for the administrator and for grants made before 20/11/2026). */
  readonly permissionGrant?: CtePermissionGrant;
  /** Version of the user's node in the chain when the permission was checked. */
  readonly orgNodeVersion?: number;
  readonly checkedAt: string;
}

export interface EligibilityOverrideProvenance {
  readonly overrideId: string;
  readonly authorizedByUserId: string;
  readonly authorizedAt: string;
  readonly reason: string;
  readonly originalMismatchReasons: readonly EligibilityReasonCode[];
}

export type AuthorityRepositories = { readonly orgChain?: Pick<RuntimeRepositories["orgChain"], "list">; readonly foundationMemberships?: Pick<RuntimeRepositories["foundationMemberships"], "list"> };
/** Who is acting now: a principal without a membership record (local synthetic sessions) is read by its legacy role, as the chain does. */
export interface ForcingActor { readonly userId: string; readonly canonicalRole: CanonicalProductRole }
export function forcingActorOf(principal: Pick<AuthenticatedPrincipal, "userId" | "role">): ForcingActor { return { userId: principal.userId, canonicalRole: legacyAuthRoleToCanonical(principal.role) }; }

/** Loads the company's memberships and chain once, so every override in a list is checked against the same state. */
export async function forcingAuthorityReader(repositories: AuthorityRepositories, tenantId: string, actor?: ForcingActor): Promise<(userId: string, at?: string) => ForcingAuthority | null> {
  const [memberships, nodes] = await Promise.all([repositories.foundationMemberships ? repositories.foundationMemberships.list(tenantId) : Promise.resolve([]), repositories.orgChain ? repositories.orgChain.list(tenantId) : Promise.resolve([])]);
  const index = buildOrgChainIndex(nodes);
  return (userId: string, at = new Date().toISOString()) => {
    const membership = memberships.map((record) => record.payload).find((item) => item.tenantId === tenantId && item.userId === userId);
    if (membership && membership.status !== "ACTIVE") return null;
    const canonical: CanonicalProductRole | null = membership ? foundationRoleToCanonical(membership.role) : actor && actor.userId === userId ? actor.canonicalRole : null;
    if (canonical === "SUPER_ADMIN") return { basis: "COMPANY_ADMIN", userId, checkedAt: at };
    if (canonical === null || !nodeCanAuthorizeCte(index, userId)) return null;
    const node = index.nodes.get(userId);
    return { basis: "CHAIN_PERMISSION", userId, ...(node?.payload.cteForcingGrant ? { permissionGrant: node.payload.cteForcingGrant } : {}), ...(node ? { orgNodeVersion: node.version } : {}), checkedAt: at };
  };
}

/**
 * Tony (20/11/2026): "una revoca impedisce nuove forzature, compreso l'utilizzo di autorizzazioni precedentemente concesse ma
 * non ancora esercitate". An authorized override is usable only while whoever authorized it still holds the permission
 * (active in the company, administrator or "Può forzare" along the whole chain). Offers already produced are not touched.
 */
export function overrideAuthorityHolds(override: Pick<EligibilityOverride, "authorizedByUserId">, authorityOf: (userId: string) => ForcingAuthority | null): boolean {
  return Boolean(override.authorizedByUserId && authorityOf(override.authorizedByUserId));
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
/** Tony (20/11/2026): the reason goes whole into the mandatory audit, which holds 256 characters per value; a longer reason
 *  is refused with its own code, never cut. */
export const OVERRIDE_REASON_MAX_LENGTH = 256;
const reasonText = (value: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("OVERRIDE_REASON_INVALID");
  if (value.trim().length > OVERRIDE_REASON_MAX_LENGTH) throw new Error("OVERRIDE_REASON_TOO_LONG");
  return value.trim();
};

/**
 * Tony (20/11/2026, "atomicità audit e forzatura"): a forcing must never be saved or usable when its mandatory audit could not
 * be recorded. The audit is written first and the record only after it; when the record then fails to be written, a
 * compensating DENIED event says so and the error goes back to the caller. Nothing is ever saved without its audit.
 */
async function auditedWrite<T>(audit: Parameters<typeof recordRuntimeAudit>[0], write: () => Promise<T>): Promise<T> {
  await recordRuntimeAudit(audit);
  try { return await write(); } catch (error) {
    await recordRuntimeAudit({ ...audit, action: `${audit.action}_NOT_SAVED`, outcome: "DENIED", metadata: { ...(audit.metadata ?? {}), failure: error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "WRITE_FAILED" } }).catch(() => undefined);
    throw error;
  }
}
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
  await auditedWrite({ principal, action: "OVERRIDE_REQUESTED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: override.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: override.billId, billVersionId: override.billVersionId, cteId: override.cteId, reason: override.reason, originalMismatchCount: override.originalMismatchReasons.length } },
    () => repositories.eligibilityOverrides.append({ tenantId: principal.tenantId, recordId: override.overrideId, payload: override, idempotencyKey: override.overrideId, now: createdAt }));
  return override;
}

// Tony (29/10): the company administrator, and whoever they pass the permission to down the chain, authorizes a CTE the
// rules leave out directly from the quote, with a reason; it holds for that bill and is recorded in the audit.
export async function grantEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, input: { readonly billId: string; readonly billVersionId: string; readonly cteId: string; readonly reason: string; readonly originalMismatchReasons: readonly EligibilityReasonCode[]; readonly now?: string }): Promise<EligibilityOverride> {
  const access = await loadHierarchyAccess(principal, repositories, (input.now ?? new Date().toISOString()).slice(0, 10));
  if (!canAuthorizeCte(access)) throw new Error("OVERRIDE_AUTHORIZATION_DENIED");
  const at = nowIso(input.now);
  const authority = (await forcingAuthorityReader(repositories, principal.tenantId, forcingActorOf(principal)))(principal.userId, at);
  if (!authority) throw new Error("OVERRIDE_AUTHORIZATION_DENIED");
  const sourceCte = await assertSourceIntegrity(principal, repositories, input);
  const cteVersionId = currentApprovedCteVersion(sourceCte)?.versionId;
  const originalMismatchReasons = [...new Set(input.originalMismatchReasons)];
  const overrideScope = validateReasons(originalMismatchReasons);
  const override: EligibilityOverride = { overrideId: `override_${randomUUID().replaceAll("-", "")}`, tenantId: principal.tenantId, billId: id(input.billId, "BILL_ID_INVALID"), billVersionId: id(input.billVersionId, "BILL_VERSION_ID_INVALID"), cteId: sourceCte.cteId, requestedByUserId: principal.userId, authorizedByUserId: principal.userId, createdAt: at, authorizedAt: at, reason: reasonText(input.reason), overrideScope, originalMismatchReasons, status: "AUTHORIZED", oneShot: false, grantedDirectly: true, ...(cteVersionId ? { cteVersionId } : {}), authorization: authority };
  await auditedWrite({ principal, action: "OVERRIDE_AUTHORIZED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: override.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: override.billId, billVersionId: override.billVersionId, cteId: override.cteId, ...(cteVersionId ? { cteVersionId } : {}), reason: override.reason, grantedDirectly: true, forcingBasis: authority.basis } },
    () => repositories.eligibilityOverrides.append({ tenantId: principal.tenantId, recordId: override.overrideId, payload: override, idempotencyKey: override.overrideId, now: at }));
  return override;
}

/**
 * Tony (20/11/2026, "rifiuto delle richieste"): approving and refusing a forcing request are the same decision and take the
 * same faculty: "Può forzare" (the company administrator holds it by role). Anybody else decides only on requests made
 * below them in the commercial chain, for a bill they see; never on their own request, never across branches.
 */
async function assertRequestDecisionAuthority(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, current: EligibilityOverride, at: string): Promise<ForcingAuthority> {
  if (current.requestedByUserId === principal.userId) throw new Error("OVERRIDE_SELF_APPROVAL_DENIED");
  const access = await loadHierarchyAccess(principal, repositories, at.slice(0, 10));
  const authority = canAuthorizeCte(access) ? (await forcingAuthorityReader(repositories, principal.tenantId, forcingActorOf(principal)))(principal.userId, at) : null;
  if (!authority) throw new Error("OVERRIDE_AUTHORIZATION_DENIED");
  if (authority.basis === "COMPANY_ADMIN") return authority;
  const branch = subtreeUserIds(access.index, principal.userId);
  if (!branch.has(current.requestedByUserId)) throw new Error("OVERRIDE_HIERARCHY_DENIED");
  if (!await getBillInScope(principal, repositories, current.billId)) throw new Error("OVERRIDE_SCOPE_DENIED");
  return authority;
}

export async function authorizeEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, overrideId: string, now?: string, authorizationReason?: string): Promise<EligibilityOverride> {
  const record = await repositories.eligibilityOverrides.get(principal.tenantId, id(overrideId, "OVERRIDE_ID_INVALID"));
  const current = recordOf(record);
  if (current.tenantId !== principal.tenantId || current.status !== "REQUESTED") throw new Error("OVERRIDE_STATE_INVALID");
  if (current.requestedByUserId === principal.userId) throw new Error("OVERRIDE_SELF_APPROVAL_DENIED");
  const authorizedAt = nowIso(now);
  const authority = await assertRequestDecisionAuthority(principal, repositories, current, authorizedAt);
  const sourceCte = await assertSourceIntegrity(principal, repositories, current);
  const cteVersionId = currentApprovedCteVersion(sourceCte)?.versionId;
  const authorized: EligibilityOverride = { ...current, authorizedByUserId: principal.userId, authorizedAt, status: "AUTHORIZED", reason: authorizationReason === undefined ? current.reason : reasonText(authorizationReason), ...(cteVersionId ? { cteVersionId } : {}), authorization: authority };
  await auditedWrite({ principal, action: "OVERRIDE_AUTHORIZED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: current.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: current.billId, billVersionId: current.billVersionId, cteId: current.cteId, ...(cteVersionId ? { cteVersionId } : {}), reason: authorized.reason, forcingBasis: authority.basis } },
    () => repositories.eligibilityOverrides.put({ tenantId: principal.tenantId, recordId: current.overrideId, expectedVersion: record?.version, payload: authorized, now: authorizedAt }));
  return authorized;
}

export async function rejectEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, overrideId: string, rejectionReason: string, now?: string): Promise<EligibilityOverride> {
  const record = await repositories.eligibilityOverrides.get(principal.tenantId, id(overrideId, "OVERRIDE_ID_INVALID"));
  const current = recordOf(record);
  if (current.status !== "REQUESTED") throw new Error("OVERRIDE_STATE_INVALID");
  if (current.requestedByUserId === principal.userId) throw new Error("OVERRIDE_SELF_APPROVAL_DENIED");
  const rejectedAt = nowIso(now);
  await assertRequestDecisionAuthority(principal, repositories, current, rejectedAt);
  await assertSourceIntegrity(principal, repositories, current);
  const rejected: EligibilityOverride = { ...current, authorizedByUserId: principal.userId, authorizedAt: rejectedAt, status: "REJECTED", reason: reasonText(rejectionReason) };
  await auditedWrite({ principal, action: "OVERRIDE_REJECTED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: current.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { billId: current.billId, billVersionId: current.billVersionId, cteId: current.cteId, reason: rejected.reason } },
    () => repositories.eligibilityOverrides.put({ tenantId: principal.tenantId, recordId: current.overrideId, expectedVersion: record?.version, payload: rejected, now: rejectedAt }));
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

export async function eligibilityOverrideUiState(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, billId: string, billVersionId: string, now = new Date().toISOString()): Promise<{ readonly capabilities: EligibilityOverrideCapabilities; readonly overrides: readonly (EligibilityOverride & { readonly authorizationRevoked?: true })[] }> {
  const bill = await getBillInScope(principal, repositories, billId);
  if (!bill || bill.currentApprovedVersionId !== billVersionId) throw new Error("SOURCE_BILL_VERSION_MISMATCH");
  const scope = await billVisibilityScope(principal, repositories);
  const records = await repositories.eligibilityOverrides.list(principal.tenantId);
  const at = nowIso(now);
  const authorityOf = await forcingAuthorityReader(repositories, principal.tenantId, forcingActorOf(principal));
  const overrides: (EligibilityOverride & { readonly authorizationRevoked?: true })[] = [];
  for (const record of records) {
    const current = recordOf(record);
    if (current.billId !== billId || current.billVersionId !== billVersionId) continue;
    if (current.status === "AUTHORIZED" && current.expiresAt && current.expiresAt <= at) overrides.push(await expireOverride(principal, repositories, record, at));
    else overrides.push(current.status === "AUTHORIZED" && !overrideAuthorityHolds(current, (userId) => authorityOf(userId, at)) ? { ...current, authorizationRevoked: true } : current);
  }
  const canAuthorize = scope.role !== "AGENT" && Boolean(authorityOf(principal.userId, at));
  return { capabilities: { role: scope.role, canRequest: true, canAuthorize, canReject: canAuthorize }, overrides };
}

export async function assertUsableEligibilityOverride(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, input: { readonly overrideId: string; readonly billId: string; readonly billVersionId: string; readonly cteId: string; readonly mismatchReasons: readonly EligibilityReasonCode[]; readonly now?: string }): Promise<{ readonly record: EligibilityOverride; readonly provenance: EligibilityOverrideProvenance }> {
  const overrideRecord = await repositories.eligibilityOverrides.get(principal.tenantId, id(input.overrideId, "OVERRIDE_ID_INVALID"));
  const override = recordOf(overrideRecord);
  const at = nowIso(input.now);
  const authorityOf = await forcingAuthorityReader(repositories, principal.tenantId, forcingActorOf(principal));
  if (override.tenantId !== principal.tenantId || override.status !== "AUTHORIZED" || override.billId !== input.billId || override.billVersionId !== input.billVersionId || override.cteId !== input.cteId || !override.authorizedByUserId || (override.authorizedByUserId === override.requestedByUserId && override.grantedDirectly !== true)) throw new Error("SECURITY_FAILURE");
  if (override.expiresAt && override.expiresAt <= at) {
    await expireOverride(principal, repositories, overrideRecord!, at);
    throw new Error("OVERRIDE_EXPIRED");
  }
  if (input.mismatchReasons.some((reason) => !override.overrideScope.includes(reason as EligibilityOverrideScope))) throw new Error("OVERRIDE_SCOPE_NOT_ALLOWED");
  if (!overrideAuthorityHolds(override, (userId) => authorityOf(userId, at))) throw new Error("OVERRIDE_AUTHORIZATION_REVOKED");
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
  await auditedWrite({ principal, action: "OVERRIDE_USED", resourceType: "ELIGIBILITY_OVERRIDE", resourceId: current.overrideId, outcome: "ALLOWED", correlationId: "consumer-business-eligibility-v1", metadata: { oneShot: current.oneShot } },
    () => repositories.eligibilityOverrides.put({ tenantId: principal.tenantId, recordId: current.overrideId, expectedVersion: record?.version, payload: updated, now: usedAt }));
}

/** The CTEs authorized for one bill version, so the comparison and its later rebuild calculate them alike. */
export async function authorizedOverrideCteIds(repositories: Pick<RuntimeRepositories, "eligibilityOverrides"> & AuthorityRepositories, tenantId: string, sourceBill: { readonly billId: string; readonly version: string } | undefined, now = new Date().toISOString(), actor?: ForcingActor): Promise<ReadonlySet<string>> {
  if (!sourceBill) return new Set();
  const records = await repositories.eligibilityOverrides.list(tenantId);
  const matching = records.map((record) => record.payload).filter((item) => item.tenantId === tenantId && item.billId === sourceBill.billId && item.billVersionId === sourceBill.version && (item.status === "AUTHORIZED" || item.status === "USED") && (!item.expiresAt || item.expiresAt > now));
  if (!matching.length) return new Set();
  // A revoked permission takes the CTE out of new calculations, comparisons and proposals (Tony, 20/11/2026).
  const authorityOf = await forcingAuthorityReader(repositories, tenantId, actor);
  return new Set(matching.filter((item) => overrideAuthorityHolds(item, (userId) => authorityOf(userId, now))).map((item) => item.cteId));
}
