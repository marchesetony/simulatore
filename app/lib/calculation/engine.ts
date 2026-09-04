import { createHash } from "node:crypto";
import type { CteArchiveRecord, CteArchiveVersion } from "../cte/archive/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { commercialStatusOf, currentApprovedCteVersion } from "../cte/archive/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toCalculationReadyOffer, assertCalculationReadyFees } from "../cte/calculation-ready.ts";
import type { CalculationReadyOffer, CteDeclaredComponent, CteFeeComponent, ElectricityPricing, GasPricing } from "../cte/types";
import type { MarketArchiveRepository, MarketArchiveRecord } from "../market/types";
import type { ElectricityMonthlyPunRecord, GasMonthlyPsvRecord } from "../energy/market-data";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { queryApprovedHistoricalMarketData } from "../market/service.ts";
import type { CteArchiveRepository } from "../cte/archive/types";
import type { CalculationComponent, CalculationExclusion, CalculationExclusionCode, CalculationMarketReference, CalculationMoney, CalculationResult, ElectricitySimulationRequest, GasSimulationRequest, SimulationRequest } from "./types";
import type { ElectricitySupplyContext } from "./trusted-ee-supply-context.ts";
import type { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { add, divide, fromNumber, multiply, rational, roundCents, toDecimal, type Rational } from "./decimal.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { monthsInSimulationPeriod } from "./input.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { calculateRegulatedEeSubset, type RegulatedEeExecutionContext } from "./regulated-ee.ts";

export class CalculationEngineError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "CalculationEngineError"; this.code = code; }
}
const fail = (code: string): never => { throw new CalculationEngineError(code); };

interface ComponentDraft {
  readonly componentId: string;
  readonly category: CalculationComponent["category"];
  readonly label: string;
  readonly sign: CalculationComponent["sign"];
  readonly value: Rational;
  readonly formulaId: string;
  readonly formulaInputs: Readonly<Record<string, string | number | boolean>>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function money(minorUnits: number): CalculationMoney { return { amount: minorUnits / 100, minorUnits, currency: "EUR" }; }
function monthCount(request: SimulationRequest): Rational { return fromNumber(monthsInSimulationPeriod(request.supplyPeriod).length); }
function quantityForFee(unit: CteFeeComponent["unit"], request: SimulationRequest, totalQuantity: Rational, months: Rational): Rational {
  if (unit === "EUR_PER_KWH" && request.vector !== "EE") fail("FEE_UNIT_MISMATCH");
  if (unit === "EUR_PER_SMC" && request.vector !== "GAS") fail("FEE_UNIT_MISMATCH");
  if (unit === "EUR_PER_KWH" || unit === "EUR_PER_SMC") return totalQuantity;
  if (unit === "EUR_PER_MONTH") return months;
  if (unit === "EUR_PER_YEAR") return divide(months, fromNumber(12));
  return rational(BigInt(1));
}
function addFeeComponents(target: ComponentDraft[], fees: readonly CteFeeComponent[], category: CalculationComponent["category"], request: SimulationRequest, totalQuantity: Rational, months: Rational): void {
  fees.forEach((fee) => {
    const multiplier = quantityForFee(fee.unit, request, totalQuantity, months);
    target.push({ componentId: `${category.toLowerCase()}:${fee.feeId}`, category, label: fee.label, sign: category === "DISCOUNT" ? "DISCOUNT" : "CHARGE", value: multiply(fromNumber(fee.amount), multiplier), formulaId: "FEE_RATE_TIMES_BASIS", formulaInputs: { feeId: fee.feeId, feeUnit: fee.unit, feeRate: fee.amount, basisQuantity: toDecimal(multiplier, 6), taxTreatment: fee.taxTreatment } });
  });
}
function addDeclaredComponent(target: ComponentDraft[], declared: CteDeclaredComponent, category: "IMBALANCE", request: SimulationRequest, totalQuantity: Rational, months: Rational): void {
  if (declared.status === "NOT_DECLARED") { if (declared.reason === "NOT_PROVIDED") fail("IMBALANCE_UNAVAILABLE"); return; }
  const multiplier = quantityForFee(declared.component.unit, request, totalQuantity, months);
  target.push({ componentId: `${category.toLowerCase()}:${declared.component.feeId}`, category, label: declared.component.label, sign: "CHARGE", value: multiply(fromNumber(declared.component.amount), multiplier), formulaId: "IMBALANCE_RATE_TIMES_BASIS", formulaInputs: { feeId: declared.component.feeId, feeUnit: declared.component.unit, feeRate: declared.component.amount, basisQuantity: toDecimal(multiplier, 6), taxTreatment: declared.component.taxTreatment } });
}
function addOneOffComponents(target: ComponentDraft[], fees: readonly CteFeeComponent[]): void {
  fees.forEach((fee) => { if (fee.unit !== "EUR_PER_CONTRACT") fail("ONE_OFF_FEE_UNIT_INVALID"); target.push({ componentId: `one-off:${fee.feeId}`, category: "ONE_OFF_FEE", label: fee.label, sign: "CHARGE", value: fromNumber(fee.amount), formulaId: "ONE_OFF_CONTRACT_FEE", formulaInputs: { feeId: fee.feeId, feeUnit: fee.unit, feeRate: fee.amount, taxTreatment: fee.taxTreatment } }); });
}
function convertDrafts(drafts: readonly ComponentDraft[]): readonly CalculationComponent[] { return drafts.map((draft) => ({ componentId: draft.componentId, category: draft.category, label: draft.label, sign: draft.sign, amount: money(roundCents(draft.value)), formulaId: draft.formulaId, formulaInputs: draft.formulaInputs })); }
function totalMinor(components: readonly CalculationComponent[]): number {
  const total = components.reduce((sum, component) => sum + BigInt(component.sign === "DISCOUNT" ? -component.amount.minorUnits : component.amount.minorUnits), BigInt(0));
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new CalculationEngineError("CALCULATION_AMOUNT_OVERFLOW");
  return Number(total);
}
function componentWarning(request: SimulationRequest): readonly string[] { return request.sourceBill ? ["SOURCE_BILL_REFERENCE_RECORDED"] : []; }

export interface CalculationDependencies {
  readonly trustedElectricityContext?: ElectricitySupplyContext;
  readonly regulatoryBridge?: Pick<ProductionRegulatoryPersistenceBridge, "list">;
}

function profileForEe(request: ElectricitySimulationRequest, month: string): { readonly f1: number; readonly f2: number; readonly f3: number } {
  if (request.consumption.monthlyProfile) return request.consumption.monthlyProfile.find((profile) => profile.month === month) ?? fail("MONTHLY_PROFILE_INVALID");
  if (monthsInSimulationPeriod(request.supplyPeriod).length !== 1) fail("MONTHLY_PROFILE_REQUIRED");
  return { f1: request.consumption.f1, f2: request.consumption.f2, f3: request.consumption.f3 };
}
function profileForGas(request: GasSimulationRequest, month: string): number {
  if (request.consumption.monthlyProfile) return request.consumption.monthlyProfile.find((profile) => profile.month === month)?.smc ?? fail("MONTHLY_PROFILE_INVALID");
  if (monthsInSimulationPeriod(request.supplyPeriod).length !== 1) fail("MONTHLY_PROFILE_REQUIRED");
  return request.consumption.smc;
}

async function marketForMonths(repository: MarketArchiveRepository, request: SimulationRequest, indexed: boolean): Promise<readonly MarketArchiveRecord[]> {
  if (!indexed) return [];
  const result: MarketArchiveRecord[] = [];
  for (const month of monthsInSimulationPeriod(request.supplyPeriod)) {
    const date = `${month}-15`;
    const records = await queryApprovedHistoricalMarketData(repository, request.tenantId, date, request.vector);
    const record = records.find((candidate) => candidate.month === month);
    if (!record) return fail("MARKET_DATA_MISSING");
    result.push(record);
  }
  return result;
}

function referenceOf(record: MarketArchiveRecord): CalculationMarketReference { return { recordId: record.record.recordId, version: record.record.version, vector: record.vector, index: record.index, month: record.month, effectiveFrom: record.record.effectiveFrom, effectiveTo: record.record.effectiveTo }; }
function assertPriceCurrency(offer: CalculationReadyOffer, request: SimulationRequest): void {
  if (offer.currency !== request.currency) fail("CURRENCY_INCOMPATIBLE");
  if (offer.taxTreatment !== request.taxTreatment) fail("TAX_TREATMENT_INCOMPATIBLE");
  const componentTaxTreatments = [
    ...offer.fixedFees,
    ...offer.variableFees,
    ...offer.oneOffFees,
    ...offer.commercialDiscounts,
    ...(offer.imbalance.status === "DECLARED" ? [offer.imbalance.component] : []),
  ].map((component) => component.taxTreatment);
  const pricingTaxTreatments = offer.pricing.mode === "FIXED"
    ? [offer.pricing.fixedPrice.taxTreatment, ...(offer.pricing.spread.status === "DECLARED" ? [offer.pricing.spread.component.taxTreatment] : [])]
    : [offer.pricing.spread.taxTreatment];
  if ([...componentTaxTreatments, ...pricingTaxTreatments].some((treatment) => treatment !== request.taxTreatment)) fail("TAX_TREATMENT_INCOMPATIBLE");
}

function addElectricityEnergy(target: ComponentDraft[], request: ElectricitySimulationRequest, offer: CalculationReadyOffer, markets: readonly MarketArchiveRecord[]): void {
  const pricing = offer.pricing as ElectricityPricing;
  if (pricing.mode === "FIXED") {
    const total = add(add(fromNumber(request.consumption.f1), fromNumber(request.consumption.f2)), fromNumber(request.consumption.f3));
    target.push({ componentId: "energy:fixed", category: "ENERGY", label: "Energia EE prezzo fisso", sign: "CHARGE", value: multiply(fromNumber(pricing.fixedPrice.amount), total), formulaId: "EE_FIXED_PRICE_TIMES_KWH", formulaInputs: { unit: pricing.fixedPrice.unit, pricePerKwh: pricing.fixedPrice.amount, f1Kwh: request.consumption.f1, f2Kwh: request.consumption.f2, f3Kwh: request.consumption.f3, taxTreatment: pricing.fixedPrice.taxTreatment } });
    if (pricing.spread.status === "DECLARED") target.push({ componentId: "energy:fixed-spread", category: "ENERGY", label: "Spread EE", sign: "CHARGE", value: multiply(fromNumber(pricing.spread.component.amount), total), formulaId: "EE_SPREAD_TIMES_KWH", formulaInputs: { unit: pricing.spread.component.unit, spreadPerKwh: pricing.spread.component.amount, totalKwh: toDecimal(total, 6), taxTreatment: pricing.spread.component.taxTreatment } });
    return;
  }
  markets.forEach((market) => {
    const profile = profileForEe(request, market.month);
    const values = [profile.f1, profile.f2, profile.f3];
    const marketRecord = market.record;
    if (marketRecord.vector !== "EE") fail("MARKET_DATA_INVALID");
    const electricityRecord = marketRecord as ElectricityMonthlyPunRecord;
    const f1 = electricityRecord.f1;
    const f2 = electricityRecord.f2;
    const f3 = electricityRecord.f3;
    if (!f1 || !f2 || !f3) fail("MARKET_VALUES_MISSING");
    const rates = [f1!.value, f2!.value, f3!.value];
    values.forEach((quantity, index) => target.push({ componentId: `energy:${market.month}:f${index + 1}`, category: "ENERGY", label: `Energia EE indicizzata F${index + 1} ${market.month}`, sign: "CHARGE", value: multiply(add(divide(fromNumber(rates[index]), fromNumber(1000)), fromNumber(pricing.spread.amount)), fromNumber(quantity)), formulaId: "EE_PUN_MWH_TO_KWH_PLUS_SPREAD", formulaInputs: { month: market.month, band: `F${index + 1}`, quantityKwh: quantity, punEurPerMwh: rates[index], mwhToKwh: 1000, spreadPerKwh: pricing.spread.amount, marketRecordId: marketRecord.recordId, marketVersion: marketRecord.version, taxTreatment: pricing.spread.taxTreatment } }));
  });
}

function addGasEnergy(target: ComponentDraft[], request: GasSimulationRequest, offer: CalculationReadyOffer, markets: readonly MarketArchiveRecord[]): Rational {
  const pricing = offer.pricing as GasPricing;
  const coefficient = request.consumption.correctionCoefficient.value === undefined ? fromNumber(1) : fromNumber(request.consumption.correctionCoefficient.value);
  const effectiveTotal = multiply(fromNumber(request.consumption.smc), coefficient);
  if (pricing.mode === "FIXED") target.push({ componentId: "energy:fixed", category: "ENERGY", label: "Energia GAS prezzo fisso", sign: "CHARGE", value: multiply(fromNumber(pricing.fixedPrice.amount), effectiveTotal), formulaId: "GAS_FIXED_PRICE_TIMES_SMC", formulaInputs: { unit: pricing.fixedPrice.unit, pricePerSmc: pricing.fixedPrice.amount, smc: request.consumption.smc, correctionCoefficient: request.consumption.correctionCoefficient.value ?? 1, correctionCoefficientRequired: request.consumption.correctionCoefficient.required, effectiveSmc: toDecimal(effectiveTotal, 6), taxTreatment: pricing.fixedPrice.taxTreatment } });
  else markets.forEach((market) => {
    const smc = profileForGas(request, market.month);
    const marketRecord = market.record;
    if (marketRecord.vector !== "GAS") fail("MARKET_DATA_INVALID");
    const gasRecord = marketRecord as GasMonthlyPsvRecord;
    target.push({ componentId: `energy:${market.month}`, category: "ENERGY", label: `Energia GAS indicizzata ${market.month}`, sign: "CHARGE", value: multiply(add(fromNumber(gasRecord.value.value), fromNumber(pricing.spread.amount)), multiply(fromNumber(smc), coefficient)), formulaId: "GAS_PSV_PLUS_SPREAD_TIMES_SMC", formulaInputs: { month: market.month, smc, correctionCoefficient: request.consumption.correctionCoefficient.value ?? 1, correctionCoefficientRequired: request.consumption.correctionCoefficient.required, effectiveSmc: toDecimal(multiply(fromNumber(smc), coefficient), 6), psvEurPerSmc: gasRecord.value.value, spreadPerSmc: pricing.spread.amount, marketRecordId: gasRecord.recordId, marketVersion: gasRecord.version, taxTreatment: pricing.spread.taxTreatment } });
  });
  if (pricing.mode === "FIXED" && pricing.spread.status === "DECLARED") target.push({ componentId: "energy:fixed-spread", category: "ENERGY", label: "Spread GAS", sign: "CHARGE", value: multiply(fromNumber(pricing.spread.component.amount), effectiveTotal), formulaId: "GAS_SPREAD_TIMES_SMC", formulaInputs: { spreadPerSmc: pricing.spread.component.amount, effectiveSmc: toDecimal(effectiveTotal, 6), taxTreatment: pricing.spread.component.taxTreatment } });
  return effectiveTotal;
}

function readyVersion(record: CteArchiveRecord): CteArchiveVersion { const commercialStatus = commercialStatusOf(record); if (commercialStatus === "BLOCKED") return fail("CTE_COMMERCIAL_BLOCKED"); if (commercialStatus === "DELETED") return fail("CTE_COMMERCIAL_DELETED"); const version = currentApprovedCteVersion(record); if (version === null || version.status !== "APPROVED" || version.contract.approval.status !== "APPROVED") return fail("CTE_NOT_APPROVED"); return version; }

export interface EligibleOffer {
  readonly record: CteArchiveRecord;
  readonly version: CteArchiveVersion;
  readonly offer: CalculationReadyOffer;
  readonly markets: readonly MarketArchiveRecord[];
}

export async function prepareApprovedOffer(cteRepository: CteArchiveRepository, marketRepository: MarketArchiveRepository, request: SimulationRequest, archiveId: string): Promise<EligibleOffer> {
  const record = await cteRepository.get(request.tenantId, archiveId);
  if (record === null) return fail("CTE_NOT_FOUND");
  if (record.vector !== request.vector) fail("VECTOR_MISMATCH");
  const version = readyVersion(record);
  const offer: CalculationReadyOffer = (() => { try { const result = toCalculationReadyOffer(version.contract); assertCalculationReadyFees([...result.fixedFees, ...result.variableFees, ...result.oneOffFees, ...(result.imbalance.status === "DECLARED" ? [result.imbalance.component] : []), ...result.commercialDiscounts]); return result; } catch { return fail("CALCULATION_READY_INVALID"); } })();
  assertPriceCurrency(offer, request);
  if (offer.validity.periodStart > request.supplyPeriod.periodStart || offer.validity.periodEnd < request.supplyPeriod.periodEnd || request.calculationDate < offer.validity.periodStart || request.calculationDate >= offer.validity.periodEnd) fail("CTE_VALIDITY_MISMATCH");
  if (offer.expiry.status === "EXPIRES_ON" && offer.expiry.date < request.supplyPeriod.periodEnd) fail("CTE_EXPIRED");
  if (!offer.vector || offer.vector !== request.vector) fail("VECTOR_MISMATCH");
  if (!offer.vector || !record.versions.some((candidate) => candidate.versionId === version.versionId && candidate.status === "APPROVED")) fail("CTE_NOT_APPROVED");
  const contract = version.contract;
  if (!contract.eligibility.customerTypes.includes(request.customerCategory)) fail("CUSTOMER_NOT_ELIGIBLE");
  if (request.vector === "EE" && contract.vector === "EE" && !contract.eligibility.voltageLevels.includes(request.voltageLevel)) fail("VOLTAGE_NOT_ELIGIBLE");
  if (offer.commercialDiscounts.some((fee) => fee.unit === "EUR_PER_SMC" && request.vector === "EE" || fee.unit === "EUR_PER_KWH" && request.vector === "GAS")) fail("FEE_UNIT_MISMATCH");
  if (offer.imbalance.status === "NOT_DECLARED" && offer.imbalance.reason === "NOT_PROVIDED") fail("IMBALANCE_UNAVAILABLE");
  const indexed = offer.pricing.mode === "INDEXED"; const markets = await marketForMonths(marketRepository, request, indexed);
  return { record, version, offer, markets };
}

export async function assertCommerciallyActive(cteRepository: CteArchiveRepository, tenantId: string, archiveId: string, versionId: string): Promise<void> {
  const record = await cteRepository.get(tenantId, archiveId);
  if (record === null) return fail("CTE_NOT_FOUND");
  const commercialStatus = commercialStatusOf(record);
  if (commercialStatus === "BLOCKED") return fail("CTE_COMMERCIAL_BLOCKED");
  if (commercialStatus === "DELETED") return fail("CTE_COMMERCIAL_DELETED");
  const version = currentApprovedCteVersion(record);
  if (version === null || version.versionId !== versionId || version.status !== "APPROVED" || version.contract.approval.status !== "APPROVED") return fail("CTE_NOT_APPROVED");
}

export async function calculatePreparedOffer(request: SimulationRequest, prepared: EligibleOffer, dependencies: CalculationDependencies = {}): Promise<CalculationResult> {
  let regulated: Awaited<ReturnType<typeof calculateRegulatedEeSubset>> | null = null;
  if (request.vector === "EE" && request.sourceBill) {
    const trustedElectricityContext = dependencies.trustedElectricityContext;
    const regulatoryBridge = dependencies.regulatoryBridge;
    if (!trustedElectricityContext) throw new CalculationEngineError("REGULATORY_TRUST_CONTEXT_REQUIRED");
    if (!regulatoryBridge) throw new CalculationEngineError("REGULATORY_BRIDGE_REQUIRED");
    const execution: RegulatedEeExecutionContext = { trustedElectricityContext, regulatoryBridge };
    regulated = await calculateRegulatedEeSubset(request, execution);
  }
  const drafts: ComponentDraft[] = []; const totalQuantity = request.vector === "EE" ? add(add(fromNumber(request.consumption.f1), fromNumber(request.consumption.f2)), fromNumber(request.consumption.f3)) : multiply(fromNumber(request.consumption.smc), request.consumption.correctionCoefficient.value === undefined ? fromNumber(1) : fromNumber(request.consumption.correctionCoefficient.value)); const months = monthCount(request);
  if (request.vector === "EE") addElectricityEnergy(drafts, request, prepared.offer, prepared.markets); else addGasEnergy(drafts, request, prepared.offer, prepared.markets);
  addFeeComponents(drafts, prepared.offer.fixedFees, "FIXED_FEE", request, totalQuantity, months);
  addFeeComponents(drafts, prepared.offer.variableFees, "VARIABLE_FEE", request, totalQuantity, months);
  addDeclaredComponent(drafts, prepared.offer.imbalance, "IMBALANCE", request, totalQuantity, months);
  addOneOffComponents(drafts, prepared.offer.oneOffFees);
  addFeeComponents(drafts, prepared.offer.commercialDiscounts, "DISCOUNT", request, totalQuantity, months);
  const commercialComponents = convertDrafts(drafts); const regulatedComponents = regulated?.components ?? []; const components = [...commercialComponents, ...regulatedComponents]; const totalCommercial = totalMinor(commercialComponents); const totalRegulated = regulated === null ? null : totalMinor(regulatedComponents); const totalPlusRegulated = totalRegulated === null ? null : totalCommercial + totalRegulated; if (totalQuantity.numerator <= BigInt(0)) fail("CALCULATION_ZERO_CONSUMPTION"); const unit: "EUR_PER_KWH" | "EUR_PER_SMC" = request.vector === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC"; const unitCost = { amount: toDecimal(divide(rational(BigInt(totalCommercial), BigInt(100)), totalQuantity), 6), unit, currency: "EUR" as const }; const baseline = request.baseline ? roundCents(fromNumber(request.baseline.totalCommercialCost)) : null; const marketData = prepared.markets.map(referenceOf); const normalizedInput = request; const costScope = regulated === null ? "COMMERCIAL_ONLY" as const : "COMMERCIAL_PLUS_REGULATED_PARTIAL" as const; const payload = { schemaVersion: 1 as const, engineVersion: "1" as const, normalizedInput, sourceCte: { archiveId: prepared.record.archiveId, cteId: prepared.record.cteId, versionId: prepared.version.versionId, version: prepared.version.contract.version, supplier: prepared.version.contract.supplier.name, offerCode: prepared.offer.offerCode }, marketData, components, totalCommercialCost: money(totalCommercial), totalRegulatedSubsetCost: totalRegulated === null ? null : money(totalRegulated), totalCommercialPlusRegulatedSubsetCost: totalPlusRegulated === null ? null : money(totalPlusRegulated), costScope, regulatedComponentsIncluded: regulated === null ? [] : [...regulated.includedComponents], regulatoryData: { references: regulated?.references ?? [] }, unitCost, roundingPolicy: "ROUND_HALF_UP_TO_CENT_PER_COMPONENT" as const }; const resultFingerprint = fingerprint(payload); return { ...payload, calculationId: `calc_${resultFingerprint.slice(0, 32)}`, fingerprint: resultFingerprint, calculatedAt: `${request.calculationDate}T00:00:00.000Z`, tenantId: request.tenantId, vector: request.vector, customerCategory: request.customerCategory, ...(request.vector === "EE" ? { voltageLevel: request.voltageLevel } : {}), calculationDate: request.calculationDate, supplyPeriod: request.supplyPeriod, currency: "EUR", taxTreatment: request.taxTreatment, savingsVsBaseline: baseline === null ? null : money(baseline - totalCommercial), warnings: [...componentWarning(request), ...(regulated === null ? [] : [regulated.partialWarning])] };
}

export async function calculateApprovedOffer(cteRepository: CteArchiveRepository, marketRepository: MarketArchiveRepository, request: SimulationRequest, archiveId: string, dependencies: CalculationDependencies = {}): Promise<CalculationResult> { const prepared = await prepareApprovedOffer(cteRepository, marketRepository, request, archiveId); return calculatePreparedOffer(request, prepared, dependencies); }

export function exclusionFor(record: CteArchiveRecord, code: CalculationExclusionCode, message: string): CalculationExclusion { const version = record.currentApprovedVersionId ? record.versions.find((candidate) => candidate.versionId === record.currentApprovedVersionId) : null; const contract = version?.contract ?? record.versions[0]?.contract; return { archiveId: record.archiveId, cteId: record.cteId, vector: record.vector, supplier: contract?.supplier.name ?? "", offerCode: contract?.offer.code ?? "", cteVersion: version?.contract.version ?? null, code, message }; }
