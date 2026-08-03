import type { CalculationResult } from "../calculation/types";
import type { ComparisonResult } from "../comparison/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertCalculationResult, assertComparisonResult, assertComponent, assertExclusion, assertInputSize, assertMoney, assertPeriod, canonical, dateOnly, fingerprint, normalizedNote, proposalFail, text } from "./integrity.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { parseSimulationRequest } from "../calculation/input.ts";
import type { ComparisonProposalRequest, ProposalCanonicalSnapshot, ProposalCustomerSummary, ProposalExportFormat, ProposalOfferIdentity, ProposalRequest, ProposalSupplySummary } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PROPOSAL_SCHEMA_VERSION } from "./types.ts";

function record(value: unknown, code: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) return proposalFail(code); return value as Record<string, unknown>; }
function enumValue<T extends string>(value: unknown, values: readonly T[], code: string): T { if (typeof value !== "string" || !values.includes(value as T)) return proposalFail(code); return value as T; }
function optionalText(value: unknown, code: string, maxLength: number): string | undefined { if (value === undefined) return undefined; return text(value, code, maxLength); }
function parseCustomer(value: unknown): ProposalCustomerSummary { const item = record(value, "PROPOSAL_CUSTOMER_INVALID"); const displayName = optionalText(item.displayName, "PROPOSAL_CUSTOMER_INVALID", 160); return { customerId: text(item.customerId, "PROPOSAL_CUSTOMER_INVALID", 128), category: enumValue(item.category, ["RESIDENTIAL", "NON_RESIDENTIAL"], "PROPOSAL_CUSTOMER_INVALID"), ...(displayName ? { displayName } : {}) }; }
function parseSupply(value: unknown): ProposalSupplySummary { const item = record(value, "PROPOSAL_SUPPLY_INVALID"); const meterId = optionalText(item.meterId, "PROPOSAL_SUPPLY_INVALID", 128); const pod = optionalText(item.pod, "PROPOSAL_SUPPLY_INVALID", 64); const pdr = optionalText(item.pdr, "PROPOSAL_SUPPLY_INVALID", 64); const voltageLevel = item.voltageLevel === undefined ? undefined : enumValue(item.voltageLevel, ["LV", "MV", "HV", "EHV"], "PROPOSAL_SUPPLY_INVALID"); return { supplyId: text(item.supplyId, "PROPOSAL_SUPPLY_INVALID", 128), ...(meterId ? { meterId } : {}), ...(pod ? { pod } : {}), ...(pdr ? { pdr } : {}), ...(voltageLevel ? { voltageLevel } : {}) }; }
function parseOffer(value: unknown): ProposalOfferIdentity { const item = record(value, "PROPOSAL_OFFER_INVALID"); return { archiveId: text(item.archiveId, "PROPOSAL_OFFER_INVALID", 128), cteId: text(item.cteId, "PROPOSAL_OFFER_INVALID", 128), versionId: text(item.versionId, "PROPOSAL_OFFER_INVALID", 128), version: text(item.version, "PROPOSAL_OFFER_INVALID", 64), supplier: text(item.supplier, "PROPOSAL_OFFER_INVALID", 256), offerCode: text(item.offerCode, "PROPOSAL_OFFER_INVALID", 128) }; }
function parseSourceBill(value: unknown): { readonly billId: string; readonly version: string } | undefined { if (value === undefined) return undefined; const item = record(value, "PROPOSAL_SOURCE_BILL_INVALID"); return { billId: text(item.billId, "PROPOSAL_SOURCE_BILL_INVALID", 128), version: text(item.version, "PROPOSAL_SOURCE_BILL_INVALID", 64) }; }

export function parseProposalRequest(value: unknown, tenantId: string, requiredSourceType?: "CALCULATION" | "COMPARISON", requiredFormat?: ProposalExportFormat): ProposalRequest {
  assertInputSize(value);
  const item = record(value, "PROPOSAL_REQUEST_INVALID");
  if (item.schemaVersion !== PROPOSAL_SCHEMA_VERSION || item.tenantId !== tenantId) proposalFail(item.tenantId === tenantId ? "PROPOSAL_SCHEMA_UNSUPPORTED" : "TENANT_MISMATCH");
  const sourceType = enumValue(item.sourceType, ["CALCULATION", "COMPARISON"], "PROPOSAL_SOURCE_INVALID");
  if (requiredSourceType !== undefined && sourceType !== requiredSourceType) proposalFail("PROPOSAL_SOURCE_INVALID");
  const requestedExportFormat = enumValue(item.requestedExportFormat, ["JSON", "CSV", "HTML"], "PROPOSAL_FORMAT_INVALID");
  if (requiredFormat !== undefined && requestedExportFormat !== requiredFormat) proposalFail("PROPOSAL_FORMAT_INVALID");
  const customer = parseCustomer(item.customer);
  const supply = parseSupply(item.supply);
  const proposalIssueDate = dateOnly(item.proposalIssueDate, "PROPOSAL_ISSUE_DATE_INVALID");
  const offerValidity = assertPeriod(item.offerValidity, "PROPOSAL_VALIDITY_INVALID");
  const commercialNotes = item.commercialNotes === undefined ? undefined : normalizedNote(item.commercialNotes);
  const sourceBill = parseSourceBill(item.sourceBill);
  const selectedOffer = parseOffer(item.selectedOffer);
  if (sourceType === "CALCULATION") return { schemaVersion: 1, tenantId, sourceType, calculation: item.calculation as CalculationResult, selectedOffer, customer, supply, proposalIssueDate, offerValidity, ...(sourceBill ? { sourceBill } : {}), ...(commercialNotes ? { commercialNotes } : {}), requestedExportFormat };
  const selectedCalculationId = text(item.selectedCalculationId, "PROPOSAL_SELECTION_INVALID", 128);
  return { schemaVersion: 1, tenantId, sourceType, comparison: item.comparison as ComparisonResult, selectedCalculationId, selectedOffer, customer, supply, proposalIssueDate, offerValidity, ...(sourceBill ? { sourceBill } : {}), ...(commercialNotes ? { commercialNotes } : {}), requestedExportFormat };
}

function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }
function sourceBillFor(request: ProposalRequest, calculation: CalculationResult): ProposalRequest["sourceBill"] {
  const sourceBill = calculation.normalizedInput.sourceBill;
  if (request.sourceBill && sourceBill && !same(request.sourceBill, sourceBill)) proposalFail("PROPOSAL_SOURCE_BILL_MISMATCH");
  return request.sourceBill ?? sourceBill;
}
function assertOfferMatches(offer: ProposalOfferIdentity, calculation: CalculationResult): void {
  if (offer.archiveId !== calculation.sourceCte.archiveId || offer.cteId !== calculation.sourceCte.cteId || offer.versionId !== calculation.sourceCte.versionId || offer.version !== calculation.sourceCte.version || offer.supplier !== calculation.sourceCte.supplier || offer.offerCode !== calculation.sourceCte.offerCode) proposalFail("PROPOSAL_OFFER_MISMATCH");
}
function assertCommon(request: ProposalRequest, calculation: CalculationResult): void {
  if (request.customer.category !== calculation.customerCategory || (request.supply.voltageLevel !== undefined && request.supply.voltageLevel !== calculation.voltageLevel)) proposalFail("PROPOSAL_IDENTITY_MISMATCH");
  if (calculation.vector === "EE" && (request.supply.pdr !== undefined || (request.supply.voltageLevel !== undefined && request.supply.voltageLevel !== calculation.voltageLevel))) proposalFail("PROPOSAL_IDENTITY_MISMATCH");
  if (calculation.vector === "GAS" && (request.supply.pod !== undefined || request.supply.voltageLevel !== undefined)) proposalFail("PROPOSAL_IDENTITY_MISMATCH");
  if (request.proposalIssueDate >= request.offerValidity.periodEnd || request.offerValidity.periodStart > calculation.supplyPeriod.periodStart || request.offerValidity.periodEnd < calculation.supplyPeriod.periodEnd) proposalFail("PROPOSAL_VALIDITY_MISMATCH");
  sourceBillFor(request, calculation);
}
function selectedComparisonCalculation(request: ComparisonProposalRequest): { readonly comparison: ComparisonResult; readonly calculation: CalculationResult; readonly rankingPosition: number; readonly tieGroup: string } {
  const comparison = assertComparisonResult(request.comparison, request.tenantId);
  const calculation = comparison.results.find((candidate) => candidate.calculationId === request.selectedCalculationId);
  if (calculation === undefined) return proposalFail("PROPOSAL_OFFER_EXCLUDED");
  const ranking = comparison.ranking.find((entry) => entry.calculationId === calculation.calculationId);
  if (ranking === undefined) return proposalFail("PROPOSAL_RANKING_MISSING");
  return { comparison, calculation, rankingPosition: ranking.rank, tieGroup: ranking.tieGroup };
}

function proposalPayload(snapshot: ProposalCanonicalSnapshot | Omit<ProposalCanonicalSnapshot, "proposalId" | "proposalFingerprint">): unknown { const payload = { ...snapshot } as Record<string, unknown>; delete payload.proposalId; delete payload.proposalFingerprint; return payload; }
function baselineFrom(calculation: CalculationResult): CalculationResult["savingsVsBaseline"] {
  if (calculation.normalizedInput.baseline === undefined || calculation.savingsVsBaseline === null) return null;
  const minorUnits = Math.round(calculation.normalizedInput.baseline.totalCommercialCost * 100);
  return { amount: minorUnits / 100, minorUnits, currency: "EUR" };
}

export function generateProposal(rawRequest: unknown, tenantId: string, requiredSourceType?: "CALCULATION" | "COMPARISON"): ProposalCanonicalSnapshot {
  const request = parseProposalRequest(rawRequest, tenantId, requiredSourceType);
  const selected = request.sourceType === "CALCULATION"
    ? { calculation: assertCalculationResult(request.calculation, tenantId), comparison: null as ComparisonResult | null, rankingPosition: null as number | null, tieGroup: null as string | null }
    : (() => { const result = selectedComparisonCalculation(request); return { calculation: result.calculation, comparison: result.comparison, rankingPosition: result.rankingPosition, tieGroup: result.tieGroup }; })();
  assertOfferMatches(request.selectedOffer, selected.calculation);
  assertCommon(request, selected.calculation);
  const sourceBill = sourceBillFor(request, selected.calculation);
  const normalized = selected.calculation.normalizedInput;
  const baseline = baselineFrom(selected.calculation);
  const warnings = [...selected.calculation.warnings, ...(selected.comparison?.warnings ?? [])];
  const exclusions = selected.comparison?.excludedOffers.filter((exclusion) => exclusion.vector === selected.calculation.vector) ?? [];
  const consumptionUnit = normalized.vector === "EE" ? normalized.consumption.unit : normalized.consumption.unit;
  const payload = {
    schemaVersion: 1 as const,
    tenantId,
    vector: selected.calculation.vector,
    customer: request.customer,
    supply: request.supply,
    ...(sourceBill ? { sourceBill } : {}),
    selectedOffer: request.selectedOffer,
    cte: { cteId: selected.calculation.sourceCte.cteId, archiveId: selected.calculation.sourceCte.archiveId, versionId: selected.calculation.sourceCte.versionId, version: selected.calculation.sourceCte.version },
    marketData: selected.calculation.marketData,
    simulationPeriod: selected.calculation.supplyPeriod,
    normalizedConsumption: normalized.consumption,
    commercialCost: selected.calculation.totalCommercialCost,
    unitCost: selected.calculation.unitCost,
    components: selected.calculation.components,
    baseline,
    savings: selected.calculation.savingsVsBaseline,
    selectedResult: { calculationId: selected.calculation.calculationId, calculationFingerprint: selected.calculation.fingerprint, rankingPosition: selected.rankingPosition, tieGroup: selected.tieGroup },
    exclusions,
    warnings: [...new Set(warnings)],
    currency: selected.calculation.currency,
    units: { consumption: consumptionUnit, unitCost: selected.calculation.unitCost.unit },
    taxTreatment: selected.calculation.taxTreatment,
    roundingPolicy: selected.calculation.roundingPolicy,
    calculationFingerprint: selected.calculation.fingerprint,
    generatedAt: `${request.proposalIssueDate}T00:00:00.000Z`,
    offerValidity: request.offerValidity,
    notes: request.commercialNotes ? [request.commercialNotes] : [],
    notCalculated: ["NETWORK_CHARGES", "REGULATED_CHARGES", "TAXES_AND_DUTIES_NOT_REPRESENTED_IN_THE_APPROVED_COMMERCIAL_COMPONENTS"],
     unavailableInformation: [
       ...(sourceBill ? [] : ["SOURCE_BILL_REFERENCE_NOT_SUPPLIED"]),
       ...(baseline ? [] : ["BASELINE_NOT_SUPPLIED"]),
       ...(selected.calculation.marketData.length > 0 ? [] : ["MARKET_DATA_NOT_USED_BY_FIXED_OFFER"]),
       ...(selected.calculation.vector === "EE" && !request.supply.pod ? ["POD_NOT_SUPPLIED"] : []),
       ...(selected.calculation.vector === "GAS" && !request.supply.pdr ? ["PDR_NOT_SUPPLIED"] : []),
     ],
    disclaimer: "This proposal contains only the approved commercial supply components calculated by the Phase 4 engine. Network charges, regulated charges, taxes, duties and other components not explicitly represented in the calculation are excluded and must not be inferred from this document.",
  } satisfies Omit<ProposalCanonicalSnapshot, "proposalId" | "proposalFingerprint">;
  const proposalFingerprint = fingerprint(proposalPayload(payload));
  const snapshot: ProposalCanonicalSnapshot = { ...payload, proposalId: `proposal_${proposalFingerprint.slice(0, 32)}`, proposalFingerprint };
  return snapshot;
}

export function assertProposalSnapshot(value: unknown, tenantId: string): ProposalCanonicalSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  assertInputSize(value);
  const proposal = value as ProposalCanonicalSnapshot;
  if (proposal.schemaVersion !== 1 || proposal.tenantId !== tenantId || (proposal.vector !== "EE" && proposal.vector !== "GAS")) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  parseCustomer(proposal.customer);
  const supply = parseSupply(proposal.supply);
  const offer = parseOffer(proposal.selectedOffer);
  const sourceBill = parseSourceBill(proposal.sourceBill);
  const cte = record(proposal.cte, "PROPOSAL_SNAPSHOT_INVALID");
  const cteId = text(cte.cteId, "PROPOSAL_SNAPSHOT_INVALID", 128);
  const archiveId = text(cte.archiveId, "PROPOSAL_SNAPSHOT_INVALID", 128);
  const versionId = text(cte.versionId, "PROPOSAL_SNAPSHOT_INVALID", 128);
  const version = text(cte.version, "PROPOSAL_SNAPSHOT_INVALID", 64);
  if (offer.cteId !== cteId || offer.archiveId !== archiveId || offer.versionId !== versionId || offer.version !== version) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.vector === "EE" && supply.pdr !== undefined) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.vector === "GAS" && (supply.pod !== undefined || supply.voltageLevel !== undefined)) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  const simulationPeriod = assertPeriod(proposal.simulationPeriod, "PROPOSAL_SNAPSHOT_INVALID");
  const offerValidity = assertPeriod(proposal.offerValidity, "PROPOSAL_SNAPSHOT_INVALID");
  if (typeof proposal.generatedAt !== "string") proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  const generatedDate = dateOnly(proposal.generatedAt.slice(0, 10), "PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.generatedAt !== `${generatedDate}T00:00:00.000Z` || offerValidity.periodStart > simulationPeriod.periodStart || offerValidity.periodEnd < simulationPeriod.periodEnd) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.currency !== "EUR" || proposal.roundingPolicy !== "ROUND_HALF_UP_TO_CENT_PER_COMPONENT") proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  const taxTreatment = enumValue(proposal.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "PROPOSAL_SNAPSHOT_INVALID");
  const validationInput = {
    schemaVersion: 1 as const,
    tenantId,
    calculationDate: generatedDate,
    supplyPeriod: simulationPeriod,
    customerCategory: proposal.customer.category,
    currency: "EUR" as const,
    taxTreatment,
    ...(sourceBill ? { sourceBill } : {}),
    ...(proposal.baseline ? { baseline: { totalCommercialCost: proposal.baseline.amount, currency: "EUR" as const, taxTreatment, supplyPeriod: simulationPeriod } } : {}),
    vector: proposal.vector,
    ...(proposal.vector === "EE" ? { voltageLevel: supply.voltageLevel ?? "LV" as const } : {}),
    consumption: proposal.normalizedConsumption,
  };
  const normalizedInput = parseSimulationRequest(validationInput, tenantId);
  if (canonical(normalizedInput.consumption) !== canonical(proposal.normalizedConsumption)) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (!Array.isArray(proposal.components) || proposal.components.length === 0) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  proposal.components.forEach((component) => assertComponent(component));
  assertMoney(proposal.commercialCost, "PROPOSAL_SNAPSHOT_INVALID");
  const componentTotal = proposal.components.reduce((sum, component) => sum + BigInt(component.sign === "DISCOUNT" ? -component.amount.minorUnits : component.amount.minorUnits), BigInt(0));
  if (componentTotal !== BigInt(proposal.commercialCost.minorUnits)) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.unitCost.currency !== "EUR" || !Number.isFinite(proposal.unitCost.amount) || !["EUR_PER_KWH", "EUR_PER_SMC"].includes(proposal.unitCost.unit)) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.unitCost.unit !== (proposal.vector === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC") || proposal.units.unitCost !== proposal.unitCost.unit || proposal.units.consumption !== proposal.normalizedConsumption.unit) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.baseline === null || proposal.savings === null) { if (proposal.baseline !== null || proposal.savings !== null) proposalFail("PROPOSAL_SNAPSHOT_INVALID"); } else { assertMoney(proposal.baseline, "PROPOSAL_SNAPSHOT_INVALID"); assertMoney(proposal.savings, "PROPOSAL_SNAPSHOT_INVALID"); if (proposal.savings.minorUnits !== proposal.baseline.minorUnits - proposal.commercialCost.minorUnits) proposalFail("PROPOSAL_SNAPSHOT_INVALID"); }
  if (!Array.isArray(proposal.marketData)) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  proposal.marketData.forEach((market) => {
    if (typeof market !== "object" || market === null || Array.isArray(market) || market.vector !== proposal.vector || market.index !== (proposal.vector === "EE" ? "PUN" : "PSV") || typeof market.month !== "string" || !/^\d{4}-\d{2}$/.test(market.month)) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
    text(market.recordId, "PROPOSAL_SNAPSHOT_INVALID", 128);
    text(market.version, "PROPOSAL_SNAPSHOT_INVALID", 64);
    dateOnly(market.effectiveFrom, "PROPOSAL_SNAPSHOT_INVALID");
    if (market.effectiveTo !== null) dateOnly(market.effectiveTo, "PROPOSAL_SNAPSHOT_INVALID");
  });
  if (!Array.isArray(proposal.warnings) || !Array.isArray(proposal.exclusions) || !Array.isArray(proposal.notes) || !Array.isArray(proposal.notCalculated) || !Array.isArray(proposal.unavailableInformation)) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  [...proposal.warnings, ...proposal.notes, ...proposal.notCalculated, ...proposal.unavailableInformation].forEach((item) => text(item, "PROPOSAL_SNAPSHOT_INVALID", 2000));
  text(proposal.disclaimer, "PROPOSAL_SNAPSHOT_INVALID", 2000);
  proposal.exclusions.forEach((exclusion) => assertExclusion(exclusion, proposal.vector));
  const selectedResult = record(proposal.selectedResult, "PROPOSAL_SNAPSHOT_INVALID");
  const calculationFingerprint = text(proposal.calculationFingerprint, "PROPOSAL_SNAPSHOT_INVALID", 64);
  const proposalFingerprint = text(proposal.proposalFingerprint, "PROPOSAL_SNAPSHOT_INVALID", 64);
  const rankingPosition = selectedResult.rankingPosition;
  const tieGroup = selectedResult.tieGroup;
  text(proposal.proposalId, "PROPOSAL_SNAPSHOT_INVALID", 128);
  if (!/^[a-f0-9]{64}$/.test(calculationFingerprint) || !/^[a-f0-9]{64}$/.test(proposalFingerprint) || selectedResult.calculationFingerprint !== calculationFingerprint || typeof selectedResult.calculationId !== "string" || !/^calc_[a-f0-9]{32}$/.test(selectedResult.calculationId) || !(rankingPosition === null || (typeof rankingPosition === "number" && Number.isSafeInteger(rankingPosition) && rankingPosition >= 1)) || !(tieGroup === null || (typeof tieGroup === "string" && /^tie-\d+$/.test(tieGroup)))) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.selectedOffer.cteId !== proposal.cte.cteId || proposal.selectedOffer.archiveId !== proposal.cte.archiveId || proposal.selectedOffer.versionId !== proposal.cte.versionId || proposal.selectedOffer.version !== proposal.cte.version) proposalFail("PROPOSAL_SNAPSHOT_INVALID");
  if (proposal.proposalId !== `proposal_${proposal.proposalFingerprint.slice(0, 32)}` || fingerprint(proposalPayload(proposal)) !== proposal.proposalFingerprint) proposalFail("PROPOSAL_FINGERPRINT_MISMATCH");
  return proposal;
}
