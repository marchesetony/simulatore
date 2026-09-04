import type { StructuredBillExtendedFact, StructuredBillFieldStatus } from "./structured-bill.ts";

export const SUPPLY_USE_CATEGORY_VALUES = ["DOMESTIC", "OTHER_USE", "PUBLIC_LIGHTING", "PUBLIC_EV_CHARGING", "UNKNOWN"] as const;
export type SupplyUseCategory = typeof SUPPLY_USE_CATEGORY_VALUES[number];
export const DOMESTIC_RESIDENCE_STATUS_VALUES = ["RESIDENT", "NON_RESIDENT", "NOT_APPLICABLE", "UNKNOWN"] as const;
export type DomesticResidenceStatus = typeof DOMESTIC_RESIDENCE_STATUS_VALUES[number];
export const POWER_BILLING_BASIS_VALUES = ["CONTRACTUAL_COMMITTED", "MONTHLY_MAX_DRAWN", "UNKNOWN"] as const;
export type PowerBillingBasis = typeof POWER_BILLING_BASIS_VALUES[number];

export interface SupplyProfileField {
  readonly rawValue: string | null;
  readonly normalizedValue: string | null;
  readonly status: StructuredBillFieldStatus;
}

export interface BillSupplyProfile {
  readonly supplyUseCategory: SupplyProfileField & { readonly normalizedValue: SupplyUseCategory };
  readonly domesticResidenceStatus: SupplyProfileField & { readonly normalizedValue: DomesticResidenceStatus };
  readonly contractualTariffCategory: SupplyProfileField;
  readonly marketRegime: SupplyProfileField;
  readonly voltageClass: SupplyProfileField;
  readonly nominalVoltage: SupplyProfileField;
  readonly powerCommitted: SupplyProfileField;
  readonly powerAvailable: SupplyProfileField;
  readonly powerMaximumDrawn: SupplyProfileField;
  readonly powerBillingBasis: SupplyProfileField & { readonly normalizedValue: PowerBillingBasis };
}

const PROFILE_CODES = {
  supplyUseCategory: "SUPPLY_USE_CATEGORY_RAW",
  domesticResidenceStatus: "DOMESTIC_RESIDENCE_STATUS_RAW",
  contractualTariffCategory: "CONTRACTUAL_TARIFF_CATEGORY_RAW",
  marketRegime: "MARKET_REGIME_RAW",
  voltageClass: "VOLTAGE_CLASS_RAW",
  nominalVoltage: "NOMINAL_VOLTAGE",
  powerCommitted: "POWER_COMMITTED",
  powerAvailable: "POWER_AVAILABLE",
  powerMaximumDrawn: "POWER_MAXIMUM_DRAWN",
  powerBillingBasis: "POWER_BILLING_BASIS_RAW",
} as const;

type ProfileCode = typeof PROFILE_CODES[keyof typeof PROFILE_CODES];

function factFor(facts: readonly StructuredBillExtendedFact[], code: ProfileCode): StructuredBillExtendedFact | undefined {
  return facts.find((fact) => fact.code === code && fact.status !== "NOT_FOUND" && fact.value.trim().length > 0);
}

function rawField(fact: StructuredBillExtendedFact | undefined): SupplyProfileField {
  return fact ? { rawValue: fact.value, normalizedValue: null, status: fact.status } : { rawValue: null, normalizedValue: null, status: "NOT_FOUND" };
}

function folded(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

function classifySupplyUse(value: string | null): SupplyUseCategory {
  if (!value) return "UNKNOWN";
  const text = folded(value);
  if (/\b(?:pubblica|pubblico)\s+illuminazione\b/.test(text)) return "PUBLIC_LIGHTING";
  if (/\b(?:ricarica|ricariche)\b.*\b(?:veicoli|auto|elettric[io])\b|\bveicoli\s+elettrici\b.*\bricarica\b/.test(text)) return "PUBLIC_EV_CHARGING";
  if (/\bdomestic[oa]\b/.test(text)) return "DOMESTIC";
  if (/\baltri\s+usi\b|\baltro\s+uso\b/.test(text)) return "OTHER_USE";
  return "UNKNOWN";
}

function classifyResidence(value: string | null, supplyUse: SupplyUseCategory): DomesticResidenceStatus {
  if (supplyUse === "OTHER_USE" || supplyUse === "PUBLIC_LIGHTING" || supplyUse === "PUBLIC_EV_CHARGING") return "NOT_APPLICABLE";
  if (!value) return "UNKNOWN";
  const text = folded(value);
  if (/\bnon\s+resident[ei]?\b/.test(text)) return "NON_RESIDENT";
  if (/\bresident[ei]?\b/.test(text)) return "RESIDENT";
  return "UNKNOWN";
}

function normalizeTariff(value: string | null): string | null {
  if (!value) return null;
  const text = folded(value);
  if (/\btdr\b/.test(text)) return "TDR";
  if (/\btd\b/.test(text)) return "TD";
  if (/\bbta\b/.test(text)) return "BTA";
  return null;
}

function normalizeMarket(value: string | null): string | null {
  if (!value) return null;
  const text = folded(value);
  if (/\bmercato\s+libero\b|\blibero\b/.test(text)) return "MERCATO_LIBERO";
  if (/\bmaggior\s+tutela\b/.test(text)) return "MAGGIOR_TUTELA";
  if (/\bservizio\s+elettrico\s+nazionale\b/.test(text)) return "SERVIZIO_ELETTRICO_NAZIONALE";
  return null;
}

function normalizeVoltageClass(value: string | null): string | null {
  if (!value) return null;
  const text = folded(value);
  const volts = Number.parseFloat(text.replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0] ?? 'NaN');
  if (Number.isFinite(volts) && volts > 0 && volts <= 1_000) return "LV";
  if (/\bextra\s*alta\s+tensione\b|\behv\b/.test(text)) return "EHV";
  if (/\balta\s+tensione\b|\bhv\b/.test(text)) return "HV";
  if (/\bmedia\s+tensione\b|\bmt\b|\bmv\b/.test(text)) return "MV";
  if (/\bbassa\s+tensione\b|\bbt\b|\blv\b/.test(text)) return "LV";
  return null;
}

function normalizePowerBillingBasis(value: string | null): PowerBillingBasis {
  if (!value) return "UNKNOWN";
  const text = folded(value);
  if (/\b(?:potenza\s+)?(?:contrattualmente\s+impegnata|contractual(?:ly)?\s+committed)\b/.test(text)) return "CONTRACTUAL_COMMITTED";
  if (/\b(?:massim[oa]\s+(?:valore\s+della\s+)?potenza\s+prelevata|livello\s+massimo\s+di\s+potenza\s+prelevata|monthly\s+max(?:imum)?\s+drawn)\b/.test(text)) return "MONTHLY_MAX_DRAWN";
  return "UNKNOWN";
}

function withNormalized(field: SupplyProfileField, normalizedValue: string | null): SupplyProfileField {
  return { ...field, normalizedValue };
}

export function buildBillSupplyProfile(facts: readonly StructuredBillExtendedFact[]): BillSupplyProfile {
  const residenceRaw = factFor(facts, PROFILE_CODES.domesticResidenceStatus);
  // A document may print the complete phrase only under its customer/residence
  // label. That explicit phrase is still documentary evidence for supply use;
  // no value is derived from the generic legacy customerType.
  const supplyUseRaw = factFor(facts, PROFILE_CODES.supplyUseCategory) ?? residenceRaw;
  const supplyUseCategory = classifySupplyUse(supplyUseRaw?.value ?? null);
  const residence = rawField(residenceRaw);
  return {
    supplyUseCategory: { ...rawField(supplyUseRaw), normalizedValue: supplyUseCategory },
    domesticResidenceStatus: { ...residence, normalizedValue: classifyResidence(residence.rawValue, supplyUseCategory) },
    contractualTariffCategory: withNormalized(rawField(factFor(facts, PROFILE_CODES.contractualTariffCategory)), normalizeTariff(factFor(facts, PROFILE_CODES.contractualTariffCategory)?.value ?? null)),
    marketRegime: withNormalized(rawField(factFor(facts, PROFILE_CODES.marketRegime)), normalizeMarket(factFor(facts, PROFILE_CODES.marketRegime)?.value ?? null)),
    voltageClass: withNormalized(rawField(factFor(facts, PROFILE_CODES.voltageClass)), normalizeVoltageClass(factFor(facts, PROFILE_CODES.voltageClass)?.value ?? null)),
    nominalVoltage: rawField(factFor(facts, PROFILE_CODES.nominalVoltage)),
    powerCommitted: rawField(factFor(facts, PROFILE_CODES.powerCommitted)),
    powerAvailable: rawField(factFor(facts, PROFILE_CODES.powerAvailable)),
    powerMaximumDrawn: rawField(factFor(facts, PROFILE_CODES.powerMaximumDrawn)),
    powerBillingBasis: { ...rawField(factFor(facts, PROFILE_CODES.powerBillingBasis)), normalizedValue: normalizePowerBillingBasis(factFor(facts, PROFILE_CODES.powerBillingBasis)?.value ?? null) },
  };
}

export function validateBillSupplyProfile(value: unknown): asserts value is BillSupplyProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("BILL_SUPPLY_PROFILE_INVALID");
  const profile = value as Record<string, unknown>;
  for (const key of Object.keys(PROFILE_CODES)) {
    const field = profile[key];
    if (typeof field !== "object" || field === null || Array.isArray(field)) throw new Error(`BILL_SUPPLY_PROFILE_INVALID:${key}`);
    const item = field as Record<string, unknown>;
    if (item.rawValue !== null && typeof item.rawValue !== "string") throw new Error(`BILL_SUPPLY_PROFILE_INVALID:${key}.rawValue`);
    if (item.normalizedValue !== null && typeof item.normalizedValue !== "string") throw new Error(`BILL_SUPPLY_PROFILE_INVALID:${key}.normalizedValue`);
    if (typeof item.status !== "string" || !["FOUND", "NOT_FOUND", "INVALID", "NEEDS_REVIEW"].includes(item.status)) throw new Error(`BILL_SUPPLY_PROFILE_INVALID:${key}.status`);
    if (key === "powerBillingBasis" && !POWER_BILLING_BASIS_VALUES.includes(item.normalizedValue as PowerBillingBasis)) throw new Error(`BILL_SUPPLY_PROFILE_INVALID:${key}.normalizedValue`);
  }
}
