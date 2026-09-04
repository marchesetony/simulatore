import type { ElectricitySupplyContext } from "./trusted-ee-supply-context.ts";
import type { ElectricitySimulationRequest, CalculationComponent, RegulatoryDataReference } from "./types.ts";
import type { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveRegulatoryTimeline, type RegulatoryTimeline, type RegulatoryTimelineSegment } from "./regulatory-timeline.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { add, divide, fromNumber, multiply, roundCents, toDecimal, type Rational } from "./decimal.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { monthsInSimulationPeriod } from "./input.ts";

export const REGULATED_COMPONENTS_INCLUDED = ["UC3_ENERGY", "UC6_ENERGY", "UC6_POWER"] as const;
export const REGULATED_SUBSET_PARTIAL_WARNING = "REGULATED_SUBSET_PARTIAL_UC3_UC6_ONLY" as const;

export interface RegulatedEeExecutionContext {
  readonly trustedElectricityContext: ElectricitySupplyContext;
  readonly regulatoryBridge: Pick<ProductionRegulatoryPersistenceBridge, "list">;
}

export interface RegulatedEeCalculation {
  readonly components: readonly CalculationComponent[];
  readonly references: readonly RegulatoryDataReference[];
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

function powerComponent(segment: RegulatoryTimelineSegment, context: ElectricitySupplyContext, componentId: string, monthsApplied: number): CalculationComponent {
  if (!Number.isSafeInteger(monthsApplied) || monthsApplied < 1) return fail("REGULATORY_PRORATION_UNSUPPORTED");
  const value = multiply(multiply(fromNumber(segment.normalizedValue), fromNumber(context.contractedPowerKw)), divide(fromNumber(monthsApplied), fromNumber(12)));
  return {
    componentId,
    category: "REGULATED_POWER",
    label: "UC6 potenza regolata",
    sign: "CHARGE",
    amount: money(roundCents(value)),
    formulaId: "REGULATED_UC6_POWER_RATE_TIMES_KW_TIME",
    formulaInputs: {
      componentCode: segment.componentCode,
      rateEurPerKwYear: segment.normalizedValue,
      contractedPowerKw: context.contractedPowerKw,
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
  componentCode: "UC3" | "UC6",
  normalizedUnit: "EUR/KWH" | "EUR/KW/YEAR",
): Promise<RegulatoryTimeline> {
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
  const uc3 = await timelineFor(request, context, bridge, "UC3", "EUR/KWH");
  const uc6Energy = await timelineFor(request, context, bridge, "UC6", "EUR/KWH");
  const uc6Power = await timelineFor(request, context, bridge, "UC6", "EUR/KW/YEAR");
  [uc3, uc6Energy, uc6Power].forEach(assertMonthAligned);

  const components: CalculationComponent[] = [];
  for (const [timeline, componentId, label, formulaId] of [
    [uc3, "regulated:uc3", "UC3 energia regolata", "REGULATED_UC3_RATE_TIMES_KWH"],
    [uc6Energy, "regulated:uc6-energy", "UC6 energia regolata", "REGULATED_UC6_ENERGY_RATE_TIMES_KWH"],
  ] as const) {
    timeline.segments.forEach((segment) => components.push(energyComponent(segment, quantityForSegment(request, segment, timeline.segments.length), `${componentId}:${segment.regulatoryRecordId}`, label, formulaId)));
  }
  uc6Power.segments.forEach((segment) => {
    const monthsApplied = monthsInSimulationPeriod({ periodStart: segment.segmentStart.slice(0, 10), periodEnd: segment.segmentEnd.slice(0, 10) }).length;
    components.push(powerComponent(segment, context, `regulated:uc6-power:${segment.regulatoryRecordId}`, monthsApplied));
  });

  return { components, references: [uc3, uc6Energy, uc6Power].flatMap((timeline) => timeline.segments.map(referenceOf)) };
}
