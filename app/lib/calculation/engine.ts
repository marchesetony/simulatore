// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { applyCommercialAdjustment } from "../cte/commercial-adjustment.ts";
import { createHash } from "node:crypto";
import type { CteArchiveRecord, CteArchiveVersion } from "../cte/archive/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { commercialStatusOf, currentApprovedCteVersion } from "../cte/archive/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toCalculationReadyOffer, assertCalculationReadyFees } from "../cte/calculation-ready.ts";
import type { CalculationReadyOffer, CteDeclaredComponent, CteFeeComponent, CtePassThroughComponent, CtePassThroughKind, ElectricityPricing, GasPricing } from "../cte/types";
import type { MarketArchiveRepository, MarketArchiveRecord } from "../market/types";
import type { ElectricityMonthlyPunRecord, GasMonthlyPsvRecord } from "../energy/market-data";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { queryApprovedHistoricalMarketData } from "../market/service.ts";
import type { CteArchiveRepository } from "../cte/archive/types";
import type { CalculationComponent, CalculationExclusion, CalculationExclusionCode, CalculationMarketReference, CalculationMoney, CalculationResult, ContractualPassThroughState, ContractualPassThroughStatus, ElectricitySimulationRequest, GasSimulationRequest, SimulationRequest, SimulationPeriod } from "./types";
import type { ElectricitySupplyContext } from "./trusted-ee-supply-context.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveCteRegulatoryRuntime, type CteRegulatoryRuntimeResolver, type CteRuntimeResolution, type ResolvedOfficialRuntimeValue } from "./regulatory-runtime-resolvers.ts";
import type { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
import type { TenantRecordRepository } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { add, divide, fromNumber, multiply, rational, roundCents, toDecimal, type Rational } from "./decimal.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { monthsInSimulationPeriod } from "./input.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_TIV_CAPACITY_MONTHS, areraCapacityForPeriod, mergeAreraCapacityMonths, type AreraCapacityMonth } from "../foundation/arera-capacity-tiv.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { TERNA_TIDE_DISPATCHING_QUARTERS, mergeTernaTideQuarters, ternaTideForPeriod, type TernaTideQuarter } from "../foundation/terna-tide-dispatching.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { isSameOffer } from "../quote/same-offer.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { BTA6_REGULATED_COMPONENTS_INCLUDED, calculateRegulatedEeSubset, isDomesticNetOfTaxCompleteComponents, type RegulatedEeExecutionContext } from "./regulated-ee.ts";

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
function quantityForFee(fee: Pick<CteFeeComponent, "unit" | "period">, request: SimulationRequest, totalQuantity: Rational, months: Rational): Rational {
  const unit = fee.unit;
  if (unit === "EUR_PER_KWH" && request.vector !== "EE") fail("FEE_UNIT_MISMATCH");
  if (unit === "EUR_PER_SMC" && request.vector !== "GAS") fail("FEE_UNIT_MISMATCH");
  if (unit === "EUR_PER_KWH" || unit === "EUR_PER_SMC") return totalQuantity;
  if (unit === "EUR_PER_POD") {
    if (fee.period === "YEAR") return divide(months, fromNumber(12));
    if (fee.period === "MONTH") return months;
    return fail("FEE_PERIOD_REQUIRED");
  }
  if (unit === "EUR_PER_MONTH") return months;
  if (unit === "EUR_PER_YEAR") return divide(months, fromNumber(12));
  return rational(BigInt(1));
}
function addFeeComponents(target: ComponentDraft[], fees: readonly CteFeeComponent[], category: CalculationComponent["category"], request: SimulationRequest, totalQuantity: Rational, months: Rational): void {
  fees.forEach((fee) => {
    const multiplier = quantityForFee(fee, request, totalQuantity, months);
    target.push({ componentId: `${category.toLowerCase()}:${fee.feeId}`, category, label: fee.label, sign: category === "DISCOUNT" ? "DISCOUNT" : "CHARGE", value: multiply(fromNumber(fee.amount), multiplier), formulaId: "FEE_RATE_TIMES_BASIS", formulaInputs: { feeId: fee.feeId, feeUnit: fee.unit, ...(fee.period === undefined ? {} : { feePeriod: fee.period }), feeRate: fee.amount, basisQuantity: toDecimal(multiplier, 6), taxTreatment: fee.taxTreatment } });
  });
}
function addDeclaredComponent(target: ComponentDraft[], declared: CteDeclaredComponent, category: "IMBALANCE", request: SimulationRequest, totalQuantity: Rational, months: Rational): void {
  // A CTE that says nothing about imbalance charges none apart: it is a seller fee with no official value to fall back on
  // (Tony, 28/10, BPower BE Family Casa Protetta, Porta un amico Family, Be Family Fast 26 left out for it).
  if (declared.status === "NOT_DECLARED") return;
  const multiplier = quantityForFee(declared.component, request, totalQuantity, months);
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
function assertEeNetTaxPolicy(request: SimulationRequest): void { if (request.vector === "EE" && request.taxTreatment !== "EXCLUDED") fail("TAX_TREATMENT_INCOMPATIBLE"); }

const CONTRACTUAL_REQUIRED_KINDS = ["DISPATCHING", "CAPACITY_MARKET"] as const;
function contractualStateOf(state: CtePassThroughComponent["declarationState"]): ContractualPassThroughState {
  if (state === "EXPLICIT_COMPONENT") return "RESOLVED_EXPLICIT";
  if (state === "INCLUDED_IN_ENERGY_PRICE") return "RESOLVED_INCLUDED";
  if (state === "NOT_APPLICABLE") return "RESOLVED_NOT_APPLICABLE";
  if (state === "EXTERNAL_PASS_THROUGH") return "UNRESOLVED_EXTERNAL";
  return "UNRESOLVED_NOT_DECLARED";
}
function statusFor(kind: CtePassThroughKind, state: ContractualPassThroughState, effectiveFrom: string, effectiveTo: string): ContractualPassThroughStatus { return { kind, state, effectiveFrom, effectiveTo }; }

export interface ContractualPassThroughEvaluation {
  readonly completeness: "COMPLETE" | "PARTIAL";
  readonly states: readonly ContractualPassThroughStatus[];
}

export function evaluateContractualPassThrough(offer: Pick<CalculationReadyOffer, "passThroughComponents">, period: SimulationPeriod): ContractualPassThroughEvaluation {
  const components = [...(offer.passThroughComponents ?? [])];
  const kinds: CtePassThroughKind[] = [...CONTRACTUAL_REQUIRED_KINDS, ...new Set(components.map((component) => component.kind).filter((kind) => !CONTRACTUAL_REQUIRED_KINDS.some((required) => required === kind)))];
  const states: ContractualPassThroughStatus[] = [];
  for (const kind of kinds) {
    const relevant = components.filter((component) => component.kind === kind).sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
    let cursor = period.periodStart;
    for (const component of relevant) {
      if (component.effectiveTo <= period.periodStart || component.effectiveFrom >= period.periodEnd) continue;
      const effectiveFrom = component.effectiveFrom > period.periodStart ? component.effectiveFrom : period.periodStart;
      const effectiveTo = component.effectiveTo < period.periodEnd ? component.effectiveTo : period.periodEnd;
      if (effectiveFrom > cursor) states.push(statusFor(kind, "UNRESOLVED_NOT_DECLARED", cursor, effectiveFrom));
      if (effectiveTo > cursor) {
        states.push(statusFor(kind, contractualStateOf(component.declarationState), effectiveFrom, effectiveTo));
        cursor = effectiveTo;
      }
    }
    if (cursor < period.periodEnd) states.push(statusFor(kind, "UNRESOLVED_NOT_DECLARED", cursor, period.periodEnd));
  }
  const complete = states.length > 0 && states.every((state) => state.state !== "UNRESOLVED_NOT_DECLARED" && state.state !== "UNRESOLVED_EXTERNAL");
  return { completeness: complete ? "COMPLETE" : "PARTIAL", states };
}

function monthAligned(value: string): boolean { return /^\d{4}-\d{2}-01$/.test(value); }
function passThroughQuantity(request: ElectricitySimulationRequest, component: CtePassThroughComponent, effectiveFrom: string, effectiveTo: string, totalQuantity: Rational): Rational {
  if (!monthAligned(request.supplyPeriod.periodStart) || !monthAligned(request.supplyPeriod.periodEnd) || !monthAligned(effectiveFrom) || !monthAligned(effectiveTo)) fail("CONTRACTUAL_PASS_THROUGH_PERIOD_UNSUPPORTED");
  if (component.effectiveFrom <= request.supplyPeriod.periodStart && component.effectiveTo >= request.supplyPeriod.periodEnd) return totalQuantity;
  return monthsInSimulationPeriod({ periodStart: effectiveFrom, periodEnd: effectiveTo }).reduce((total, month) => {
    const item = request.consumption.monthlyProfile?.find((candidate) => candidate.month === month);
    if (!item) return fail("CONTRACTUAL_PASS_THROUGH_PROFILE_REQUIRED");
    const { f1, f2, f3 } = item;
    return add(total, add(add(fromNumber(f1), fromNumber(f2)), fromNumber(f3)));
  }, fromNumber(0));
}
function contractualComponentId(offer: CalculationReadyOffer, component: CtePassThroughComponent, effectiveFrom: string, effectiveTo: string): string { return `contractual-pass-through:${offer.sourceCteId}:${offer.sourceCteVersion}:${component.componentId}:${effectiveFrom}:${effectiveTo}`; }
function addPassThroughComponents(target: ComponentDraft[], offer: CalculationReadyOffer, request: SimulationRequest, totalQuantity: Rational): void {
  if (request.vector !== "EE" || !offer.passThroughComponents) return;
  const period = request.supplyPeriod;
  for (const component of offer.passThroughComponents) {
    const effectiveFrom = component.effectiveFrom > period.periodStart ? component.effectiveFrom : period.periodStart;
    const effectiveTo = component.effectiveTo < period.periodEnd ? component.effectiveTo : period.periodEnd;
    if (effectiveFrom >= effectiveTo || component.declarationState !== "EXPLICIT_COMPONENT") continue;
    const fee = component.fee;
    if (fee.unit === "EUR_PER_KWH") {
      const quantity = passThroughQuantity(request, component, effectiveFrom, effectiveTo, totalQuantity);
      target.push({ componentId: contractualComponentId(offer, component, effectiveFrom, effectiveTo), category: "VARIABLE_FEE", label: `Pass-through contrattuale ${component.kind}`, sign: "CHARGE", value: multiply(fromNumber(fee.amount), quantity), formulaId: "CONTRACTUAL_PASS_THROUGH_ENERGY_RATE_TIMES_KWH", formulaInputs: { sourceCteId: offer.sourceCteId, sourceCteVersion: offer.sourceCteVersion, passThroughComponentId: component.componentId, kind: component.kind, declarationState: component.declarationState, effectiveFrom, effectiveTo, feeUnit: fee.unit, feeRate: fee.amount, basisQuantity: toDecimal(quantity, 6), taxTreatment: fee.taxTreatment } });
    } else if (fee.unit === "EUR_PER_MONTH") {
      if (!monthAligned(effectiveFrom) || !monthAligned(effectiveTo) || !monthAligned(period.periodStart) || !monthAligned(period.periodEnd)) fail("CONTRACTUAL_PASS_THROUGH_PERIOD_UNSUPPORTED");
      const applicableMonths = monthsInSimulationPeriod({ periodStart: effectiveFrom, periodEnd: effectiveTo });
      target.push({ componentId: contractualComponentId(offer, component, effectiveFrom, effectiveTo), category: "VARIABLE_FEE", label: `Pass-through contrattuale ${component.kind}`, sign: "CHARGE", value: multiply(fromNumber(fee.amount), fromNumber(applicableMonths.length)), formulaId: "CONTRACTUAL_PASS_THROUGH_MONTHLY_RATE_TIMES_MONTHS", formulaInputs: { sourceCteId: offer.sourceCteId, sourceCteVersion: offer.sourceCteVersion, passThroughComponentId: component.componentId, kind: component.kind, declarationState: component.declarationState, effectiveFrom, effectiveTo, feeUnit: fee.unit, feeRate: fee.amount, basisMonths: applicableMonths.length, taxTreatment: fee.taxTreatment } });
    }
  }
}

// Quote on a competitor bill (Tony, 26/10: "sulla CTE mancano tutti i costi"): the CTE's dispatching, capacity market and
// network losses are part of what the customer would pay, so they are priced with the official value of the period when
// resolved, else with the value the CTE states ("attualmente pari a ..."). A charge the CTE does not state stays out.
// Network losses are always billed (Tony, 26/10: "le perdite di rete sono sempre presenti"): under the TIS the energy
// withdrawn at a point grow by the standard factor of TIS Tabella 4 colonna A, so when no official record is resolved the
// table value for the supply's voltage applies (delibera 117/2022/R/eel from 1/1/2023, confirmed by 584/2023/R/eel).
const TIS_TABLE_4_COLUMN_A: Readonly<Record<ElectricitySimulationRequest["voltageLevel"], number>> = { LV: 0.1, MV: 0.038, HV: 0.018, EHV: 0.007 };
function lossRatio(value: ResolvedOfficialRuntimeValue | null | undefined): Rational | null {
  if (!value || !Number.isFinite(value.value) || value.value <= 0) return null;
  const ratio = /percent|%/i.test(value.unit) || value.value > 1 ? value.value / 100 : value.value;
  return ratio > 0 && ratio < 0.5 ? fromNumber(ratio) : null;
}
function standardLoss(request: ElectricitySimulationRequest, runtime: CteRuntimeResolution | null): { readonly ratio: Rational; readonly source: string } | null {
  const official = lossRatio(runtime?.loss);
  if (official) return { ratio: official, source: runtime?.loss?.officialIdentifier ?? "OFFICIAL" };
  if (request.supplyPeriod.periodStart < "2023-01-01") return null;
  return { ratio: fromNumber(TIS_TABLE_4_COLUMN_A[request.voltageLevel]), source: "TIS_TABELLA_4_COLONNA_A" };
}
function addCtePassThroughs(target: ComponentDraft[], request: ElectricitySimulationRequest, offer: CalculationReadyOffer, runtime: CteRuntimeResolution | null, totalQuantity: Rational, context: ElectricitySupplyContext | undefined, missing: string[], capacityMonths: readonly AreraCapacityMonth[] = ARERA_TIV_CAPACITY_MONTHS, tideQuarters: readonly TernaTideQuarter[] = TERNA_TIDE_DISPATCHING_QUARTERS, domesticCdispd: "PRICED" | "MISSING" | null = null, cdispdMonths: readonly AreraCapacityMonth[] | null = null): void {
  const priced = new Set(target.filter((draft) => draft.formulaId.startsWith("CONTRACTUAL_PASS_THROUGH")).map((draft) => String(draft.formulaInputs.kind ?? "")));
  const standard = standardLoss(request, runtime);
  const loss = standard?.ratio ?? null;
  const targets = new Set(offer.lossReference?.applicationTargets ?? []);
  const grossUp = (rate: Rational) => loss ? multiply(rate, add(fromNumber(1), loss)) : rate;
  // Losses on energy: the energy price (index and spread, or the fixed price) applied to the energy lost on the networks.
  // Only a CTE that names the index alone as grossed up keeps the spread out of the base.
  if (loss && standard && !priced.has("LOSSES")) {
    // A spread stated gross of losses already contains them (Tony, 28/10, BE Family Casa Protetta).
    // Households from 1 April 2026 (delibera 386/2025/R/com, Codice di condotta commerciale art. 5.1.a): the seller's
    // charges are stated "al lordo delle perdite di rete" and the index carries one spread covering every cost outside it,
    // sbilanciamento and commercializzazione included (Tony, 29/10). Losses apply to the index only, whatever the reading.
    const householdCode = context?.regulatoryCustomerScope?.startsWith("DOMESTIC") === true && request.supplyPeriod.periodStart.slice(0, 10) >= "2026-04-01";
    const spreadGross = offer.pricing.mode === "INDEXED" && (offer.pricing.spread.lossTreatment === "GROSS_OF_LOSSES" || householdCode);
    const indexOnly = (targets.has("ENERGY_INDEX") && !targets.has("SPREAD")) || spreadGross;
    const energy = target.filter((draft) => draft.category === "ENERGY" && ["EE_PUN_MWH_TO_KWH_PLUS_SPREAD", "EE_FIXED_PRICE_TIMES_KWH", "EE_SPREAD_TIMES_KWH"].includes(draft.formulaId));
    const base = energy.reduce((total, draft) => {
      if (!indexOnly) return add(total, draft.value);
      if (draft.formulaId !== "EE_PUN_MWH_TO_KWH_PLUS_SPREAD") return draft.formulaId === "EE_SPREAD_TIMES_KWH" ? total : add(total, draft.value);
      return add(total, multiply(divide(fromNumber(Number(draft.formulaInputs.punEurPerMwh ?? 0)), fromNumber(1000)), fromNumber(Number(draft.formulaInputs.quantityKwh ?? 0))));
    }, fromNumber(0));
    if (energy.length) target.push({ componentId: "cte-pass-through:losses", category: "VARIABLE_FEE", label: "Perdite di rete", sign: "CHARGE", value: multiply(base, loss), formulaId: "CTE_PASS_THROUGH_LOSSES_ON_ENERGY", formulaInputs: { kind: "LOSSES", lossFactor: toDecimal(loss, 6), base: toDecimal(base, 6), spreadIncluded: !indexOnly, source: standard.source } });
  }
  // Tony (29/10, BPower BE SPECIAL 26, imbalance billed on 3.970 x 1,10 kWh): "solo se la CTE lo dice". Imbalance and
  // per-kWh commercialization fees apply to the kWh with losses only when the CTE names them among the loss targets.
  if (loss) for (let index = 0; index < target.length; index += 1) {
    const draft = target[index];
    const imbalance = draft.category === "IMBALANCE" && targets.has("IMBALANCE");
    const commercialization = draft.category === "VARIABLE_FEE" && draft.formulaId === "FEE_RATE_TIMES_BASIS" && draft.formulaInputs.feeUnit === "EUR_PER_KWH" && /commercializ/i.test(`${draft.label} ${String(draft.formulaInputs.feeId ?? "")}`) && targets.has("COMMERCIALIZATION_FEE");
    if (imbalance || commercialization) target[index] = { ...draft, value: grossUp(draft.value), formulaInputs: { ...draft.formulaInputs, lossFactor: toDecimal(loss, 6) } };
  }
  // Base di calcolo approvata da Tony (26/10): dispacciamento (TIDE) e mercato della capacità si prendono solo dai valori
  // ufficiali ARERA/Terna del periodo; il valore che la CTE scrive ("attualmente pari a") serve solo da controllo. Senza
  // valore ufficiale la voce non si stima: il motivo va nei warnings e lo scontrino lo mostra.
  const dispatching = offer.dispatchingReference;
  // Tony (28/10, BPower Be FIX RELAX): the archived CTE says nothing on dispatching and capacity, yet the bill charges them.
  // They are regulated charges every free-market customer pays (TIS art. 24, TIV 34.8 bis): unless the CTE includes them in
  // the energy price or excludes them, the official value applies.
  const statedAway = (kind: "DISPATCHING" | "CAPACITY_MARKET") => (offer.passThroughComponents ?? []).some((item) => item.kind === kind && (item.declarationState === "INCLUDED_IN_ENERGY_PRICE" || item.declarationState === "NOT_APPLICABLE"));
  // Households on the free market pay one CDISPD per kWh, published monthly by ARERA, which already includes the capacity
  // charge (TIV comma 48.9: "ricomprende anche i valori del corrispettivo mercato capacità", 338/2026/R/eel). The ARERA
  // tables price it with transport and oneri; here it is neither added again nor joined by a separate capacity line.
  const domestic = context?.regulatoryCustomerScope?.startsWith("DOMESTIC") === true;
  const inCdispd = domestic && (domesticCdispd !== null || cdispdMonths !== null);
  if (inCdispd && domesticCdispd === "MISSING" && !priced.has("DISPATCHING")) missing.push("DISPATCHING:CDISPD_MISSING");
  // Tony (29/10, bolletta Casa Protetta domestico non residente: "come fa a costare meno la proposta se ha una cte con spread
  // superiore alla fattura?"): the bill charges "Dispacciamento: 0,015068 €/kWh", the simulation charged none and a separate
  // capacity line instead. CDISPD is one value for every household, resident or not (the ARERA workbook prints both and the
  // import checks they are equal), so it is priced here when the ARERA tables of the scope do not price it.
  if (domestic && cdispdMonths !== null && !priced.has("DISPATCHING")) {
    const cdispd = areraCapacityForPeriod(request.supplyPeriod.periodStart, request.supplyPeriod.periodEnd, cdispdMonths);
    if (cdispd) {
      const unitRate = fromNumber(cdispd.eurPerKwh);
      target.push({ componentId: "cte-pass-through:domestic-cdispd", category: "VARIABLE_FEE", label: "Dispacciamento e mercato della capacità (CDISPD)", sign: "CHARGE", value: multiply(unitRate, totalQuantity), formulaId: "CTE_PASS_THROUGH_RATE_TIMES_KWH", formulaInputs: { kind: "DISPATCHING", feeUnit: "EUR_PER_KWH", feeRate: toDecimal(unitRate, 6), officialRate: cdispd.eurPerKwh, lossFactor: 0, basisQuantity: toDecimal(totalQuantity, 3), source: cdispd.months.map((month) => month.resolution).join(", ") } });
    } else missing.push("DISPATCHING:CDISPD_MISSING");
  }
  if (!inCdispd && (dispatching || !statedAway("DISPATCHING")) && !priced.has("DISPATCHING")) {
    // Customers other than households: Terna's quarterly TIDE dispatching charge, when the archive resolves none.
    const terna = runtime?.dispatching?.value === undefined && !domestic ? ternaTideForPeriod(request.supplyPeriod.periodStart, request.supplyPeriod.periodEnd, tideQuarters) : null;
    const official = runtime?.dispatching?.value ?? terna?.eurPerKwh;
    if (official !== undefined && Number.isFinite(official) && official > 0) {
      // TIDE charges apply to the energy withdrawn plus losses (TIS Tabella 4).
      const unitRate = grossUp(fromNumber(official));
      target.push({ componentId: "cte-pass-through:dispatching", category: "VARIABLE_FEE", label: "Dispacciamento", sign: "CHARGE", value: multiply(unitRate, totalQuantity), formulaId: "CTE_PASS_THROUGH_RATE_TIMES_KWH", formulaInputs: { kind: "DISPATCHING", feeUnit: "EUR_PER_KWH", feeRate: toDecimal(unitRate, 6), officialRate: official, lossFactor: loss ? toDecimal(loss, 6) : 0, basisQuantity: toDecimal(totalQuantity, 3), source: runtime?.dispatching?.officialIdentifier ?? (terna ? terna.quarters.map((item) => item.reference).join(", ") : "OFFICIAL") } });
    } else missing.push("DISPATCHING:OFFICIAL_VALUE_MISSING");
  }
  if (!priced.has("CAPACITY_MARKET")) {
    const period = request.supplyPeriod;
    const entries = (offer.capacityMarketSchedule ?? []).filter((entry) => entry.effectiveFrom < period.periodEnd && entry.effectiveTo > period.periodStart);
    // Charges the CTE fixes itself (Capacity Market libero): the CTE's value, grossed up when "al lordo delle perdite".
    entries.filter((entry) => entry.mode === "FIXED_VALUE").forEach((entry, index) => {
      if (!Number.isFinite(entry.value) || entry.value <= 0) return;
      const unitRate = entry.lossTreatment === "GROSS_OF_LOSSES" ? grossUp(fromNumber(entry.value)) : fromNumber(entry.value);
      target.push({ componentId: `cte-pass-through:capacity-cte:${index}`, category: "VARIABLE_FEE", label: "Capacity market libero (da CTE)", sign: "CHARGE", value: multiply(unitRate, totalQuantity), formulaId: "CTE_PASS_THROUGH_RATE_TIMES_KWH", formulaInputs: { kind: "CAPACITY_MARKET", feeUnit: "EUR_PER_KWH", feeRate: toDecimal(unitRate, 6), basisQuantity: toDecimal(totalQuantity, 3), source: "CTE_STATED_VALUE" } });
    });
    // The regulated capacity charge (TIV comma 34.8 bis, Terna): published net of losses, so always grossed up. BT up to
    // 55 kW: one monthly value on all kWh. BT above 55 kW, MT, AT: kWh in Terna's 500 peak hours x peak rate + the rest x
    // off-peak rate, which needs the peak-hour kWh of the meter.
    // Households: inside CDISPD, see above.
    if (!inCdispd && !entries.some((entry) => entry.mode === "OFFICIAL_PASS_THROUGH") && (entries.length > 0 || statedAway("CAPACITY_MARKET"))) missing.push("CAPACITY_MARKET:CTE_REFERENCE_MISSING");
    else if (!inCdispd) {
      const powerKw = context?.availablePowerKw ?? context?.contractedPowerKw;
      const smallLv = request.voltageLevel === "LV" && powerKw !== undefined && powerKw <= 55;
      // BT up to 55 kW: the monthly value ARERA fixes in the quarterly TIV update (art. 4.1), when the archive has none.
      const arera = smallLv && runtime?.capacityMarket?.value === undefined ? areraCapacityForPeriod(period.periodStart, period.periodEnd, capacityMonths) : null;
      const official = runtime?.capacityMarket?.value ?? arera?.eurPerKwh;
      const officialSource = runtime?.capacityMarket?.officialIdentifier ?? (arera ? `ARERA ${arera.months.map((month) => month.resolution).join(", ")}` : "OFFICIAL");
      if (request.voltageLevel === "LV" && powerKw === undefined) missing.push("CAPACITY_MARKET:AVAILABLE_POWER_MISSING");
      else if (!smallLv) missing.push("CAPACITY_MARKET:PEAK_HOUR_KWH_MISSING");
      else if (official === undefined || !Number.isFinite(official) || official <= 0) missing.push("CAPACITY_MARKET:OFFICIAL_VALUE_MISSING");
      else {
        const unitRate = grossUp(fromNumber(official));
        target.push({ componentId: "cte-pass-through:capacity", category: "VARIABLE_FEE", label: "Mercato della capacità", sign: "CHARGE", value: multiply(unitRate, totalQuantity), formulaId: "CTE_PASS_THROUGH_RATE_TIMES_KWH", formulaInputs: { kind: "CAPACITY_MARKET", feeUnit: "EUR_PER_KWH", feeRate: toDecimal(unitRate, 6), officialRate: official, lossFactor: loss ? toDecimal(loss, 6) : 0, basisQuantity: toDecimal(totalQuantity, 3), source: officialSource } });
      }
    }
  }
  if (!loss) missing.push("LOSSES:OFFICIAL_VALUE_MISSING");
}

function isBta6CompleteCandidate(context: ElectricitySupplyContext | undefined, regulated: Awaited<ReturnType<typeof calculateRegulatedEeSubset>> | null, contractual: ContractualPassThroughEvaluation | null, request: SimulationRequest): boolean {
  return request.vector === "EE" && request.taxTreatment === "EXCLUDED" && context?.regulatoryCustomerScope === "NON_DOMESTIC_BT_BTA6" && context.asosClassTemporalStatus === "VALID" && context.asosClass !== "UNKNOWN" && contractual?.completeness === "COMPLETE" && regulated !== null && [...regulated.includedComponents].sort().join("|") === [...BTA6_REGULATED_COMPONENTS_INCLUDED].sort().join("|");
}

export interface CalculationDependencies {
  readonly trustedElectricityContext?: ElectricitySupplyContext;
  readonly regulatoryBridge?: Pick<ProductionRegulatoryPersistenceBridge, "list">;
  readonly regulatoryRefreshState?: Pick<TenantRecordRepository<unknown>, "get">;
  readonly regulatoryRuntimeResolver?: CteRegulatoryRuntimeResolver;
  /** Commercial chain gate: when present, only CTEs it accepts take part in a comparison. */
  readonly cteUsable?: (archiveId: string) => boolean;
  /** Why the bill's technical readings could not be trusted, so a quote without ARERA charges can say so. */
  readonly regulatedUnavailableReason?: string;
  /** The supplier and offer of the source bill, and whether it charges a one-off fee. */
  readonly currentOffer?: CurrentSupplyOffer;
  /** CTEs (archive or CTE id) authorized for the source bill although the customer or voltage rules leave them out. */
  readonly eligibilityOverriddenCteIds?: ReadonlySet<string>;
}

export interface CurrentSupplyOffer { readonly supplier: string | null; readonly offer: string | null; readonly oneOffBilled: boolean; readonly indexStructure?: "MONO" | "BANDS" | "HOURLY" | null }

export async function assertNoKnownDomesticTierDivergence(repository: Pick<TenantRecordRepository<unknown>, "get"> | undefined, tenantId: string): Promise<void> {
  if (!repository) return;
  const stored = await repository.get(tenantId, deterministicRecordId("regulatory-refresh-state", tenantId, "regulatory-refresh"));
  const payload = stored?.payload;
  const errors = payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray((payload as { readonly errors?: unknown }).errors) ? (payload as { readonly errors: readonly unknown[] }).errors : [];
  if (errors.some((error) => typeof error === "string" && error.includes("DOMESTIC_TIER_RATE_DIVERGENCE_UNSUPPORTED"))) throw new CalculationEngineError("DOMESTIC_TIER_RATE_DIVERGENCE_UNSUPPORTED");
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
    ...(offer.passThroughComponents ?? []).flatMap((component) => component.declarationState === "EXPLICIT_COMPONENT" ? [component.fee] : []),
  ].map((component) => component.taxTreatment);
  const pricingTaxTreatments = offer.pricing.mode === "FIXED"
    ? [offer.pricing.fixedPrice.taxTreatment, ...(offer.pricing.spread.status === "DECLARED" ? [offer.pricing.spread.component.taxTreatment] : [])]
    : [offer.pricing.spread.taxTreatment];
  if ([...componentTaxTreatments, ...pricingTaxTreatments].some((treatment) => treatment !== request.taxTreatment)) fail("TAX_TREATMENT_INCOMPATIBLE");
}

function addElectricityEnergy(target: ComponentDraft[], request: ElectricitySimulationRequest, offer: CalculationReadyOffer, markets: readonly MarketArchiveRecord[], monthlyIndex = false): void {
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
    // Monorario (PUN mensile): the month's single GME PUN on all the kWh, as the bill applies it (Tony, 29/10: same CTE, same bill).
    const monthly = electricityRecord.monthly;
    if (monthlyIndex && monthly) {
      const quantity = values[0] + values[1] + values[2];
      target.push({ componentId: `energy:${market.month}:f0`, category: "ENERGY", label: `Energia EE indicizzata monoraria ${market.month}`, sign: "CHARGE", value: multiply(add(divide(fromNumber(monthly.value), fromNumber(1000)), fromNumber(pricing.spread.amount)), fromNumber(quantity)), formulaId: "EE_PUN_MWH_TO_KWH_PLUS_SPREAD", formulaInputs: { month: market.month, band: "F0", quantityKwh: quantity, punEurPerMwh: monthly.value, mwhToKwh: 1000, spreadPerKwh: pricing.spread.amount, marketRecordId: marketRecord.recordId, marketVersion: marketRecord.version, taxTreatment: pricing.spread.taxTreatment } });
      return;
    }
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

export async function prepareApprovedOffer(cteRepository: CteArchiveRepository, marketRepository: MarketArchiveRepository, request: SimulationRequest, archiveId: string, overridden?: ReadonlySet<string>): Promise<EligibleOffer> {
  assertEeNetTaxPolicy(request);
  const record = await cteRepository.get(request.tenantId, archiveId);
  if (record === null) return fail("CTE_NOT_FOUND");
  if (record.vector !== request.vector) fail("VECTOR_MISMATCH");
  const version = readyVersion(record);
  const offer: CalculationReadyOffer = (() => { try { const result = toCalculationReadyOffer(version.contract); assertCalculationReadyFees([...result.fixedFees, ...result.variableFees, ...result.oneOffFees, ...(result.imbalance.status === "DECLARED" ? [result.imbalance.component] : []), ...result.commercialDiscounts, ...(result.passThroughComponents ?? []).flatMap((component) => component.declarationState === "EXPLICIT_COMPONENT" ? [component.fee] : [])]); return result; } catch { return fail("CALCULATION_READY_INVALID"); } })();
  assertPriceCurrency(offer, request);
  return prepareAdjustedOffer(record, version, offer, request, marketRepository, overridden?.has(record.archiveId) === true || overridden?.has(record.cteId) === true);
}

async function prepareAdjustedOffer(record: CteArchiveRecord, version: CteArchiveVersion, baseOffer: CalculationReadyOffer, request: SimulationRequest, marketRepository: MarketArchiveRepository, authorized = false): Promise<EligibleOffer> {
  // Company correttivi are part of the offer the customer is quoted, in every calculation path.
  const offer = applyCommercialAdjustment(baseOffer, record.commercialAdjustment);
  // The bill period is only the consumption basis: the offer must be subscribable on the calculation date.
  if (request.calculationDate < offer.validity.periodStart || request.calculationDate >= offer.validity.periodEnd) fail("CTE_VALIDITY_MISMATCH");
  if (offer.expiry.status === "EXPIRES_ON" && offer.expiry.date <= request.calculationDate) fail("CTE_EXPIRED");
  if (!offer.vector || offer.vector !== request.vector) fail("VECTOR_MISMATCH");
  if (!offer.vector || !record.versions.some((candidate) => candidate.versionId === version.versionId && candidate.status === "APPROVED")) fail("CTE_NOT_APPROVED");
  const contract = version.contract;
  // A CTE authorized for this bill (Tony 29/10) is calculated although its customer or voltage rule leaves the bill out.
  if (!authorized && !contract.eligibility.customerTypes.includes(request.customerCategory)) fail("CUSTOMER_NOT_ELIGIBLE");
  if (!authorized && request.vector === "EE" && contract.vector === "EE" && !contract.eligibility.voltageLevels.includes(request.voltageLevel)) fail("VOLTAGE_NOT_ELIGIBLE");
  if (offer.commercialDiscounts.some((fee) => fee.unit === "EUR_PER_SMC" && request.vector === "EE" || fee.unit === "EUR_PER_KWH" && request.vector === "GAS")) fail("FEE_UNIT_MISMATCH");
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
  assertEeNetTaxPolicy(request);
  let cteRuntime: CteRuntimeResolution | null = null;
  if (request.vector === "EE" && (prepared.offer.dispatchingReference !== undefined || prepared.offer.lossReference !== undefined || (prepared.offer.capacityMarketSchedule ?? []).some((entry) => entry.mode === "OFFICIAL_PASS_THROUGH"))) {
    // The CTE's official pass-through values (capacity, dispatching, losses): on a competitor bill they are priced below
    // (official value when resolved, else the value the CTE states), and a missing official value no longer drops the offer.
    try {
      cteRuntime = await resolveCteRegulatoryRuntime(prepared.version.contract, { tenantId: request.tenantId, effectiveAt: request.calculationDate, customerScope: dependencies.trustedElectricityContext?.regulatoryCustomerScope ?? "ALL_ELECTRICITY", voltageLevel: request.voltageLevel }, dependencies.regulatoryRuntimeResolver);
    } catch (error) {
      if (!request.sourceBill) throw error;
      cteRuntime = null;
    }
    if (cteRuntime && !cteRuntime.ready && !request.sourceBill) throw new CalculationEngineError(cteRuntime.blockers[0] ?? "REGULATORY_RUNTIME_VALUE_MISSING");
  }
  let regulated: Awaited<ReturnType<typeof calculateRegulatedEeSubset>> | null = null;
  let regulatedMissingReason = dependencies.regulatedUnavailableReason ?? "CONTEXT_MISSING";
  // A competitor bill without its technical readings (supply use, BTA6 power basis) is quoted on commercial costs only.
  if (request.vector === "EE" && request.sourceBill && dependencies.trustedElectricityContext) {
    const trustedElectricityContext = dependencies.trustedElectricityContext;
    const regulatoryBridge = dependencies.regulatoryBridge;
    if (!regulatoryBridge) throw new CalculationEngineError("REGULATORY_BRIDGE_REQUIRED");
    await assertNoKnownDomesticTierDivergence(dependencies.regulatoryRefreshState, request.tenantId);
    const execution: RegulatedEeExecutionContext = { trustedElectricityContext, regulatoryBridge };
    try {
      regulated = await calculateRegulatedEeSubset(request, execution);
    } catch (error) {
      // Customer scopes without official regulated tariffs on file (e.g. business BT other than BTA6) are quoted on commercial costs only.
      // Tony (27/10): a missing ARERA value never blocks the quote; the receipt says which table is missing.
      if (!(error instanceof Error) || !/^REGULATORY_(REFRESH_DOMAIN_UNREGISTERED|TIMELINE_GAP|TIMELINE_OVERLAP|TIMELINE_VARIANT_REQUIRED)/.test(error.message)) throw error;
      regulated = null;
      const scope = dependencies.trustedElectricityContext.regulatoryCustomerScope;
      regulatedMissingReason = error.message.startsWith("REGULATORY_REFRESH_DOMAIN_UNREGISTERED") ? `SCOPE_UNREGISTERED_${scope}` : error.message.startsWith("REGULATORY_TIMELINE_VARIANT_REQUIRED") ? `ASOS_CLASS_UNKNOWN_${scope}` : `${error.message.startsWith("REGULATORY_TIMELINE_OVERLAP") ? "TIMELINE_OVERLAP" : "TIMELINE_GAP"}_${error.message.split(":")[1] ?? "ARERA"}_${scope}`;
    }
  }
  const drafts: ComponentDraft[] = [];
  const totalQuantity = request.vector === "EE" ? add(add(fromNumber(request.consumption.f1), fromNumber(request.consumption.f2)), fromNumber(request.consumption.f3)) : multiply(fromNumber(request.consumption.smc), request.consumption.correctionCoefficient.value === undefined ? fromNumber(1) : fromNumber(request.consumption.correctionCoefficient.value));
  const months = monthCount(request);
  // The bill priced with this same CTE says how the index runs over time: a monorario bill takes the monthly PUN.
  const sameAsBill = dependencies.currentOffer !== undefined && isSameOffer({ billSupplier: dependencies.currentOffer.supplier, billOffer: dependencies.currentOffer.offer, offerSupplier: prepared.version.contract.supplier.name, offerCode: prepared.version.contract.offer.code, offerName: prepared.version.contract.offer.name });
  if (request.vector === "EE") addElectricityEnergy(drafts, request, prepared.offer, prepared.markets, sameAsBill && dependencies.currentOffer?.indexStructure === "MONO"); else addGasEnergy(drafts, request, prepared.offer, prepared.markets);
  addFeeComponents(drafts, prepared.offer.fixedFees, "FIXED_FEE", request, totalQuantity, months);
  // Tony (28/10, BPower BE Family Casa Protetta): "PUN Index GME + 0,03 €/kWh" was read as the spread and again as a
  // generic per-kWh fee ("Quote variabili 0,0300"). A per-kWh fee equal to the indexed spread, with no name of its own, is
  // that spread repeated.
  const indexedSpread = prepared.offer.pricing.mode === "INDEXED" ? prepared.offer.pricing.spread.amount : null;
  const repeatsSpread = (fee: CalculationReadyOffer["variableFees"][number]) => indexedSpread !== null && fee.unit === "EUR_PER_KWH" && Math.abs(fee.amount - indexedSpread) < 1e-9 && !/commercializ|sbilanc|dispacc|capacit|perdit|gestion|servizi|verde|green/i.test(fee.label);
  // Tony (29/10): "lo spread 0,03 è comprensivo di quello che prevede la norma". A household offer from 1 April 2026 has one
  // spread covering every cost outside the index, sbilanciamento and commercializzazione included (delibera 386/2025/R/com):
  // a per-kWh imbalance or commercialization charge read apart from it is the spread again, never a second charge.
  const householdSpreadOnly = request.vector === "EE" && indexedSpread !== null && dependencies.trustedElectricityContext?.regulatoryCustomerScope?.startsWith("DOMESTIC") === true && request.supplyPeriod.periodStart.slice(0, 10) >= "2026-04-01";
  const insideSpread = (fee: CalculationReadyOffer["variableFees"][number]) => householdSpreadOnly && fee.unit === "EUR_PER_KWH" && /commercializ|sbilanc/i.test(`${fee.label ?? ""} ${fee.feeId ?? ""}`);
  addFeeComponents(drafts, prepared.offer.variableFees.filter((fee) => !repeatsSpread(fee) && !insideSpread(fee)), "VARIABLE_FEE", request, totalQuantity, months);
  if (!householdSpreadOnly) addDeclaredComponent(drafts, prepared.offer.imbalance, "IMBALANCE", request, totalQuantity, months);
  // Tony (28/10): "certamente il contributo una tantum solo sulla prima bolletta". A bill already issued with this CTE that
  // does not charge it is not the first one, so its simulation leaves the one-off fees out.
  const current = dependencies.currentOffer;
  const laterBill = current !== undefined && !current.oneOffBilled && isSameOffer({ billSupplier: current.supplier, billOffer: current.offer, offerSupplier: prepared.version.contract.supplier.name, offerCode: prepared.version.contract.offer.code, offerName: prepared.version.contract.offer.name });
  if (!laterBill) addOneOffComponents(drafts, prepared.offer.oneOffFees);
  addFeeComponents(drafts, prepared.offer.commercialDiscounts, "DISCOUNT", request, totalQuantity, months);
  const bta6 = request.vector === "EE" && dependencies.trustedElectricityContext?.regulatoryCustomerScope === "NON_DOMESTIC_BT_BTA6";
  const contractual = bta6 ? evaluateContractualPassThrough(prepared.offer, request.supplyPeriod) : null;
  if (bta6) addPassThroughComponents(drafts, prepared.offer, request, totalQuantity);
  const missingOfficial: string[] = [];
  if (request.vector === "EE" && request.sourceBill) {
    // The monthly ARERA capacity charges the refresh stored, over the hand-checked table.
    const stored = dependencies.regulatoryBridge ? await dependencies.regulatoryBridge.list(request.tenantId, { componentCode: "CAPACITY_MARKET", customerScope: "ALL_ELECTRICITY", normalizedUnit: "EUR/KWH" }).catch(() => []) : [];
    const tide = dependencies.regulatoryBridge ? await dependencies.regulatoryBridge.list(request.tenantId, { componentCode: "DISPATCHING_TOTAL", regulatoryVariant: "TIDE" }).catch(() => []) : [];
    // Households other than residents: the month's CDISPD from the archive (one value for all households, TIV comma 48.9).
    const scope = dependencies.trustedElectricityContext?.regulatoryCustomerScope;
    const cdispdMonths = scope?.startsWith("DOMESTIC") && scope !== "DOMESTIC_RESIDENT_BT" && dependencies.regulatoryBridge
      ? [...await dependencies.regulatoryBridge.list(request.tenantId, { componentCode: "DISPATCHING_TOTAL", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/KWH" }).catch(() => [])]
        // Household dispatching is only CDISPD; the latest reading of a month wins.
        .sort((left, right) => left.retrievedAt.localeCompare(right.retrievedAt))
        .map((record) => ({ month: record.effectiveFrom.slice(0, 7), centsPerKwh: record.normalizedValue * 100, resolution: `ARERA CDISPD ${record.effectiveFrom.slice(0, 7)}`, url: record.sourceReference }))
        .filter((month, index, all) => all.findLastIndex((other) => other.month === month.month) === index)
      : null;
    addCtePassThroughs(drafts, request, prepared.offer, cteRuntime, totalQuantity, dependencies.trustedElectricityContext, missingOfficial, mergeAreraCapacityMonths(stored), mergeTernaTideQuarters(tide), regulated === null || scope !== "DOMESTIC_RESIDENT_BT" ? null : regulated.dispatchingMissing ? "MISSING" : "PRICED", cdispdMonths);
  }
  // Tony: transport and system charges always come from the ARERA tables; when they can't, the receipt says why.
  if (request.vector === "EE" && request.sourceBill && regulated === null) missingOfficial.push(`REGULATED:${regulatedMissingReason}`);
  const commercialComponents = convertDrafts(drafts);
  const regulatedComponents = regulated?.components ?? [];
  const components = [...commercialComponents, ...regulatedComponents];
  const totalCommercial = totalMinor(commercialComponents);
  const totalRegulated = regulated === null ? null : totalMinor(regulatedComponents);
  const totalPlusRegulated = totalRegulated === null ? null : totalCommercial + totalRegulated;
  if (totalQuantity.numerator <= BigInt(0)) fail("CALCULATION_ZERO_CONSUMPTION");
  const unit: "EUR_PER_KWH" | "EUR_PER_SMC" = request.vector === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC";
  const unitCost = { amount: toDecimal(divide(rational(BigInt(totalCommercial), BigInt(100)), totalQuantity), 6), unit, currency: "EUR" as const };
  const marketData = prepared.markets.map(referenceOf);
  const normalizedInput = request;
  const domesticComplete = request.vector === "EE" && dependencies.trustedElectricityContext?.regulatoryCustomerScope === "DOMESTIC_RESIDENT_BT" && regulated !== null && isDomesticNetOfTaxCompleteComponents(regulated.includedComponents);
  const bta6CompleteCandidate = isBta6CompleteCandidate(dependencies.trustedElectricityContext, regulated, contractual, request);
  const netOfTaxComplete = domesticComplete || bta6CompleteCandidate;
  const costScope = regulated === null ? "COMMERCIAL_ONLY" as const : netOfTaxComplete ? "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE" as const : "COMMERCIAL_PLUS_REGULATED_PARTIAL" as const;
  const baselineScope = request.baseline?.costScope ?? "COMMERCIAL_ONLY";
  const baselineComparable = request.baseline === undefined ? null : roundCents(fromNumber(baselineScope === "COMMERCIAL_ONLY" ? request.baseline.totalCommercialCost : request.baseline.comparisonCost ?? fail("CALCULATION_SAVINGS_INVALID")));
  const resultComparable = costScope === "COMMERCIAL_ONLY" ? totalCommercial : totalPlusRegulated ?? fail("CALCULATION_SAVINGS_INVALID");
  const comparableSavings = baselineComparable === null || baselineScope !== costScope ? null : money(baselineComparable - resultComparable);
  const contractualMetadata = contractual === null ? {} : { contractualPassThroughCompleteness: contractual.completeness, contractualPassThroughStates: contractual.states, bta6NetOfTaxCompleteCandidate: bta6CompleteCandidate };
  const payload = { schemaVersion: 1 as const, engineVersion: "1" as const, normalizedInput, sourceCte: { archiveId: prepared.record.archiveId, cteId: prepared.record.cteId, versionId: prepared.version.versionId, version: prepared.version.contract.version, supplier: prepared.version.contract.supplier.name, offerCode: prepared.offer.offerCode }, marketData, components, totalCommercialCost: money(totalCommercial), totalRegulatedSubsetCost: totalRegulated === null ? null : money(totalRegulated), totalCommercialPlusRegulatedSubsetCost: totalPlusRegulated === null ? null : money(totalPlusRegulated), costScope, regulatedComponentsIncluded: regulated === null ? [] : [...regulated.includedComponents], regulatoryData: { references: regulated?.references ?? [] }, unitCost, roundingPolicy: "ROUND_HALF_UP_TO_CENT_PER_COMPONENT" as const, ...contractualMetadata };
  const resultFingerprint = fingerprint(payload);
  return { ...payload, calculationId: `calc_${resultFingerprint.slice(0, 32)}`, fingerprint: resultFingerprint, calculatedAt: `${request.calculationDate}T00:00:00.000Z`, tenantId: request.tenantId, vector: request.vector, customerCategory: request.customerCategory, ...(request.vector === "EE" ? { voltageLevel: request.voltageLevel } : {}), calculationDate: request.calculationDate, supplyPeriod: request.supplyPeriod, currency: "EUR", taxTreatment: request.taxTreatment, savingsVsBaseline: comparableSavings, warnings: [...componentWarning(request), ...(regulated === null || netOfTaxComplete ? [] : [regulated.partialWarning]), ...(request.baseline !== undefined && baselineScope !== costScope ? ["BASELINE_COST_SCOPE_MISMATCH"] : []), ...missingOfficial.map((item) => `OFFICIAL_VALUE_MISSING:${item}`)] };
}

export async function calculateApprovedOffer(cteRepository: CteArchiveRepository, marketRepository: MarketArchiveRepository, request: SimulationRequest, archiveId: string, dependencies: CalculationDependencies = {}): Promise<CalculationResult> { const prepared = await prepareApprovedOffer(cteRepository, marketRepository, request, archiveId, dependencies.eligibilityOverriddenCteIds); return calculatePreparedOffer(request, prepared, dependencies); }

export function exclusionFor(record: CteArchiveRecord, code: CalculationExclusionCode, message: string): CalculationExclusion { const version = record.currentApprovedVersionId ? record.versions.find((candidate) => candidate.versionId === record.currentApprovedVersionId) : null; const contract = version?.contract ?? record.versions[0]?.contract; return { archiveId: record.archiveId, cteId: record.cteId, vector: record.vector, supplier: contract?.supplier.name ?? "", offerCode: contract?.offer.code ?? "", cteVersion: version?.contract.version ?? null, code, message }; }
