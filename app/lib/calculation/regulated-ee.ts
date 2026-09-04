import type { ElectricitySupplyContext } from "./trusted-ee-supply-context.ts";
import type { ElectricitySimulationRequest, CalculationComponent, RegulatoryDataReference, RegulatedComponentIncluded } from "./types.ts";
import type { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveRegulatoryTimeline, type RegulatoryTimeline, type RegulatoryTimelineSegment } from "./regulatory-timeline.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { add, divide, fromNumber, multiply, roundCents, toDecimal, type Rational } from "./decimal.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { monthsInSimulationPeriod } from "./input.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertCalculatedRegulatoryDomain, CALCULATED_REGULATORY_DOMAINS } from "../regulatory-refresh/registry.ts";

export const REGULATED_COMPONENTS_INCLUDED = ["UC3_ENERGY", "UC6_ENERGY", "UC6_POWER", "NETWORK_FIXED", "NETWORK_POWER", "TRANSMISSION_ENERGY"] as const;
export const REGULATED_SUBSET_PARTIAL_WARNING = "REGULATED_SUBSET_PARTIAL_NETWORK_UC3_UC6_ONLY" as const;
export const BTA6_REGULATED_COMPONENTS_INCLUDED = ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "METERING_FIXED", "TRANSMISSION_ENERGY", "UC3_ENERGY", "UC6_ENERGY", "UC6_FIXED"] as const;
export const BTA6_REGULATED_SUBSET_PARTIAL_WARNING = "REGULATED_SUBSET_PARTIAL_BTA6_NETWORK_METERING_TRANSMISSION_UC3_UC6_ONLY" as const;
export { CALCULATED_REGULATORY_DOMAINS };

export interface RegulatedEeExecutionContext {
  readonly trustedElectricityContext: ElectricitySupplyContext;
  readonly regulatoryBridge: Pick<ProductionRegulatoryPersistenceBridge, "list">;
}

export interface RegulatedEeCalculation {
  readonly components: readonly CalculationComponent[];
  readonly references: readonly RegulatoryDataReference[];
  readonly includedComponents: readonly RegulatedComponentIncluded[];
  readonly partialWarning: string;
}

const fail = (code: string): never => { throw new Error(code); };
const money = (minorUnits: number) => ({ amount: minorUnits / 100, minorUnits, currency: "EUR" as const });

function monthBoundary(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-01$/.test(date) || value !== `${date}T00:00:00.000Z`) return fail("REGULATORY_PRORATION_UNSUPPORTED");
  return date;
}

function assertMonthAligned(timeline: RegulatoryTimeline): void {
  timeline.segments.forEach((segment) => { monthBoundary(segment.segmentStart); monthBoundary(segment.segmentEnd); });
}

function quantityForSegment(request: ElectricitySimulationRequest, segment: RegulatoryTimelineSegment, segmentCount: number): Rational {
  if (segmentCount === 1) return add(add(fromNumber(request.consumption.f1), fromNumber(request.consumption.f2)), fromNumber(request.consumption.f3));
  const profile = request.consumption.monthlyProfile;
  if (!profile) return fail("REGULATORY_CONSUMPTION_ALLOCATION_REQUIRED");
  const months = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) });
  return months.reduce((total, month) => {
    const item = profile.find((candidate) => candidate.month === month);
    if (!item) return fail("REGULATORY_CONSUMPTION_ALLOCATION_REQUIRED");
    return add(total, add(add(fromNumber(item.f1), fromNumber(item.f2)), fromNumber(item.f3)));
  }, fromNumber(0));
}

function referenceOf(segment: RegulatoryTimelineSegment): RegulatoryDataReference {
  return {
    componentCode: segment.componentCode,
    customerScope: segment.customerScope,
    normalizedUnit: segment.normalizedUnit,
    normalizedValue: segment.normalizedValue,
    regulatoryRecordId: segment.regulatoryRecordId,
    checksum: segment.checksum,
    officialIdentifier: segment.officialIdentifier,
    sourceReference: segment.sourceReference,
    segmentStart: segment.segmentStart,
    segmentEnd: segment.segmentEnd,
    ...(segment.sourceSha256 === undefined ? {} : { sourceSha256: segment.sourceSha256 }),
    ...(segment.publicationDate === undefined ? {} : { publicationDate: segment.publicationDate }),
  };
}

function energyComponent(
  segment: RegulatoryTimelineSegment,
  quantity: Rational,
  componentId: string,
  label: string,
  formulaId: string,
): CalculationComponent {
  const value = multiply(fromNumber(segment.normalizedValue), quantity);
  return {
    componentId,
    category: "REGULATED_ENERGY",
    label,
    sign: "CHARGE",
    amount: money(roundCents(value)),
    formulaId,
    formulaInputs: {
      componentCode: segment.componentCode,
      rateEurPerKwh: segment.normalizedValue,
      quantityKwh: toDecimal(quantity, 6),
      customerScope: segment.customerScope,
      regulatoryRecordId: segment.regulatoryRecordId,
      regulatoryChecksum: segment.checksum,
      segmentStart: segment.segmentStart,
      segmentEnd: segment.segmentEnd,
    },
  };
}

function powerComponent(segment: RegulatoryTimelineSegment, context: ElectricitySupplyContext, componentId: string, monthsApplied: number, bta6: boolean, network = false): CalculationComponent {
  if (!Number.isSafeInteger(monthsApplied) || monthsApplied < 1) return fail("REGULATORY_PRORATION_UNSUPPORTED");
  const powerBasisKw = bta6 ? context.regulatoryPowerBasisKw : context.contractedPowerKw;
  const powerBasisKind = bta6 ? context.regulatoryPowerBasisKind : undefined;
  if (powerBasisKw === undefined || !Number.isFinite(powerBasisKw) || powerBasisKw <= 0 || (bta6 && !powerBasisKind)) return fail("REGULATORY_TRUST_CONTEXT_INVALID");
  const effectivePowerKw = powerBasisKw;
  const effectivePowerBasisKind = powerBasisKind as string | undefined;
  const value = multiply(multiply(fromNumber(segment.normalizedValue), fromNumber(effectivePowerKw)), divide(fromNumber(monthsApplied), fromNumber(12)));
  return {
    componentId,
    category: "REGULATED_POWER",
    label: bta6 ? "BTA6 quota potenza regolata" : network ? "Rete quota potenza regolata" : "UC6 potenza regolata",
    sign: "CHARGE",
    amount: money(roundCents(value)),
    formulaId: bta6 ? "REGULATED_BTA6_NETWORK_POWER_RATE_TIMES_ENGAGED_KW_TIME" : network ? "REGULATED_NETWORK_POWER_RATE_TIMES_KW_TIME" : "REGULATED_UC6_POWER_RATE_TIMES_KW_TIME",
    formulaInputs: {
      componentCode: segment.componentCode,
      rateEurPerKwYear: segment.normalizedValue,
      ...(bta6 ? { powerBasisKind: effectivePowerBasisKind as string, powerBasisKw: effectivePowerKw } : { contractedPowerKw: context.contractedPowerKw }),
      monthsApplied,
      annualDivisor: 12,
      customerScope: segment.customerScope,
      regulatoryRecordId: segment.regulatoryRecordId,
      regulatoryChecksum: segment.checksum,
      segmentStart: segment.segmentStart,
      segmentEnd: segment.segmentEnd,
    },
  };
}

function fixedComponent(segment: RegulatoryTimelineSegment, componentId: string, monthsApplied: number, label = "Rete quota fissa regolata", formulaId = "REGULATED_NETWORK_FIXED_RATE_TIMES_TIME"): CalculationComponent {
  if (!Number.isSafeInteger(monthsApplied) || monthsApplied < 1) return fail("REGULATORY_PRORATION_UNSUPPORTED");
  const value = multiply(fromNumber(segment.normalizedValue), divide(fromNumber(monthsApplied), fromNumber(12)));
  return {
    componentId,
    category: "REGULATED_FIXED",
    label,
    sign: "CHARGE",
    amount: money(roundCents(value)),
    formulaId,
    formulaInputs: {
      componentCode: segment.componentCode,
      rateEurPerPodYear: segment.normalizedValue,
      monthsApplied,
      annualDivisor: 12,
      customerScope: segment.customerScope,
      regulatoryRecordId: segment.regulatoryRecordId,
      regulatoryChecksum: segment.checksum,
      segmentStart: segment.segmentStart,
      segmentEnd: segment.segmentEnd,
    },
  };
}

function timelineFor(
  request: ElectricitySimulationRequest,
  context: ElectricitySupplyContext,
  bridge: Pick<ProductionRegulatoryPersistenceBridge, "list">,
  componentCode: "UC3" | "UC6" | "NETWORK_FIXED" | "NETWORK_POWER" | "NETWORK_ENERGY" | "METERING_FIXED" | "TRANSMISSION_ENERGY",
  normalizedUnit: "EUR/KWH" | "EUR/KW/YEAR" | "EUR/POD/YEAR",
): Promise<RegulatoryTimeline> {
  assertCalculatedRegulatoryDomain({ componentCode, customerScope: context.regulatoryCustomerScope, normalizedUnit });
  return resolveRegulatoryTimeline(bridge, {
    tenantId: request.tenantId,
    componentCode,
    customerScope: context.regulatoryCustomerScope,
    normalizedUnit,
    periodStart: request.supplyPeriod.periodStart,
    periodEnd: request.supplyPeriod.periodEnd,
  });
}

export async function calculateRegulatedEeSubset(
  request: ElectricitySimulationRequest,
  execution: RegulatedEeExecutionContext,
): Promise<RegulatedEeCalculation> {
  if (request.taxTreatment !== "EXCLUDED") return fail("REGULATORY_TAX_TREATMENT_UNSUPPORTED");
  if (execution.trustedElectricityContext.vector !== "EE" || !Number.isFinite(execution.trustedElectricityContext.contractedPowerKw) || execution.trustedElectricityContext.contractedPowerKw <= 0) return fail("REGULATORY_TRUST_CONTEXT_INVALID");

  const { trustedElectricityContext: context, regulatoryBridge: bridge } = execution;
  if (context.regulatoryCustomerScope === "NON_DOMESTIC_BT_BTA6") {
    const powerBasisKw = context.regulatoryPowerBasisKw;
    if (!context.regulatoryPowerBasisKind || powerBasisKw === undefined || !Number.isFinite(powerBasisKw) || powerBasisKw <= 0) return fail("REGULATORY_TRUST_CONTEXT_INVALID");
    const months = monthsInSimulationPeriod(request.supplyPeriod).length;
    if (context.regulatoryPowerBasisKind === "MONTHLY_MAX_DRAWN" && months > 1) return fail("BTA6_MONTHLY_MAX_POWER_PROFILE_REQUIRED");
    const networkFixed = await timelineFor(request, context, bridge, "NETWORK_FIXED", "EUR/POD/YEAR");
    const networkPower = await timelineFor(request, context, bridge, "NETWORK_POWER", "EUR/KW/YEAR");
    const networkEnergy = await timelineFor(request, context, bridge, "NETWORK_ENERGY", "EUR/KWH");
    const meteringFixed = await timelineFor(request, context, bridge, "METERING_FIXED", "EUR/POD/YEAR");
    const transmissionEnergy = await timelineFor(request, context, bridge, "TRANSMISSION_ENERGY", "EUR/KWH");
    const uc3 = await timelineFor(request, context, bridge, "UC3", "EUR/KWH");
    const uc6Energy = await timelineFor(request, context, bridge, "UC6", "EUR/KWH");
    const uc6Fixed = await timelineFor(request, context, bridge, "UC6", "EUR/POD/YEAR");
    [networkFixed, networkPower, networkEnergy, meteringFixed, transmissionEnergy, uc3, uc6Energy, uc6Fixed].forEach(assertMonthAligned);
    const components: CalculationComponent[] = [];
    networkFixed.segments.forEach((segment) => { const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length; components.push(fixedComponent(segment, `regulated:bta6-network-fixed:${segment.regulatoryRecordId}`, monthsApplied, "BTA6 quota fissa distribuzione regolata", "REGULATED_BTA6_NETWORK_FIXED_RATE_TIMES_TIME")); });
    networkPower.segments.forEach((segment) => { const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length; components.push(powerComponent(segment, context, `regulated:bta6-network-power:${segment.regulatoryRecordId}`, monthsApplied, true)); });
    for (const [timeline, componentId, label, formulaId] of [[networkEnergy, "regulated:bta6-network-energy", "BTA6 energia distribuzione regolata", "REGULATED_BTA6_NETWORK_ENERGY_RATE_TIMES_KWH"], [transmissionEnergy, "regulated:bta6-transmission-energy", "BTA6 energia trasmissione regolata", "REGULATED_TRANSMISSION_RATE_TIMES_KWH"]] as const) timeline.segments.forEach((segment) => components.push(energyComponent(segment, quantityForSegment(request, segment, timeline.segments.length), `${componentId}:${segment.regulatoryRecordId}`, label, formulaId)));
    meteringFixed.segments.forEach((segment) => { const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length; components.push(fixedComponent(segment, `regulated:bta6-metering-fixed:${segment.regulatoryRecordId}`, monthsApplied, "BTA6 quota misura regolata", "REGULATED_BTA6_METERING_FIXED_RATE_TIMES_TIME")); });
    for (const [timeline, componentId, label, formulaId] of [[uc3, "regulated:bta6-uc3", "BTA6 UC3 energia regolata", "REGULATED_UC3_RATE_TIMES_KWH"], [uc6Energy, "regulated:bta6-uc6-energy", "BTA6 UC6 energia regolata", "REGULATED_UC6_ENERGY_RATE_TIMES_KWH"]] as const) timeline.segments.forEach((segment) => components.push(energyComponent(segment, quantityForSegment(request, segment, timeline.segments.length), `${componentId}:${segment.regulatoryRecordId}`, label, formulaId)));
    uc6Fixed.segments.forEach((segment) => { const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length; components.push(fixedComponent(segment, `regulated:bta6-uc6-fixed:${segment.regulatoryRecordId}`, monthsApplied, "BTA6 UC6 quota fissa regolata", "REGULATED_BTA6_UC6_FIXED_RATE_TIMES_TIME")); });
    return { components, references: [networkFixed, networkPower, networkEnergy, meteringFixed, transmissionEnergy, uc3, uc6Energy, uc6Fixed].flatMap((timeline) => timeline.segments.map(referenceOf)), includedComponents: [...BTA6_REGULATED_COMPONENTS_INCLUDED], partialWarning: BTA6_REGULATED_SUBSET_PARTIAL_WARNING };
  }

  const uc3 = await timelineFor(request, context, bridge, "UC3", "EUR/KWH");
  const uc6Energy = await timelineFor(request, context, bridge, "UC6", "EUR/KWH");
  const uc6Power = await timelineFor(request, context, bridge, "UC6", "EUR/KW/YEAR");
  const networkFixed = await timelineFor(request, context, bridge, "NETWORK_FIXED", "EUR/POD/YEAR");
  const networkPower = await timelineFor(request, context, bridge, "NETWORK_POWER", "EUR/KW/YEAR");
  const transmissionEnergy = await timelineFor(request, context, bridge, "TRANSMISSION_ENERGY", "EUR/KWH");
  [uc3, uc6Energy, uc6Power, networkFixed, networkPower, transmissionEnergy].forEach(assertMonthAligned);

  const components: CalculationComponent[] = [];
  for (const [timeline, componentId, label, formulaId] of [
    [uc3, "regulated:uc3", "UC3 energia regolata", "REGULATED_UC3_RATE_TIMES_KWH"],
    [uc6Energy, "regulated:uc6-energy", "UC6 energia regolata", "REGULATED_UC6_ENERGY_RATE_TIMES_KWH"],
  ] as const) {
    timeline.segments.forEach((segment) => components.push(energyComponent(segment, quantityForSegment(request, segment, timeline.segments.length), `${componentId}:${segment.regulatoryRecordId}`, label, formulaId)));
  }
  uc6Power.segments.forEach((segment) => {
    const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length;
    components.push(powerComponent(segment, context, `regulated:uc6-power:${segment.regulatoryRecordId}`, monthsApplied, false));
  });
  networkFixed.segments.forEach((segment) => {
    const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length;
    components.push(fixedComponent(segment, `regulated:network-fixed:${segment.regulatoryRecordId}`, monthsApplied));
  });
  networkPower.segments.forEach((segment) => {
    const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length;
    components.push(powerComponent(segment, context, `regulated:network-power:${segment.regulatoryRecordId}`, monthsApplied, false, true));
  });
  transmissionEnergy.segments.forEach((segment) => components.push(energyComponent(segment, quantityForSegment(request, segment, transmissionEnergy.segments.length), `regulated:transmission-energy:${segment.regulatoryRecordId}`, "Trasmissione energia regolata", "REGULATED_TRANSMISSION_RATE_TIMES_KWH")));

  return { components, references: [uc3, uc6Energy, uc6Power, networkFixed, networkPower, transmissionEnergy].flatMap((timeline) => timeline.segments.map(referenceOf)), includedComponents: [...REGULATED_COMPONENTS_INCLUDED], partialWarning: REGULATED_SUBSET_PARTIAL_WARNING };
}
