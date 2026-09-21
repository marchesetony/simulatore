import type { BillDocument, BillVersion } from "../foundation/real-bill";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { getBillInScope } from "../foundation/bill-visibility.ts";
import type { AuthenticatedPrincipal } from "../auth/types";
import type { RuntimeRepositories } from "../persistence/adapter";
import type { BillContract, CustomerResidency, CustomerType, VoltageLevel, TaxInclusionState } from "../energy/types";
import type { CteArchiveRecord, CteArchiveVersion } from "../cte/archive/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { commercialStatusOf, currentApprovedCteVersion } from "../cte/archive/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toCalculationReadyOffer, assertCalculationReadyFees } from "../cte/calculation-ready.ts";
import type { CalculationReadyOffer } from "../cte/types";
import type { CteCommercialCustomerScope } from "../cte/types";
import type { CustomerLegalType, IdentifierType, SupplyUseScope, EligibilityReasonCode } from "../eligibility/domain";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { isCommercialCustomerScopeCompatible } from "../cte/eligibility.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deriveBillEligibilityContext, deriveCteCustomerScope, evaluateCustomerAndSupply } from "../eligibility/domain.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertUsableEligibilityOverride, isEligibilityOverrideable, type EligibilityOverrideProvenance, type EligibilityOverride } from "../eligibility/override.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { queryApprovedHistoricalMarketData } from "../market/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { monthsInSimulationPeriod, parseSimulationRequest } from "./input.ts";
import type { SimulationRequest } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildBillSupplyProfile, validateBillSupplyProfile, type BillSupplyProfile } from "../ingestion/bill-supply-profile.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStructuredBillExtraction, type StructuredBillExtraction } from "../ingestion/structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildTrustedElectricitySupplyContext, type ElectricitySupplyContext } from "./trusted-ee-supply-context.ts";
import type { BillEconomicComponentInput } from "../foundation/bill-economic-analysis.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildCurrentBillEconomicAnalysis } from "../foundation/bill-economic-analysis.ts";

export class BillDrivenSimulationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "BillDrivenSimulationError";
    this.code = code;
  }
}

const fail = (code: string): never => { throw new BillDrivenSimulationError(code); };
const NO_STORE_HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" } as const;

export type BillDrivenRepositories = Pick<RuntimeRepositories, "billRepository" | "foundationMemberships" | "cteArchiveRepository" | "marketArchiveRepository"> & { readonly eligibilityOverrides?: RuntimeRepositories["eligibilityOverrides"] };

export interface ContractExpiryStatus {
  readonly status: "KNOWN" | "UNKNOWN";
  readonly date?: string;
}

export const DOMESTIC_HIGH_COMMITTED_POWER_THRESHOLD_KW = 15 as const;
export const DOMESTIC_HIGH_COMMITTED_POWER_MESSAGE = "Attenzione: la fornitura è classificata come domestica ma presenta una potenza impegnata superiore a 15 kW. Verificare la tipologia d'uso e i dati contrattuali." as const;

export interface BillDrivenContextAlert {
  readonly code: "DOMESTIC_HIGH_COMMITTED_POWER";
  readonly severity: "WARNING";
  readonly requiresReview: true;
  readonly message: typeof DOMESTIC_HIGH_COMMITTED_POWER_MESSAGE;
}

export function deriveBillDrivenContextAlerts(input: {
  readonly vector: "EE" | "GAS";
  readonly domestic: boolean;
  readonly contractedPowerKw: number | null;
}): readonly BillDrivenContextAlert[] {
  if (input.vector !== "EE" || !input.domestic || input.contractedPowerKw === null || input.contractedPowerKw <= DOMESTIC_HIGH_COMMITTED_POWER_THRESHOLD_KW) return [];
  return [{
    code: "DOMESTIC_HIGH_COMMITTED_POWER",
    severity: "WARNING",
    requiresReview: true,
    message: DOMESTIC_HIGH_COMMITTED_POWER_MESSAGE,
  }];
}

export interface BillDrivenSimulationContext {
  readonly tenantId: string;
  readonly billId: string;
  readonly billVersionId: string;
  readonly ownerUserId: string | null;
  readonly vector: "EE" | "GAS";
  readonly customerType: CustomerType;
  readonly customerLegalType: CustomerLegalType;
  readonly supplyUseScope: SupplyUseScope;
  readonly identifierTypes: readonly IdentifierType[];
  readonly residency: CustomerResidency | null;
  readonly supply: {
    readonly pod: string | null;
    readonly pdr: string | null;
    readonly voltageLevel: VoltageLevel | null;
    readonly contractedPowerKw: number | null;
    readonly availablePowerKw: number | null;
  };
  readonly billingPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly consumption: {
    readonly annual: number | null;
    readonly period: { readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly smc: number | null };
    readonly monthlyProfile: readonly { readonly month: string; readonly f1: number; readonly f2: number; readonly f3: number }[] | null;
    readonly correctionCoefficient: number | null;
  };
  readonly currentSupplier: string;
  readonly currentOffer: { readonly name: string | null; readonly code: string | null };
  readonly contractExpiry: ContractExpiryStatus;
  readonly economicBaseline: { readonly amount: number; readonly currency: "EUR"; readonly source: "APPROVED_BILL" } | null;
  readonly classification: {
    readonly domestic: boolean;
    readonly nonDomestic: boolean;
    readonly resident: boolean | null;
    readonly voltageClass: VoltageLevel | null;
    readonly regulatoryCustomerScope: string | null;
    readonly bta6Eligible: boolean | null;
    readonly status: "READY" | "PARTIAL";
  };
  readonly alerts: readonly BillDrivenContextAlert[];
  readonly missingRequiredData: readonly string[];
}

export interface CteEligibilityCandidate {
  readonly cteId: string;
  readonly archiveId: string;
  readonly cteVersionId: string | null;
  readonly cteVersion: string | null;
  readonly supplier: string;
  readonly offer: { readonly name: string; readonly code: string };
  readonly validity: { readonly periodStart: string; readonly periodEnd: string };
  readonly pricingType: "INDEXED" | "FIXED" | null;
  readonly pricingReference: "PUN" | "PSV" | "NONE" | null;
  readonly eligibilityStatus: "COMPATIBLE" | "NOT_COMPATIBLE";
  readonly compatibilityReason: string;
  readonly calculationReadiness: "READY" | "MARKET_DATA_MISSING" | "NOT_READY";
  readonly reasonCodes?: readonly EligibilityReasonCode[];
  readonly finalStatus?: "ELIGIBLE" | "NOT_ELIGIBLE" | "ELIGIBLE_BY_OVERRIDE" | "BLOCKED";
  readonly eligibilityOverrideId?: string;
  readonly overrideRequestable?: boolean;
}

export interface BillDrivenPreparation {
  readonly context: BillDrivenSimulationContext;
  readonly candidates: readonly CteEligibilityCandidate[];
}

export interface BillDrivenExecutionInput {
  readonly billId: string;
  readonly billVersionId: string;
  readonly cteId: string;
  readonly cteVersionId: string;
  readonly taxTreatment: TaxInclusionState;
  readonly calculationDate: string;
  readonly eligibilityOverrideId?: string;
}

export interface BillDrivenBinding {
  readonly tenantId: string;
  readonly userId: string;
  readonly billId: string;
  readonly billVersionId: string;
  readonly selectedCteId: string;
  readonly selectedCteVersionId: string;
  readonly eligibilityOverride?: EligibilityOverrideProvenance;
}

export interface BillDrivenResolvedExecution {
  readonly binding: BillDrivenBinding;
  readonly context: BillDrivenSimulationContext;
  readonly cte: { readonly record: CteArchiveRecord; readonly version: CteArchiveVersion; readonly offer: CalculationReadyOffer };
  readonly simulation: SimulationRequest;
}

function known<T>(field: { readonly status: string; readonly value?: T | null } | undefined): T | null {
  return field?.status === "FOUND" && field.value !== undefined ? field.value : null;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function parsePower(field: BillSupplyProfile["powerCommitted"] | BillSupplyProfile["powerAvailable"]): number | null {
  if (field.status !== "FOUND" || typeof field.rawValue !== "string") return null;
  const match = field.rawValue.normalize("NFKC").trim().replace(/\s+/g, " ").match(/^(\d+(?:[.,]\d+)?)\s*kW$/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function expiryFromFacts(extraction: StructuredBillExtraction): ContractExpiryStatus {
  const fact = extraction.extendedFacts.find((candidate) => candidate.code === "CONTRACT_EXPIRY" && candidate.status === "FOUND");
  if (fact && validIsoDate(fact.value.trim())) return { status: "KNOWN", date: fact.value.trim() };
  return { status: "UNKNOWN" };
}

function approvedVersion(document: BillDocument): BillVersion {
  const versionId = document.currentApprovedVersionId ?? fail("SOURCE_BILL_NOT_APPROVED");
  const versionValue = document.versions.find((candidate) => candidate.versionId === versionId);
  if (!versionValue) fail("SOURCE_BILL_VERSION_NOT_FOUND");
  const version = versionValue as BillVersion;
  if (!document.approvals.some((approval) => approval.versionId === versionId) || document.lifecycleState === "DELETED" || document.lifecycleState === "SCHEDULED_DELETION") fail("SOURCE_BILL_NOT_APPROVED");
  const contract = version.energyContract;
  if (!contract) fail("SOURCE_BILL_CONTEXT_UNAVAILABLE");
  const approvedContract = contract as NonNullable<BillVersion["energyContract"]>;
  if (approvedContract.tenantId !== document.tenantId || approvedContract.billId !== document.id || approvedContract.version !== "1") fail("SOURCE_BILL_CONTEXT_UNAVAILABLE");
  assertEconomicReconciliation(version);
  return version;
}

function assertEconomicReconciliation(version: BillVersion): void {
  const extraction = version.structuredBill;
  if (!extraction || extraction.economicChargeLines.length === 0) return;
  const priorBalance = extraction.extendedFacts.find((fact) => fact.code === "OUTSTANDING_AMOUNT")?.value ?? null;
  const inputs: BillEconomicComponentInput[] = extraction.economicChargeLines.map((line) => ({ code: line.code, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount, period: line.periodRaw, rawDescription: line.rawDescription, rawValue: line.rawValue, rawUnit: line.rawUnit, rawQuantity: line.rawQuantity, rawUnitPrice: line.rawUnitPrice, rawAmount: line.rawAmount, rawPeriod: line.rawPeriod, documentEvidence: line.documentEvidence, status: line.status }));
  const analysis = buildCurrentBillEconomicAnalysis(inputs, extraction.totalAmount.value, { priorBalance });
  if (analysis.totals.reconciliationStatus !== "RECONCILED") fail("SOURCE_BILL_RECONCILIATION_REQUIRED");
}

function profileFor(extraction: StructuredBillExtraction): BillSupplyProfile | null {
  try {
    if (extraction.supplyProfile) {
      validateBillSupplyProfile(extraction.supplyProfile);
      return extraction.supplyProfile;
    }
    return buildBillSupplyProfile(extraction.extendedFacts);
  } catch {
    return null;
  }
}

function monthlyProfileFor(extraction: StructuredBillExtraction): BillDrivenSimulationContext["consumption"]["monthlyProfile"] {
  if (extraction.monthlyBandDocumentEvidenceStatus !== "DOCUMENT_GROUNDED" || !extraction.monthlyBands) return null;
  return extraction.monthlyBands.map((band) => ({ month: band.month, f1: band.f1, f2: band.f2, f3: band.f3 }));
}

function buildContext(document: BillDocument, version: BillVersion): BillDrivenSimulationContext {
  const contract = version.energyContract as BillContract;
  const extraction = version.structuredBill;
  if (extraction) {
    try { validateStructuredBillExtraction(extraction); } catch { fail("SOURCE_BILL_CONTEXT_UNAVAILABLE"); }
  }
  const structured = extraction ?? null;
  const profile = structured ? profileFor(structured) : null;
  const customerType = contract.customer?.customerType;
  const period = contract.billingPeriod;
  const annual = structured ? known(structured.annualConsumption) : null;
  const periodConsumption = contract.vector === "EE"
    ? { f1: contract.consumption.f1.status === "KNOWN" ? contract.consumption.f1.value : null, f2: contract.consumption.f2.status === "KNOWN" ? contract.consumption.f2.value : null, f3: contract.consumption.f3.status === "KNOWN" ? contract.consumption.f3.value : null, smc: null }
    : { f1: null, f2: null, f3: null, smc: contract.consumption.smc.status === "KNOWN" ? contract.consumption.smc.value : null };
  const residency = profile?.domesticResidenceStatus.normalizedValue === "RESIDENT" || profile?.domesticResidenceStatus.normalizedValue === "NON_RESIDENT" ? profile.domesticResidenceStatus.normalizedValue : null;
  let supplyContext: ElectricitySupplyContext | null = null;
  if (contract.vector === "EE" && profile) {
    try { supplyContext = buildTrustedElectricitySupplyContext(profile, { simulationPeriod: period, sourceBillBinding: { billId: document.id, approvedVersionId: version.versionId } }); } catch { supplyContext = null; }
  }
  const missing: string[] = [];
  if (!customerType) missing.push("customerType");
  if (!period.periodStart || !period.periodEnd) missing.push("billingPeriod");
  if (contract.vector === "EE") {
    if (!contract.supply.pod) missing.push("POD");
    if (!contract.supply.voltageLevel) missing.push("voltageLevel");
    if (periodConsumption.f1 === null) missing.push("F1");
    if (periodConsumption.f2 === null) missing.push("F2");
    if (periodConsumption.f3 === null) missing.push("F3");
    if (!supplyContext) missing.push("technicalClassification");
  } else {
    if (!contract.supply.pdr) missing.push("PDR");
    if (periodConsumption.smc === null) missing.push("SMC");
  }
  const baselineAmount = structured ? known(structured.totalAmount) : null;
  const useCategory = profile?.supplyUseCategory.normalizedValue;
  const domestic = useCategory === "DOMESTIC" || contract.customer?.customerType === "RESIDENTIAL";
  const contractedPowerKw = profile ? parsePower(profile.powerCommitted) : null;
  const billEligibility = deriveBillEligibilityContext({
    customerType,
    residency,
    profile,
    identifiers: contract.customer?.taxIdentifiers,
    evidence: [profile?.supplyUseCategory.rawValue ?? "", profile?.domesticResidenceStatus.rawValue ?? "", ...(structured?.extendedFacts ?? []).map((fact) => fact.value)],
  });
  return {
    tenantId: document.tenantId,
    billId: document.id,
    billVersionId: version.versionId,
    ownerUserId: document.ownerUserId ?? null,
    vector: contract.vector,
    customerType: customerType ?? fail("SOURCE_BILL_CONTEXT_UNAVAILABLE"),
    customerLegalType: billEligibility.customerLegalType,
    supplyUseScope: billEligibility.supplyUseScope,
    identifierTypes: billEligibility.identifierTypes,
    residency,
    supply: {
      pod: contract.vector === "EE" ? contract.supply.pod : null,
      pdr: contract.vector === "GAS" ? contract.supply.pdr : null,
      voltageLevel: contract.vector === "EE" ? contract.supply.voltageLevel : null,
      contractedPowerKw,
      availablePowerKw: profile ? parsePower(profile.powerAvailable) : null,
    },
    billingPeriod: period,
    consumption: {
      annual,
      period: periodConsumption,
      monthlyProfile: structured ? monthlyProfileFor(structured) : null,
      correctionCoefficient: contract.vector === "GAS" && contract.consumption.correctionCoefficient.status === "KNOWN" ? contract.consumption.correctionCoefficient.value : null,
    },
    currentSupplier: contract.currentSupplier,
    currentOffer: { name: known(contract.offer.offerName), code: known(contract.offer.offerCode) },
    contractExpiry: structured ? expiryFromFacts(structured) : { status: "UNKNOWN" },
    economicBaseline: baselineAmount === null ? null : { amount: baselineAmount, currency: "EUR", source: "APPROVED_BILL" },
    classification: {
      domestic,
      nonDomestic: useCategory === "OTHER_USE" || useCategory === "PUBLIC_LIGHTING" || useCategory === "PUBLIC_EV_CHARGING" || contract.customer?.customerType === "NON_RESIDENTIAL",
      resident: residency === null ? null : residency === "RESIDENT",
      voltageClass: contract.vector === "EE" ? contract.supply.voltageLevel : null,
      regulatoryCustomerScope: supplyContext?.regulatoryCustomerScope ?? null,
      bta6Eligible: supplyContext ? supplyContext.regulatoryCustomerScope === "NON_DOMESTIC_BT_BTA6" : null,
      status: missing.length === 0 ? "READY" : "PARTIAL",
    },
    alerts: deriveBillDrivenContextAlerts({ vector: contract.vector, domestic, contractedPowerKw }),
    missingRequiredData: missing,
  };
}

function requestFromContext(context: BillDrivenSimulationContext, taxTreatment: TaxInclusionState, calculationDate: string): unknown {
  const common = { schemaVersion: 1, tenantId: context.tenantId, calculationDate, supplyPeriod: context.billingPeriod, customerCategory: context.customerType, ...(context.residency ? { residency: context.residency } : {}), currency: "EUR", taxTreatment, sourceBill: { billId: context.billId, version: context.billVersionId } };
  if (context.vector === "EE") {
    const { f1, f2, f3 } = context.consumption.period;
    if (f1 === null || f2 === null || f3 === null || !context.supply.voltageLevel) fail("SOURCE_BILL_DATA_INSUFFICIENT");
    return { ...common, vector: "EE", voltageLevel: context.supply.voltageLevel, consumption: { basis: "PERIOD", unit: "KWH", f1, f2, f3, ...(context.consumption.monthlyProfile ? { monthlyProfile: context.consumption.monthlyProfile } : {}) } };
  }
  const smc = context.consumption.period.smc;
  if (smc === null) fail("SOURCE_BILL_DATA_INSUFFICIENT");
  return { ...common, vector: "GAS", consumption: { basis: "PERIOD", unit: "SMC", smc, correctionCoefficient: context.consumption.correctionCoefficient === null ? { required: false } : { required: true, value: context.consumption.correctionCoefficient } } };
}

function offerMetadata(record: CteArchiveRecord, version: CteArchiveVersion, offer: CalculationReadyOffer | null, status: CteEligibilityCandidate["eligibilityStatus"], reason: string, calculationReadiness: CteEligibilityCandidate["calculationReadiness"] = "READY", reasonCodes: readonly EligibilityReasonCode[] = []): CteEligibilityCandidate {
  const contract = version.contract;
  const finalStatus = calculationReadiness === "NOT_READY" || reason === "REVIEW_REQUIRED" ? "BLOCKED" : status === "COMPATIBLE" ? "ELIGIBLE" : "NOT_ELIGIBLE";
  return { cteId: record.cteId, archiveId: record.archiveId, cteVersionId: version.versionId, cteVersion: contract.version, supplier: contract.supplier.name, offer: { name: contract.offer.name, code: contract.offer.code }, validity: contract.validity, pricingType: offer?.pricing.mode ?? null, pricingReference: offer?.pricing.reference ?? null, eligibilityStatus: status, compatibilityReason: reason, calculationReadiness, ...(reasonCodes.length ? { reasonCodes } : {}), finalStatus, overrideRequestable: finalStatus === "NOT_ELIGIBLE" && reasonCodes.length > 0 && reasonCodes.every(isEligibilityOverrideable) };
}

async function applyAuthorizedOverride(principal: AuthenticatedPrincipal, repositories: BillDrivenRepositories, context: BillDrivenSimulationContext, candidate: CteEligibilityCandidate): Promise<CteEligibilityCandidate> {
  if (!repositories.eligibilityOverrides || candidate.finalStatus !== "NOT_ELIGIBLE" || !candidate.reasonCodes?.length || !candidate.reasonCodes.every(isEligibilityOverrideable)) return candidate;
  const records = await repositories.eligibilityOverrides.list(principal.tenantId);
  const at = new Date().toISOString();
  const match = records
    .map((record) => record.payload as EligibilityOverride)
    .find((override) => override.status === "AUTHORIZED" && override.billId === context.billId && override.billVersionId === context.billVersionId && override.cteId === candidate.cteId && (!override.expiresAt || override.expiresAt > at) && candidate.reasonCodes!.every((reason) => override.overrideScope.includes(reason as never)));
  return match ? { ...candidate, finalStatus: "ELIGIBLE_BY_OVERRIDE", eligibilityOverrideId: match.overrideId } : candidate;
}

function expired(value: string, asOf: string): boolean { return value <= asOf; }

async function evaluateCte(repository: BillDrivenRepositories["marketArchiveRepository"], context: BillDrivenSimulationContext, record: CteArchiveRecord, version: CteArchiveVersion, taxTreatment?: TaxInclusionState, asOf = new Date().toISOString().slice(0, 10)): Promise<CteEligibilityCandidate> {
  let offer: CalculationReadyOffer;
  try {
    offer = toCalculationReadyOffer(version.contract);
    assertCalculationReadyFees([...offer.fixedFees, ...offer.variableFees, ...offer.oneOffFees, ...offer.commercialDiscounts, ...(offer.imbalance.status === "DECLARED" ? [offer.imbalance.component] : [])]);
  } catch { return offerMetadata(record, version, null, "NOT_COMPATIBLE", "CALCULATION_READY_INVALID", "NOT_READY", ["CALCULATION_NOT_READY"]); }
  if (commercialStatusOf(record) !== "ACTIVE") return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "CTE_NOT_ACTIVE");
  if (version.status !== "APPROVED" || version.contract.approval.status !== "APPROVED") return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "REVIEW_REQUIRED", "NOT_READY", ["REVIEW_REQUIRED"]);
  if (expired(offer.validity.periodEnd, asOf) || (offer.expiry.status === "EXPIRES_ON" && expired(offer.expiry.date, asOf))) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "CTE_EXPIRED", "READY", ["EXPIRED_CTE"]);
  if (offer.vector !== context.vector) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "VECTOR_MISMATCH");
  if (offer.validity.periodStart > context.billingPeriod.periodStart || offer.validity.periodEnd < context.billingPeriod.periodEnd) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "CTE_VALIDITY_MISMATCH", "READY", ["VALIDITY_MISMATCH"]);
  if (offer.expiry.status === "EXPIRES_ON" && offer.expiry.date < context.billingPeriod.periodEnd) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "CTE_EXPIRED", "READY", ["EXPIRED_CTE"]);
  const customerScope: CteCommercialCustomerScope | undefined = context.vector === "EE"
    ? context.classification.regulatoryCustomerScope as CteCommercialCustomerScope | null ?? undefined
    : context.customerType === "RESIDENTIAL" ? "DOMESTIC_GAS" : "NON_DOMESTIC_GAS";
  const commercialReasons = evaluateCustomerAndSupply({
    bill: { customerLegalType: context.customerLegalType, supplyUseScope: context.supplyUseScope, identifierTypes: context.identifierTypes, legalForms: ["NOT_DECLARED"], evidence: [] },
    cte: deriveCteCustomerScope(version.contract),
  });
  if (commercialReasons.length || !isCommercialCustomerScopeCompatible(version.contract, context.customerType, customerScope)) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "CUSTOMER_NOT_ELIGIBLE", "READY", commercialReasons.length ? commercialReasons : ["CUSTOMER_LEGAL_TYPE_MISMATCH"]);
  if (context.vector === "EE" && version.contract.vector === "EE" && (!context.supply.voltageLevel || !version.contract.eligibility.voltageLevels.includes(context.supply.voltageLevel))) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "VOLTAGE_NOT_ELIGIBLE", "READY", ["VOLTAGE_MISMATCH"]);
  if (taxTreatment !== undefined && offer.taxTreatment !== taxTreatment) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "TAX_TREATMENT_INCOMPATIBLE");
  if (offer.imbalance.status === "NOT_DECLARED" && offer.imbalance.reason === "NOT_PROVIDED") return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "IMBALANCE_UNAVAILABLE");
  const feeUnits = [...offer.fixedFees, ...offer.variableFees, ...offer.oneOffFees, ...offer.commercialDiscounts, ...(offer.imbalance.status === "DECLARED" ? [offer.imbalance.component] : [])].map((fee) => fee.unit);
  if (feeUnits.some((unit) => context.vector === "EE" ? unit === "EUR_PER_SMC" : unit === "EUR_PER_KWH")) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "FEE_UNIT_MISMATCH");
  if (context.missingRequiredData.length > 0) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "BILL_DATA_INSUFFICIENT", "NOT_READY", ["CALCULATION_NOT_READY"]);
  const indexed = offer.pricing.mode === "INDEXED";
  if (indexed && monthsInSimulationPeriod(context.billingPeriod).length > 1 && !context.consumption.monthlyProfile) return offerMetadata(record, version, offer, "NOT_COMPATIBLE", "MONTHLY_PROFILE_REQUIRED");
  if (indexed) {
    const index = offer.pricing.reference;
    for (const month of monthsInSimulationPeriod(context.billingPeriod)) {
      const market = await queryApprovedHistoricalMarketData(repository, context.tenantId, `${month}-15`, context.vector);
      if (!market.some((candidate) => candidate.month === month && candidate.index === index)) return offerMetadata(record, version, offer, "COMPATIBLE", "COMPATIBLE_MARKET_DATA_UNAVAILABLE", "MARKET_DATA_MISSING");
    }
  }
  return offerMetadata(record, version, offer, "COMPATIBLE", "COMPATIBLE");
}

export async function prepareBillDrivenSimulation(principal: AuthenticatedPrincipal, repositories: BillDrivenRepositories, billId: string, taxTreatment?: TaxInclusionState, asOf = new Date().toISOString().slice(0, 10)): Promise<BillDrivenPreparation> {
  if (typeof billId !== "string" || !billId.trim()) fail("SOURCE_BILL_ID_REQUIRED");
  const documentValue = await getBillInScope(principal, repositories, billId);
  if (!documentValue) fail("SOURCE_BILL_NOT_FOUND");
  const document = documentValue as BillDocument;
  const version = approvedVersion(document);
  const context = buildContext(document, version);
  const records = await repositories.cteArchiveRepository.list(principal.tenantId);
  const candidates: CteEligibilityCandidate[] = [];
  for (const record of records) {
    const current = currentApprovedCteVersion(record);
    if (!current) continue;
    candidates.push(await applyAuthorizedOverride(principal, repositories, context, await evaluateCte(repositories.marketArchiveRepository, context, record, current, taxTreatment, asOf)));
  }
  return { context, candidates };
}

export async function listBillDrivenSources(principal: AuthenticatedPrincipal, repositories: Pick<RuntimeRepositories, "billRepository" | "foundationMemberships">): Promise<readonly Record<string, unknown>[]> {
  const documents = (await repositories.billRepository.list(principal.tenantId)).filter((document) => document.tenantId === principal.tenantId && document.currentApprovedVersionId !== null && document.lifecycleState !== "DELETED" && document.lifecycleState !== "SCHEDULED_DELETION");
  const scoped: BillDocument[] = [];
  for (const document of documents) {
    const visible = await getBillInScope(principal, repositories, document.id);
    if (visible) {
      try { approvedVersion(visible); scoped.push(visible); } catch { /* An approved pointer without an authoritative contract is not a usable source. */ }
    }
  }
  return scoped.map((document) => {
    const versionId = document.currentApprovedVersionId as string;
    const version = document.versions.find((candidate) => candidate.versionId === versionId);
    const contract = version?.energyContract;
    return { billId: document.id, billVersionId: versionId, tenantId: document.tenantId, ownerUserId: document.ownerUserId ?? null, vector: contract?.vector ?? null, supplier: contract?.currentSupplier ?? null, period: contract?.billingPeriod ?? null, status: "APPROVED" };
  });
}

export async function resolveBillDrivenExecution(principal: AuthenticatedPrincipal, repositories: BillDrivenRepositories, input: BillDrivenExecutionInput): Promise<BillDrivenResolvedExecution> {
  const prepared = await prepareBillDrivenSimulation(principal, repositories, input.billId, input.taxTreatment, input.calculationDate);
  if (prepared.context.billVersionId !== input.billVersionId) fail("SOURCE_BILL_VERSION_MISMATCH");
  const candidateValue = prepared.candidates.find((item) => item.archiveId === input.cteId || item.cteId === input.cteId);
  if (!candidateValue) fail("CTE_NOT_COMPATIBLE");
  const candidate = candidateValue as CteEligibilityCandidate;
  let overrideProvenance: EligibilityOverrideProvenance | undefined;
  if (candidate.calculationReadiness !== "READY" || candidate.finalStatus === "BLOCKED") fail(candidate.reasonCodes?.[0] ?? candidate.calculationReadiness);
  if (candidate.eligibilityStatus !== "COMPATIBLE") {
    const overrideId = input.eligibilityOverrideId;
    const mismatchReasons = candidate.reasonCodes;
    if (!overrideId) fail(candidate.compatibilityReason);
    if (!mismatchReasons || mismatchReasons.length === 0) fail(candidate.compatibilityReason);
    const verified = await assertUsableEligibilityOverride(principal, repositories as RuntimeRepositories, { overrideId: overrideId as string, billId: input.billId, billVersionId: input.billVersionId, cteId: candidate.cteId, mismatchReasons: mismatchReasons as readonly EligibilityReasonCode[], now: input.calculationDate });
    overrideProvenance = verified.provenance;
  }
  if (candidate.cteVersionId !== input.cteVersionId) fail("CTE_VERSION_MISMATCH");
  const recordValue = await repositories.cteArchiveRepository.get(principal.tenantId, candidate.archiveId);
  if (!recordValue) fail("CTE_NOT_FOUND");
  const record = recordValue as CteArchiveRecord;
  const versionValue = currentApprovedCteVersion(record);
  if (!versionValue || versionValue.versionId !== input.cteVersionId) fail("CTE_VERSION_MISMATCH");
  const approvedCteRecord = record;
  const approvedCteVersion = versionValue as CteArchiveVersion;
  const offer = toCalculationReadyOffer(approvedCteVersion.contract);
  const raw = requestFromContext(prepared.context, input.taxTreatment, input.calculationDate);
  const simulation = parseSimulationRequest(raw, principal.tenantId);
  if (overrideProvenance) {
    (simulation as SimulationRequest & { eligibilityOverride?: EligibilityOverrideProvenance }).eligibilityOverride = overrideProvenance;
  }
  return { binding: { tenantId: principal.tenantId, userId: principal.userId, billId: input.billId, billVersionId: input.billVersionId, selectedCteId: approvedCteRecord.cteId, selectedCteVersionId: approvedCteVersion.versionId, ...(overrideProvenance ? { eligibilityOverride: overrideProvenance } : {}) }, context: prepared.context, cte: { record: approvedCteRecord, version: approvedCteVersion, offer }, simulation };
}

export { NO_STORE_HEADERS };
