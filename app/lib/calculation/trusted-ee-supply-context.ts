import type { AsosClass, AsosClassEvidence, BillSupplyProfile, DomesticResidenceStatus, PowerBillingBasis, SupplyUseCategory } from "../ingestion/bill-supply-profile.ts";
import type { RegulatoryCustomerScope } from "../foundation/regulatory-types.ts";
import type { VoltageLevel } from "../energy/types";

export class TrustedElectricitySupplyContextError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "TrustedElectricitySupplyContextError";
    this.code = code;
  }
}

const fail = (code: string): never => { throw new TrustedElectricitySupplyContextError(code); };
const POWER_KW_PATTERN = /^(\d+(?:[.,]\d+)?)\s*kW$/i;
const VOLTAGE_LEVELS: readonly VoltageLevel[] = ["LV", "MV", "HV", "EHV"];
const PUBLIC_NON_DOMESTIC_SUPPLY_USE: readonly SupplyUseCategory[] = ["PUBLIC_LIGHTING", "PUBLIC_EV_CHARGING"];
export type EnergyIntensiveStatus = "ENERGY_INTENSIVE" | "NOT_ENERGY_INTENSIVE" | "UNKNOWN";
export type AsosClassTemporalStatus = "VALID" | "NOT_YET_VALID" | "EXPIRED" | "PARTIAL_OR_MULTIPLE" | "UNKNOWN";

function normalizedText(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " "); }

function parsePowerField(field: BillSupplyProfile["powerCommitted"] | BillSupplyProfile["powerAvailable"] | BillSupplyProfile["powerMaximumDrawn"], missingCode: string, invalidCode: string): number | undefined {
  if (field.status === "NOT_FOUND") {
    if (missingCode === "CONTRACTED_POWER_REQUIRED") fail(missingCode);
    return undefined;
  }
  const rawValue = typeof field.rawValue === "string" ? field.rawValue : fail(invalidCode);
  if (field.status !== "FOUND") fail(invalidCode);
  if (rawValue.trim().length === 0) fail(invalidCode);
  const match = normalizedText(rawValue).match(POWER_KW_PATTERN);
  const numericText = match ? match[1] : fail(invalidCode);
  if (!numericText) fail(invalidCode);
  const value = Number(numericText.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) fail(invalidCode);
  return value;
}

export function parseContractedPowerKw(field: BillSupplyProfile["powerCommitted"]): number {
  return parsePowerField(field, "CONTRACTED_POWER_REQUIRED", "CONTRACTED_POWER_INVALID") ?? fail("CONTRACTED_POWER_REQUIRED");
}

export function parseAvailablePowerKw(field: BillSupplyProfile["powerAvailable"]): number | undefined {
  return parsePowerField(field, "AVAILABLE_POWER_OPTIONAL", "AVAILABLE_POWER_INVALID");
}

export function parseMaximumDrawnPowerKw(field: BillSupplyProfile["powerMaximumDrawn"]): number {
  return parsePowerField(field, "BTA6_MAXIMUM_DRAWN_POWER_REQUIRED", "BTA6_MAXIMUM_DRAWN_POWER_INVALID") ?? fail("BTA6_MAXIMUM_DRAWN_POWER_REQUIRED");
}

function requiredVoltageLevel(profile: BillSupplyProfile): VoltageLevel {
  if (profile.voltageClass.status !== "FOUND") fail("VOLTAGE_LEVEL_REQUIRED");
  const value = profile.voltageClass.normalizedValue?.toUpperCase();
  if (!value || !VOLTAGE_LEVELS.includes(value as VoltageLevel)) fail("VOLTAGE_LEVEL_INVALID");
  return value as VoltageLevel;
}

function requiredSupplyUse(profile: BillSupplyProfile): Exclude<SupplyUseCategory, "UNKNOWN"> {
  if (profile.supplyUseCategory.status !== "FOUND") fail("SUPPLY_USE_CATEGORY_REQUIRED");
  const value = profile.supplyUseCategory.normalizedValue;
  if (value === "UNKNOWN") fail("SUPPLY_USE_CATEGORY_INVALID");
  return value as Exclude<SupplyUseCategory, "UNKNOWN">;
}

function deriveRegulatoryCustomerScope(profile: BillSupplyProfile, voltageLevel: VoltageLevel, availablePowerKw: number | undefined): RegulatoryCustomerScope {
  if (voltageLevel !== "LV") fail("REGULATORY_SCOPE_UNRESOLVED");
  const supplyUse = requiredSupplyUse(profile);
  if (supplyUse === "DOMESTIC") {
    if (profile.domesticResidenceStatus.status !== "FOUND") fail("DOMESTIC_RESIDENCE_REQUIRED");
    const residence: DomesticResidenceStatus = profile.domesticResidenceStatus.normalizedValue;
    if (residence === "RESIDENT") return "DOMESTIC_RESIDENT_BT";
    if (residence === "NON_RESIDENT") return "DOMESTIC_NON_RESIDENT_BT";
    fail("DOMESTIC_RESIDENCE_INVALID");
  }
  if (supplyUse === "OTHER_USE") {
    if (profile.domesticResidenceStatus.normalizedValue !== "NOT_APPLICABLE") fail("DOMESTIC_RESIDENCE_INVALID");
    const availablePower = availablePowerKw ?? fail("AVAILABLE_POWER_REQUIRED_FOR_BT_TARIFF_CLASS");
    return availablePower > 16.5 ? "NON_DOMESTIC_BT_BTA6" : "NON_DOMESTIC_BT";
  }
  if (PUBLIC_NON_DOMESTIC_SUPPLY_USE.includes(supplyUse)) {
    if (profile.domesticResidenceStatus.normalizedValue !== "NOT_APPLICABLE") fail("DOMESTIC_RESIDENCE_INVALID");
    return "NON_DOMESTIC_BT";
  }
  return fail("REGULATORY_SCOPE_UNRESOLVED");
}

export interface ElectricitySupplyContext {
  readonly vector: "EE";
  readonly contractedPowerKw: number;
  readonly availablePowerKw?: number;
  readonly supplyUseCategory: Exclude<SupplyUseCategory, "UNKNOWN">;
  readonly domesticResidenceStatus: DomesticResidenceStatus;
  readonly voltageLevel: VoltageLevel;
  readonly regulatoryCustomerScope: RegulatoryCustomerScope;
  readonly regulatoryPowerBasisKind?: Exclude<PowerBillingBasis, "UNKNOWN">;
  readonly regulatoryPowerBasisKw?: number;
  readonly asosClass: AsosClass;
  readonly energyIntensiveStatus: EnergyIntensiveStatus;
  readonly asosClassEvidence?: TrustedAsosClassEvidence;
  readonly asosClassTemporalStatus: AsosClassTemporalStatus;
}

export interface TrustedAsosClassEvidence extends AsosClassEvidence {
  readonly billId: string;
  readonly approvedVersionId: string;
}

export interface TrustedElectricitySupplyContextOptions {
  readonly simulationPeriod?: { readonly periodStart: string; readonly periodEnd: string };
  readonly sourceBillBinding?: { readonly billId: string; readonly approvedVersionId: string };
}

function energyIntensiveStatus(asosClass: AsosClass): EnergyIntensiveStatus {
  if (asosClass === "ASOS_CLASS_0") return "NOT_ENERGY_INTENSIVE";
  if (asosClass === "ASOS_CLASS_1" || asosClass === "ASOS_CLASS_2" || asosClass === "ASOS_CLASS_3") return "ENERGY_INTENSIVE";
  return "UNKNOWN";
}

function validDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function selectAsosClass(profile: BillSupplyProfile, options: TrustedElectricitySupplyContextOptions | undefined): {
  readonly asosClass: AsosClass;
  readonly temporalStatus: AsosClassTemporalStatus;
  readonly evidence?: TrustedAsosClassEvidence;
} {
  const evidence = profile.asosClassEvidence;
  if (!evidence || evidence.status !== "FOUND" || evidence.asosClass === "UNKNOWN" || !validDate(evidence.effectiveFrom) || !evidence.sourceKind || !evidence.sourceReference?.trim() || !evidence.evidenceText?.trim() || (evidence.effectiveTo !== null && !validDate(evidence.effectiveTo)) || !options?.sourceBillBinding) {
    return { asosClass: "UNKNOWN", temporalStatus: "UNKNOWN" };
  }
  const period = options?.simulationPeriod;
  const effectiveFrom = evidence.effectiveFrom;
  const effectiveTo = evidence.effectiveTo;
  if (!effectiveFrom) return { asosClass: "UNKNOWN", temporalStatus: "UNKNOWN" };
  let temporalStatus: AsosClassTemporalStatus = "VALID";
  if (period) {
    if (effectiveFrom >= period.periodEnd) temporalStatus = "NOT_YET_VALID";
    else if (effectiveTo !== null && effectiveTo <= period.periodStart) temporalStatus = "EXPIRED";
    else if (effectiveFrom > period.periodStart || (effectiveTo !== null && effectiveTo < period.periodEnd)) temporalStatus = "PARTIAL_OR_MULTIPLE";
  }
  if (temporalStatus !== "VALID") return { asosClass: "UNKNOWN", temporalStatus };
  return {
    asosClass: evidence.asosClass,
    temporalStatus,
    evidence: {
      ...evidence,
      ...(options?.sourceBillBinding ?? {}),
    },
  };
}

function regulatoryPowerBasis(profile: BillSupplyProfile, scope: RegulatoryCustomerScope, contractedPowerKw: number): { readonly regulatoryPowerBasisKind: Exclude<PowerBillingBasis, "UNKNOWN">; readonly regulatoryPowerBasisKw: number } | undefined {
  if (scope !== "NON_DOMESTIC_BT_BTA6") return undefined;
  if (profile.powerBillingBasis.status !== "FOUND") fail("BTA6_POWER_BILLING_BASIS_REQUIRED");
  const basis = profile.powerBillingBasis.normalizedValue;
  if (basis === "UNKNOWN") fail("BTA6_POWER_BILLING_BASIS_REQUIRED");
  if (basis === "CONTRACTUAL_COMMITTED") return { regulatoryPowerBasisKind: basis, regulatoryPowerBasisKw: contractedPowerKw };
  if (basis === "MONTHLY_MAX_DRAWN") return { regulatoryPowerBasisKind: basis, regulatoryPowerBasisKw: parseMaximumDrawnPowerKw(profile.powerMaximumDrawn) };
  return fail("BTA6_POWER_BILLING_BASIS_REQUIRED");
}

export function buildTrustedElectricitySupplyContext(profile: BillSupplyProfile, options?: TrustedElectricitySupplyContextOptions): ElectricitySupplyContext {
  const voltageLevel = requiredVoltageLevel(profile);
  const supplyUseCategory = requiredSupplyUse(profile);
  const contractedPowerKw = parseContractedPowerKw(profile.powerCommitted);
  const availablePowerKw = parseAvailablePowerKw(profile.powerAvailable);
  const regulatoryCustomerScope = deriveRegulatoryCustomerScope(profile, voltageLevel, availablePowerKw);
  const basis = regulatoryPowerBasis(profile, regulatoryCustomerScope, contractedPowerKw);
  const asos = selectAsosClass(profile, options);
  return {
    vector: "EE",
    contractedPowerKw,
    ...(availablePowerKw === undefined ? {} : { availablePowerKw }),
    supplyUseCategory,
    domesticResidenceStatus: profile.domesticResidenceStatus.normalizedValue,
    voltageLevel,
    regulatoryCustomerScope,
    ...(basis ?? {}),
    asosClass: asos.asosClass,
    energyIntensiveStatus: energyIntensiveStatus(asos.asosClass),
    ...(asos.evidence ? { asosClassEvidence: asos.evidence } : {}),
    asosClassTemporalStatus: asos.temporalStatus,
  };
}
