// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { AppendOnlyVersionStore, assertLifecycleTransition, type ImmutableVersion, type VersionLifecycle } from "./regulatory-version-store.ts";

export type GovernedEntity = "OfficialSource" | "RegulatoryDocument" | "RegulatoryRuleVersion" | "MarketDataSeries" | "MarketDataPoint" | "TariffBandCalendar" | "ContractFormula" | "PassThroughComponentVersion" | "EvidenceReference";
export type ApprovalDecision = "APPROVE" | "REJECT";

export interface ReviewDecisionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectType: GovernedEntity;
  readonly subjectId: string;
  readonly decision: ApprovalDecision;
  readonly reviewer: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface GovernedPayload {
  readonly tenantId: string;
  readonly entityType: GovernedEntity;
  readonly dependencies: readonly { readonly tenantId: string; readonly entityType: GovernedEntity; readonly entityId: string }[];
  readonly business: Readonly<Record<string, unknown>>;
}

export class ImmutableApprovalEngine {
  private readonly stores = new Map<GovernedEntity, AppendOnlyVersionStore<GovernedPayload>>();
  private readonly decisions = new Map<string, ReviewDecisionRecord>();

  private key(tenantId: string, subjectId: string): string {
    return `${tenantId}|${subjectId}`;
  }

  private store(type: GovernedEntity): AppendOnlyVersionStore<GovernedPayload> {
    const existing = this.stores.get(type);
    if (existing) return existing;
    const created = new AppendOnlyVersionStore<GovernedPayload>();
    this.stores.set(type, created);
    return created;
  }

  import(subjectType: GovernedEntity, subjectId: string, payload: GovernedPayload, now: string): ImmutableVersion<GovernedPayload> {
    if (payload.entityType !== subjectType) throw new Error("ENTITY_TYPE_MISMATCH");
    return this.store(subjectType).put(this.key(payload.tenantId, subjectId), payload, "IMPORTED", null, now);
  }

  validate(tenantId: string, subjectType: GovernedEntity, subjectId: string, now: string): ImmutableVersion<GovernedPayload> {
    return this.transition(tenantId, subjectType, subjectId, "VALIDATED", null, "system", "validation", now);
  }

  approve(tenantId: string, subjectType: GovernedEntity, subjectId: string, decision: ReviewDecisionRecord): ImmutableVersion<GovernedPayload> {
    return this.transition(tenantId, subjectType, subjectId, "APPROVED", decision, decision.reviewer, decision.reason, decision.createdAt);
  }

  reject(tenantId: string, subjectType: GovernedEntity, subjectId: string, decision: ReviewDecisionRecord): ImmutableVersion<GovernedPayload> {
    return this.transition(tenantId, subjectType, subjectId, "REJECTED", decision, decision.reviewer, decision.reason, decision.createdAt);
  }

  history(tenantId: string, subjectType: GovernedEntity, subjectId: string): readonly ImmutableVersion<GovernedPayload>[] {
    return this.store(subjectType).historyFor(this.key(tenantId, subjectId));
  }

  currentApproved(tenantId: string, subjectType: GovernedEntity, subjectId: string): ImmutableVersion<GovernedPayload> | null {
    const current = this.store(subjectType).current(this.key(tenantId, subjectId));
    return current?.lifecycle === "APPROVED" ? current : null;
  }

  private transition(tenantId: string, subjectType: GovernedEntity, subjectId: string, next: VersionLifecycle, decision: ReviewDecisionRecord | null, reviewer: string, reason: string, now: string): ImmutableVersion<GovernedPayload> {
    const subjectKey = this.key(tenantId, subjectId);
    const store = this.store(subjectType);
    const current = store.current(subjectKey);
    if (decision) {
      const prior = this.decisions.get(decision.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(decision)) throw new Error("REVIEW_DECISION_CONFLICT");
      if (prior && prior.tenantId === tenantId && prior.subjectType === subjectType && prior.subjectId === subjectId) return current as ImmutableVersion<GovernedPayload>;
    }
    if (!current) throw new Error("APPROVAL_TRANSITION_INVALID");
    try {
      assertLifecycleTransition(current.lifecycle, next);
    } catch {
      throw new Error("APPROVAL_TRANSITION_INVALID");
    }
    if (next !== "VALIDATED" && (!decision || decision.tenantId !== tenantId || decision.subjectType !== subjectType || decision.subjectId !== subjectId || !decision.id || !reviewer.trim() || !reason.trim())) throw new Error("REVIEW_REQUIRED");
    if (decision) {
      this.assertDependencies(current.payload);
      this.decisions.set(decision.id, decision);
    }
    return store.transition(subjectKey, next, decision?.id ?? null, now);
  }

  private assertDependencies(payload: GovernedPayload): void {
    for (const dependency of payload.dependencies) {
      if (this.currentApproved(dependency.tenantId, dependency.entityType, dependency.entityId) === null) throw new Error("APPROVAL_DEPENDENCY_DENIED");
    }
  }
}
