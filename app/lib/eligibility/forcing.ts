import type { AuthenticatedPrincipal } from "../auth/types";
import type { TenantRecordRepository } from "../persistence/types";
import type { ProposalCanonicalSnapshot } from "../proposal/types";
import type { EligibilityReasonCode } from "./domain";
import type { AuthorityRepositories, EligibilityOverride, ForcingActor, ForcingAuthority } from "./override";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { reasonLabel } from "./domain.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { forcingAuthorityReader, overrideAuthorityHolds } from "./override.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";

/**
 * Tony (20/11/2026, "FORZATURA CTE E AUTORIZZAZIONI A CASCATA"): a forcing may produce a real commercial offer. Every offer
 * produced with a forced CTE is recorded with company, user, authorization used, CTE version, customer and POD, reason,
 * special conditions, offer id, date and time. The record is written before the offer is stored and never changed afterwards;
 * a later revocation blocks new forcings, while offers already produced stay archived and traced.
 */
export interface CteForcingRecord {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly proposalId: string;
  readonly proposalFingerprint: string;
  /** Who produced the offer. */
  readonly userId: string;
  readonly createdAt: string;
  readonly cte: { readonly cteId: string; readonly archiveId: string; readonly versionId: string; readonly version: string };
  readonly customer: { readonly customerId: string; readonly category: string; readonly displayName?: string };
  readonly supply: { readonly supplyId: string; readonly pod?: string; readonly pdr?: string };
  readonly sourceBill: { readonly billId: string; readonly version: string };
  /** The authorization used: the forcing of this CTE for this bill, and the permission its author held. */
  readonly authorization: {
    readonly overrideId: string;
    readonly requestedByUserId: string;
    readonly authorizedByUserId: string;
    readonly authorizedAt: string;
    readonly grantedDirectly: boolean;
    /** CTE version in force when the forcing was authorized (absent for forcings authorized before 20/11/2026). */
    readonly cteVersionIdAtAuthorization?: string;
    /** As recorded at authorization (absent for forcings authorized before 20/11/2026). */
    readonly authorityAtAuthorization?: ForcingAuthority;
    /** As checked when the offer was produced. */
    readonly authorityAtUse: ForcingAuthority;
  };
  readonly reason: string;
  /** The CTE conditions the offer departs from, as codes and in words. */
  readonly specialConditions: readonly { readonly code: EligibilityReasonCode; readonly label: string }[];
}

export type ForcingRepositories = AuthorityRepositories & {
  readonly eligibilityOverrides: Pick<TenantRecordRepository<EligibilityOverride>, "list">;
  readonly cteForcingRecords: TenantRecordRepository<CteForcingRecord>;
};

/**
 * The forcing an offer rests on: an authorized forcing of the offer's CTE for the offer's bill version whose author still
 * holds the permission. Only those were let into the calculation the offer is rebuilt from, so when none holds the CTE was
 * calculated on its own eligibility and the offer is not a forced one.
 */
export async function forcingForOffer(repositories: Pick<ForcingRepositories, "eligibilityOverrides" | "orgChain" | "foundationMemberships">, proposal: Pick<ProposalCanonicalSnapshot, "tenantId" | "sourceBill" | "cte">, actor: ForcingActor, now: string): Promise<{ readonly override: EligibilityOverride; readonly authority: ForcingAuthority } | null> {
  const sourceBill = proposal.sourceBill;
  if (!sourceBill) return null;
  const candidates = (await repositories.eligibilityOverrides.list(proposal.tenantId)).map((record) => record.payload)
    .filter((item) => item.tenantId === proposal.tenantId && item.billId === sourceBill.billId && item.billVersionId === sourceBill.version && item.cteId === proposal.cte.cteId && (item.status === "AUTHORIZED" || item.status === "USED") && (!item.expiresAt || item.expiresAt > now))
    .sort((left, right) => (right.authorizedAt ?? "").localeCompare(left.authorizedAt ?? "") || right.overrideId.localeCompare(left.overrideId));
  if (!candidates.length) return null;
  const authorityOf = await forcingAuthorityReader(repositories, proposal.tenantId, actor);
  for (const override of candidates) {
    if (!overrideAuthorityHolds(override, (userId) => authorityOf(userId, now))) continue;
    return { override, authority: authorityOf(override.authorizedByUserId as string, now) as ForcingAuthority };
  }
  return null;
}

/** Builds the trace of a forced offer; pure, so the route and the tests build it alike. */
export function forcingRecordOf(proposal: Pick<ProposalCanonicalSnapshot, "tenantId" | "proposalId" | "proposalFingerprint" | "cte" | "customer" | "supply" | "sourceBill">, userId: string, forcing: { readonly override: EligibilityOverride; readonly authority: ForcingAuthority }, now: string): CteForcingRecord {
  const { override, authority } = forcing;
  const sourceBill = proposal.sourceBill as NonNullable<typeof proposal.sourceBill>;
  return {
    schemaVersion: 1, tenantId: proposal.tenantId, proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, userId, createdAt: now,
    cte: { cteId: proposal.cte.cteId, archiveId: proposal.cte.archiveId, versionId: proposal.cte.versionId, version: proposal.cte.version },
    customer: { customerId: proposal.customer.customerId, category: proposal.customer.category, ...(proposal.customer.displayName ? { displayName: proposal.customer.displayName } : {}) },
    supply: { supplyId: proposal.supply.supplyId, ...(proposal.supply.pod ? { pod: proposal.supply.pod } : {}), ...(proposal.supply.pdr ? { pdr: proposal.supply.pdr } : {}) },
    sourceBill: { billId: sourceBill.billId, version: sourceBill.version },
    authorization: {
      overrideId: override.overrideId, requestedByUserId: override.requestedByUserId, authorizedByUserId: override.authorizedByUserId as string, authorizedAt: override.authorizedAt as string, grantedDirectly: override.grantedDirectly === true,
      ...(override.cteVersionId ? { cteVersionIdAtAuthorization: override.cteVersionId } : {}), ...(override.authorization ? { authorityAtAuthorization: override.authorization } : {}), authorityAtUse: authority,
    },
    reason: override.reason,
    specialConditions: override.originalMismatchReasons.map((code) => ({ code, label: reasonLabel(code) })),
  };
}

/**
 * Records the trace of an offer produced with a forced CTE, before the offer itself is stored, so no forced offer exists
 * without it. Returns null for an offer that rests on no forcing. The same offer generated again keeps its first trace.
 */
export async function recordForcedOffer(principal: AuthenticatedPrincipal, repositories: ForcingRepositories, proposal: ProposalCanonicalSnapshot, actor: ForcingActor, now = new Date().toISOString()): Promise<CteForcingRecord | null> {
  const forcing = await forcingForOffer(repositories, proposal, actor, now);
  if (!forcing) return null;
  const existing = await repositories.cteForcingRecords.get(proposal.tenantId, proposal.proposalId);
  if (existing) return existing.payload;
  const record = forcingRecordOf(proposal, principal.userId, forcing, now);
  // Order (Tony, 20/11/2026): mandatory audit first, then the trace, then (in the route) the offer. A failure at any step stops
  // the ones after it, so no forced offer is stored without its trace and no trace without its audit. The audit carries
  // identifiers only; customer and POD stay in the trace record of the company.
  const audit = { principal, action: "CTE_FORCED_OFFER", resourceType: "PROPOSAL", resourceId: proposal.proposalId, outcome: "ALLOWED" as const, correlationId: "cte-forcing-v1", metadata: { overrideId: forcing.override.overrideId, cteId: record.cte.cteId, cteVersionId: record.cte.versionId, authorizedByUserId: record.authorization.authorizedByUserId, forcingBasis: forcing.authority.basis, specialConditions: record.specialConditions.map((item) => item.code).join(",") } };
  await recordRuntimeAudit(audit);
  try { await repositories.cteForcingRecords.put({ tenantId: proposal.tenantId, recordId: proposal.proposalId, payload: record, idempotencyKey: `forcing-${proposal.proposalFingerprint}`, now }); }
  catch (error) { await recordRuntimeAudit({ ...audit, action: "CTE_FORCED_OFFER_NOT_SAVED", outcome: "DENIED" }).catch(() => undefined); throw error; }
  return record;
}
