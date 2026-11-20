// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { authorizedOverrideCteIds } from "../eligibility/override.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { cteUsability } from "../hierarchy/service.ts";
import type { HierarchyAccess } from "../hierarchy/service";
import type { CalculationResult } from "../calculation/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { calculateApprovedOffer, type CalculationDependencies } from "../calculation/engine.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { parseSimulationRequest } from "../calculation/input.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveTrustedElectricityContextWithReason } from "../calculation/source-bill-context.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { compareApprovedOffers } from "../comparison/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ProductionCteRegulatoryRuntimeResolver } from "../calculation/regulatory-runtime-resolvers.ts";
import type { RuntimeRepositories } from "../persistence/adapter";
import type { ComparisonResult } from "../comparison/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertCalculationResult, assertComparisonResult } from "./integrity.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { supplyPeriodAdmission } from "../calculation/quote-window.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { operationalMarketView, romeToday } from "../market/operational-window.ts";
import type { SimulationRequest } from "../calculation/types";

type ProposalSourceType = "CALCULATION" | "COMPARISON";

function requiredReference(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 160) throw new Error(code);
  return value;
}

function assertNoClientEconomicObject(body: Record<string, unknown>): void {
  const forbidden = [
    "calculation", "comparison", "components", "commercialCost", "comparisonCost", "savings",
    "ranking", "totalCommercialCost", "totalCommercialPlusRegulatedSubsetCost", "regulatedComponentsIncluded",
  ];
  if (forbidden.some((key) => Object.prototype.hasOwnProperty.call(body, key))) throw new Error("PROPOSAL_CLIENT_RESULT_FORBIDDEN");
}

function assertReferenceFingerprint(value: unknown, code: string): string {
  const fingerprint = requiredReference(value, code);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error(code);
  return fingerprint;
}

function assertStoredCalculation(record: Awaited<ReturnType<RuntimeRepositories["calculationResults"]["get"]>>, calculationId: string, expectedFingerprint: string, tenantId: string): CalculationResult {
  if (!record || record.recordId !== calculationId || record.payload.calculationId !== calculationId || record.payload.fingerprint !== expectedFingerprint || record.idempotencyKey !== expectedFingerprint) throw new Error("PROPOSAL_CALCULATION_RECORD_INVALID");
  const calculation = assertCalculationResult(record.payload.result, tenantId);
  if (calculation.calculationId !== calculationId || calculation.fingerprint !== expectedFingerprint) throw new Error("PROPOSAL_CALCULATION_RECORD_INVALID");
  return calculation;
}

function assertStoredComparison(record: Awaited<ReturnType<RuntimeRepositories["comparisonResults"]["get"]>>, comparisonId: string, expectedFingerprint: string, tenantId: string): ComparisonResult {
  if (!record || record.recordId !== comparisonId || record.payload.comparisonId !== comparisonId || record.payload.fingerprint !== expectedFingerprint || record.idempotencyKey !== expectedFingerprint) throw new Error("PROPOSAL_COMPARISON_RECORD_INVALID");
  const comparison = assertComparisonResult(record.payload.result, tenantId);
  if (comparison.comparisonId !== comparisonId || comparison.fingerprint !== expectedFingerprint) throw new Error("PROPOSAL_COMPARISON_RECORD_INVALID");
  return comparison;
}

async function dependenciesFor(repositories: RuntimeRepositories, tenantId: string, request: ReturnType<typeof parseSimulationRequest>): Promise<CalculationDependencies | undefined> {
  if (request.vector !== "EE" || !request.sourceBill) return undefined;
  const { context: trustedElectricityContext, reason, currentOffer, billPeakEnergy } = await resolveTrustedElectricityContextWithReason(repositories.billRepository, tenantId, request);
  // Without the bill\'s technical readings the quote runs on commercial costs only (regulated charges skipped).
  const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains, { readArchiveOncePerRequest: true });
  return { ...(trustedElectricityContext ? { trustedElectricityContext } : {}), ...(reason ? { regulatedUnavailableReason: reason } : {}), ...(currentOffer ? { currentOffer } : {}), ...(billPeakEnergy ? { billPeakEnergy } : {}), regulatoryBridge, regulatoryRuntimeResolver: new ProductionCteRegulatoryRuntimeResolver(regulatoryBridge), regulatoryRefreshState: repositories.regulatoryRefreshState };
}

/** The acting user, as the chain reads them, for the revocation check of forced CTEs (Tony, 20/11/2026). */
function forcingActorFor(hierarchy: HierarchyAccess | undefined): { readonly userId: string; readonly canonicalRole: HierarchyAccess["actor"]["role"] } | undefined {
  return hierarchy ? { userId: hierarchy.actor.userId, canonicalRole: hierarchy.actor.role } : undefined;
}

function dayBefore(value: string): string { return new Date(Date.parse(`${value}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10); }

/**
 * Tony (17/11/2026): a proposal is generated only while the bill it rests on is still in the quote window, measured on the
 * server's date. A stored calculation is never reused once its bill's supply period has left the last five months.
 */
async function assertProposalSourceAdmitted(repositories: RuntimeRepositories, tenantId: string, request: SimulationRequest, today: string): Promise<void> {
  let period: { readonly periodStart?: string | null; readonly periodEnd?: string | null } | null;
  if (request.sourceBill) {
    const document = await repositories.billRepository.get(tenantId, request.sourceBill.billId);
    const version = document && document.tenantId === tenantId ? document.versions.find((item) => item.versionId === request.sourceBill!.version) : undefined;
    if (!version) throw new Error("SOURCE_BILL_NOT_FOUND");
    period = version.energyContract?.billingPeriod ?? null;
  } else {
    // A calculation without a bill carries whole months with an exclusive end: its last day is the day before.
    period = { periodStart: request.supplyPeriod.periodStart, periodEnd: dayBefore(request.supplyPeriod.periodEnd) };
  }
  const admission = supplyPeriodAdmission(period, today);
  if (!admission.admitted) throw new Error(admission.code);
}

export async function rebuildAuthoritativeCalculation(repositories: RuntimeRepositories, tenantId: string, calculationId: string, expectedFingerprint: string, today: string = romeToday(), hierarchy?: HierarchyAccess): Promise<CalculationResult> {
  const stored = await repositories.calculationResults.get(tenantId, calculationId);
  const calculation = assertStoredCalculation(stored, calculationId, expectedFingerprint, tenantId);
  const request = parseSimulationRequest(calculation.normalizedInput, tenantId);
  await assertProposalSourceAdmitted(repositories, tenantId, request, today);
  const rebuilt = await calculateApprovedOffer(repositories.cteArchiveRepository, operationalMarketView(repositories.marketArchiveRepository, today), request, calculation.sourceCte.archiveId, { ...(await dependenciesFor(repositories, tenantId, request) ?? {}), eligibilityOverriddenCteIds: await authorizedOverrideCteIds(repositories, tenantId, request.sourceBill, undefined, forcingActorFor(hierarchy)) });
  if (rebuilt.calculationId !== calculation.calculationId || rebuilt.fingerprint !== calculation.fingerprint) throw new Error("PROPOSAL_CALCULATION_STALE");
  return rebuilt;
}

export async function rebuildAuthoritativeComparison(repositories: RuntimeRepositories, tenantId: string, comparisonId: string, expectedFingerprint: string, hierarchy?: HierarchyAccess, today: string = romeToday()): Promise<ComparisonResult> {
  const stored = await repositories.comparisonResults.get(tenantId, comparisonId);
  const comparison = assertStoredComparison(stored, comparisonId, expectedFingerprint, tenantId);
  const request = parseSimulationRequest(comparison.normalizedInput, tenantId);
  await assertProposalSourceAdmitted(repositories, tenantId, request, today);
  const dependencies = { ...(await dependenciesFor(repositories, tenantId, request) ?? {}), eligibilityOverriddenCteIds: await authorizedOverrideCteIds(repositories, tenantId, request.sourceBill, undefined, forcingActorFor(hierarchy)) };
  const rebuilt = await compareApprovedOffers(repositories.cteArchiveRepository, operationalMarketView(repositories.marketArchiveRepository, today), request, hierarchy ? { ...(dependencies ?? {}), cteUsable: (archiveId) => cteUsability(hierarchy, archiveId) === "USABLE" } : dependencies);
  if (rebuilt.comparisonId !== comparison.comparisonId || rebuilt.fingerprint !== comparison.fingerprint) throw new Error("PROPOSAL_COMPARISON_STALE");
  return rebuilt;
}

export async function resolveAuthoritativeProposalInput(repositories: RuntimeRepositories, body: Record<string, unknown>, tenantId: string, sourceType: ProposalSourceType, hierarchy?: HierarchyAccess, today: string = romeToday()): Promise<Record<string, unknown>> {
  assertNoClientEconomicObject(body);
  if (body.sourceType !== sourceType) throw new Error("PROPOSAL_SOURCE_INVALID");
  const trusted = { ...body };
  delete trusted.calculationId;
  delete trusted.calculationFingerprint;
  delete trusted.comparisonId;
  delete trusted.comparisonFingerprint;
  delete trusted.sourceBill;
  delete trusted.sourceComparison;
  if (sourceType === "CALCULATION") {
    const calculationId = requiredReference(body.calculationId, "PROPOSAL_CALCULATION_ID_REQUIRED");
    const calculationFingerprint = assertReferenceFingerprint(body.calculationFingerprint, "PROPOSAL_CALCULATION_FINGERPRINT_REQUIRED");
    const calculation = await rebuildAuthoritativeCalculation(repositories, tenantId, calculationId, calculationFingerprint, today, hierarchy);
    if (hierarchy && cteUsability(hierarchy, calculation.sourceCte.archiveId) !== "USABLE") throw new Error("CTE_NOT_ASSIGNED");
    trusted.calculation = calculation;
    if (calculation.normalizedInput.sourceBill) trusted.sourceBill = calculation.normalizedInput.sourceBill;
    return trusted;
  }
  const comparisonId = requiredReference(body.comparisonId, "PROPOSAL_COMPARISON_ID_REQUIRED");
  const comparisonFingerprint = assertReferenceFingerprint(body.comparisonFingerprint, "PROPOSAL_COMPARISON_FINGERPRINT_REQUIRED");
  const comparison = await rebuildAuthoritativeComparison(repositories, tenantId, comparisonId, comparisonFingerprint, hierarchy, today);
  trusted.comparison = comparison;
  if (comparison.normalizedInput.sourceBill) trusted.sourceBill = comparison.normalizedInput.sourceBill;
  trusted.sourceComparison = { comparisonId, fingerprint: comparisonFingerprint };
  return trusted;
}
