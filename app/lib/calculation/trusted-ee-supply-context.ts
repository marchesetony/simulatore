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
  if (profile.voltageClass.status !== "FOUND") {
    // Tony (28/10, bolletta BPower Be FIX RELAX): the bill does not print the voltage. A supply of at most 30 kW is connected
    // in bassa tensione (TIC: BT up to 100 kW), so the BT tables apply; above that the voltage must be read.
    let power: number | undefined;
    try { power = parseAvailablePowerKw(profile.powerAvailable) ?? parseContractedPowerKw(profile.powerCommitted); } catch { power = undefined; }
    if (power !== undefined && power > 0 && power <= 30) return "LV";
    fail("VOLTAGE_LEVEL_REQUIRED");
  }
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
  /** BT other uses up to 16,5 kW: the TIT distribution class by available power (BTA1 fino a 1,5 kW ... BTA5 fino a 16,5 kW). */
  readonly regulatoryTariffClass?: "BTA1" | "BTA2" | "BTA3" | "BTA4" | "BTA5";
  /** Class of the oneri generali rows: the official tables split them by potenza impegnata, not disponibile. */
  readonly regulatoryOneriTariffClass?: "BTA1" | "BTA2" | "BTA3" | "BTA4" | "BTA5";
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

const LIMITER_MAX_KW = 30;

function regulatoryPowerBasis(profile: BillSupplyProfile, scope: RegulatoryCustomerScope, contractedPowerKw: number): { readonly regulatoryPowerBasisKind: Exclude<PowerBillingBasis, "UNKNOWN">; readonly regulatoryPowerBasisKw: number } | undefined {
  if (scope !== "NON_DOMESTIC_BT_BTA6") return undefined;
  // TIT art. 1, "potenza impegnata" (FAQ TIT 348/07, e-distribuzione BTA6): the contractually committed power where a power
  // limiter is installed, otherwise the maximum power drawn in the month. Limiters are fitted only up to 30 kW, so above
  // that the rule alone gives the basis (Tony, 27/10: the criterion comes from the resolutions, never from the bill).
  const stated = profile.powerBillingBasis.status === "FOUND" ? profile.powerBillingBasis.normalizedValue : "UNKNOWN";
  const basis = contractedPowerKw > LIMITER_MAX_KW ? "MONTHLY_MAX_DRAWN" : stated === "UNKNOWN" ? "CONTRACTUAL_COMMITTED" : stated;
  if (basis === "CONTRACTUAL_COMMITTED") return { regulatoryPowerBasisKind: basis, regulatoryPowerBasisKw: contractedPowerKw };
  if (basis === "MONTHLY_MAX_DRAWN") return { regulatoryPowerBasisKind: basis, regulatoryPowerBasisKw: parseMaximumDrawnPowerKw(profile.powerMaximumDrawn) };
  return fail("BTA6_POWER_BILLING_BASIS_REQUIRED");
}

// Tony (30/10, AZIENDA PROTETTA 3 kW): TIT Tabella 3 classes of the other BT uses, by available power.
export function btaTariffClass(availablePowerKw: number): "BTA1" | "BTA2" | "BTA3" | "BTA4" | "BTA5" | null {
  if (!Number.isFinite(availablePowerKw) || availablePowerKw <= 0 || availablePowerKw > 16.5) return null;
  return availablePowerKw <= 1.5 ? "BTA1" : availablePowerKw <= 3 ? "BTA2" : availablePowerKw <= 6 ? "BTA3" : availablePowerKw <= 10 ? "BTA4" : "BTA5";
}

export function buildTrustedElectricitySupplyContext(profile: BillSupplyProfile, options?: TrustedElectricitySupplyContextOptions): ElectricitySupplyContext {
  const voltageLevel = requiredVoltageLevel(profile);
  const supplyUseCategory = requiredSupplyUse(profile);
  const contractedPowerKw = parseContractedPowerKw(profile.powerCommitted);
  const availablePowerKw = parseAvailablePowerKw(profile.powerAvailable);
  // Tony (30/10, "non è possibile vedere ancora mancati controlli"): a bill without the available power must not stop the
  // checks. Only to pick the class, other uses fall back to the TIT rule: with a limiter (up to 30 kW) the available power
  // is the committed one plus 10%, above that it equals the committed power. The shown available power stays the bill's.
  const classPowerKw = availablePowerKw ?? (supplyUseCategory === "OTHER_USE" ? (contractedPowerKw > LIMITER_MAX_KW ? contractedPowerKw : Math.round(contractedPowerKw * 1.1 * 100) / 100) : undefined);
  const regulatoryCustomerScope = deriveRegulatoryCustomerScope(profile, voltageLevel, classPowerKw);
  const basis = regulatoryPowerBasis(profile, regulatoryCustomerScope, contractedPowerKw);
  const asos = selectAsosClass(profile, options);
  const tariffClass = regulatoryCustomerScope === "NON_DOMESTIC_BT" && supplyUseCategory === "OTHER_USE" && classPowerKw !== undefined ? btaTariffClass(classPowerKw) : null;
  // Tony (30/10, "ancora errori"): the oneri sub-rows read "per potenze impegnate inferiori o uguali a 1,5 kW" etc.,
  // so oneri follow the committed power; distribution keeps the TIT class by available power.
  const oneriTariffClass = tariffClass === null ? null : contractedPowerKw > 0 ? btaTariffClass(Math.min(contractedPowerKw, 16.5)) : tariffClass;
  return {
    vector: "EE",
    contractedPowerKw,
    ...(availablePowerKw === undefined ? {} : { availablePowerKw }),
    supplyUseCategory,
    domesticResidenceStatus: profile.domesticResidenceStatus.normalizedValue,
    voltageLevel,
    regulatoryCustomerScope,
    ...(tariffClass ? { regulatoryTariffClass: tariffClass } : {}),
    ...(oneriTariffClass ? { regulatoryOneriTariffClass: oneriTariffClass } : {}),
    ...(basis ?? {}),
    asosClass: asos.asosClass,
    energyIntensiveStatus: energyIntensiveStatus(asos.asosClass),
    ...(asos.evidence ? { asosClassEvidence: asos.evidence } : {}),
    asosClassTemporalStatus: asos.temporalStatus,
  };
}
