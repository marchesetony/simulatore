import type { CalculationResult } from "../calculation/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { calculateApprovedOffer, type CalculationDependencies } from "../calculation/engine.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { parseSimulationRequest } from "../calculation/input.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveTrustedElectricityContextFromSourceBill } from "../calculation/source-bill-context.ts";
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
  const trustedElectricityContext = await resolveTrustedElectricityContextFromSourceBill(repositories.billRepository, tenantId, request);
  if (!trustedElectricityContext) throw new Error("REGULATORY_TRUST_CONTEXT_REQUIRED");
  const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains);
  return { trustedElectricityContext, regulatoryBridge, regulatoryRuntimeResolver: new ProductionCteRegulatoryRuntimeResolver(regulatoryBridge), regulatoryRefreshState: repositories.regulatoryRefreshState };
}

export async function rebuildAuthoritativeCalculation(repositories: RuntimeRepositories, tenantId: string, calculationId: string, expectedFingerprint: string): Promise<CalculationResult> {
  const stored = await repositories.calculationResults.get(tenantId, calculationId);
  const calculation = assertStoredCalculation(stored, calculationId, expectedFingerprint, tenantId);
  const request = parseSimulationRequest(calculation.normalizedInput, tenantId);
  const rebuilt = await calculateApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, request, calculation.sourceCte.archiveId, await dependenciesFor(repositories, tenantId, request));
  if (rebuilt.calculationId !== calculation.calculationId || rebuilt.fingerprint !== calculation.fingerprint) throw new Error("PROPOSAL_CALCULATION_STALE");
  return rebuilt;
}

export async function rebuildAuthoritativeComparison(repositories: RuntimeRepositories, tenantId: string, comparisonId: string, expectedFingerprint: string): Promise<ComparisonResult> {
  const stored = await repositories.comparisonResults.get(tenantId, comparisonId);
  const comparison = assertStoredComparison(stored, comparisonId, expectedFingerprint, tenantId);
  const request = parseSimulationRequest(comparison.normalizedInput, tenantId);
  const rebuilt = await compareApprovedOffers(repositories.cteArchiveRepository, repositories.marketArchiveRepository, request, await dependenciesFor(repositories, tenantId, request));
  if (rebuilt.comparisonId !== comparison.comparisonId || rebuilt.fingerprint !== comparison.fingerprint) throw new Error("PROPOSAL_COMPARISON_STALE");
  return rebuilt;
}

export async function resolveAuthoritativeProposalInput(repositories: RuntimeRepositories, body: Record<string, unknown>, tenantId: string, sourceType: ProposalSourceType): Promise<Record<string, unknown>> {
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
    const calculation = await rebuildAuthoritativeCalculation(repositories, tenantId, calculationId, calculationFingerprint);
    trusted.calculation = calculation;
    if (calculation.normalizedInput.sourceBill) trusted.sourceBill = calculation.normalizedInput.sourceBill;
    return trusted;
  }
  const comparisonId = requiredReference(body.comparisonId, "PROPOSAL_COMPARISON_ID_REQUIRED");
  const comparisonFingerprint = assertReferenceFingerprint(body.comparisonFingerprint, "PROPOSAL_COMPARISON_FINGERPRINT_REQUIRED");
  const comparison = await rebuildAuthoritativeComparison(repositories, tenantId, comparisonId, comparisonFingerprint);
  trusted.comparison = comparison;
  if (comparison.normalizedInput.sourceBill) trusted.sourceBill = comparison.normalizedInput.sourceBill;
  trusted.sourceComparison = { comparisonId, fingerprint: comparisonFingerprint };
  return trusted;
}
