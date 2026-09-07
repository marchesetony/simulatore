import type { StructuredBillExtendedFact, StructuredBillFieldStatus } from "./structured-bill.ts";

export const SUPPLY_USE_CATEGORY_VALUES = ["DOMESTIC", "OTHER_USE", "PUBLIC_LIGHTING", "PUBLIC_EV_CHARGING", "UNKNOWN"] as const;
export type SupplyUseCategory = typeof SUPPLY_USE_CATEGORY_VALUES[number];
export const DOMESTIC_RESIDENCE_STATUS_VALUES = ["RESIDENT", "NON_RESIDENT", "NOT_APPLICABLE", "UNKNOWN"] as const;
export type DomesticResidenceStatus = typeof DOMESTIC_RESIDENCE_STATUS_VALUES[number];
export const POWER_BILLING_BASIS_VALUES = ["CONTRACTUAL_COMMITTED", "MONTHLY_MAX_DRAWN", "UNKNOWN"] as const;
export type PowerBillingBasis = typeof POWER_BILLING_BASIS_VALUES[number];
export const ASOS_CLASS_VALUES = ["ASOS_CLASS_0", "ASOS_CLASS_1", "ASOS_CLASS_2", "ASOS_CLASS_3", "UNKNOWN"] as const;
export type AsosClass = typeof ASOS_CLASS_VALUES[number];
export const ASOS_CLASS_SOURCE_KIND_VALUES = ["CSEA", "SII", "APPROVED_SOURCE_DOCUMENT"] as const;
export type AsosClassSourceKind = typeof ASOS_CLASS_SOURCE_KIND_VALUES[number];

export interface SupplyProfileField {
  readonly rawValue: string | null;
  readonly normalizedValue: string | null;
  readonly status: StructuredBillFieldStatus;
}

export interface AsosClassEvidence {
  readonly asosClass: AsosClass;
  readonly sourceKind: AsosClassSourceKind | null;
  readonly sourceReference: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly evidenceText: string | null;
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
  /** Optional for backwards compatibility with approved bills extracted before this trust model existed. */
  readonly asosClass?: AsosClass;
  readonly asosClassEvidence?: AsosClassEvidence;
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

const ASOS_CLASS_CODES = {
  raw: "ASOS_CLASS_RAW",
  source: "ASOS_CLASS_SOURCE_RAW",
  evidence: "ASOS_CLASS_EVIDENCE_RAW",
  effectiveFrom: "ASOS_CLASS_EFFECTIVE_FROM",
  effectiveTo: "ASOS_CLASS_EFFECTIVE_TO",
} as const;

type ProfileCode = typeof PROFILE_CODES[keyof typeof PROFILE_CODES] | typeof ASOS_CLASS_CODES[keyof typeof ASOS_CLASS_CODES];

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

export function normalizeAsosClass(value: string | null): AsosClass {
  if (!value) return "UNKNOWN";
  const text = folded(value);
  const explicit = text.match(/^(?:asos\s+)?classe(?:\s+di\s+agevolazione)?\s*([0-3])$/)
    ?? text.match(/^asos\s*([0-3])$/)
    ?? text.match(/^asos_class_([0-3])$/);
  if (!explicit) return "UNKNOWN";
  return `ASOS_CLASS_${explicit[1]}` as Exclude<AsosClass, "UNKNOWN">;
}

function normalizeAsosClassSourceKind(value: string | null): AsosClassSourceKind | null {
  if (!value) return null;
  const text = folded(value);
  if (/^csea(?:\b|\s|:|-)/.test(text)) return "CSEA";
  if (/^sii(?:\b|\s|:|-)/.test(text)) return "SII";
  if (/^(?:approved source document|documento approvato|documento di fonte approvata)(?:\b|\s|:|-)/.test(text)) return "APPROVED_SOURCE_DOCUMENT";
  return null;
}

function validDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function emptyAsosClassEvidence(status: StructuredBillFieldStatus = "NOT_FOUND"): AsosClassEvidence {
  return { asosClass: "UNKNOWN", sourceKind: null, sourceReference: null, effectiveFrom: null, effectiveTo: null, evidenceText: null, status };
}

function buildAsosClassEvidence(facts: readonly StructuredBillExtendedFact[]): AsosClassEvidence {
  for (const code of Object.values(ASOS_CLASS_CODES)) {
    const matches = facts.filter((fact) => fact.code === code && fact.status !== "NOT_FOUND" && fact.value.trim().length > 0);
    if (matches.length > 1) return emptyAsosClassEvidence("NEEDS_REVIEW");
  }
  const classFact = factFor(facts, ASOS_CLASS_CODES.raw);
  const sourceFact = factFor(facts, ASOS_CLASS_CODES.source);
  const evidenceFact = factFor(facts, ASOS_CLASS_CODES.evidence);
  const fromFact = factFor(facts, ASOS_CLASS_CODES.effectiveFrom);
  const toFact = factFor(facts, ASOS_CLASS_CODES.effectiveTo);
  if (!classFact) return emptyAsosClassEvidence();
  if (classFact.status !== "FOUND") return emptyAsosClassEvidence(classFact.status);
  const asosClass = normalizeAsosClass(classFact.value);
  const sourceKind = normalizeAsosClassSourceKind(sourceFact?.value ?? null);
  const sourceReference = sourceFact?.value.trim() || null;
  const effectiveFrom = fromFact?.value.trim() || null;
  const effectiveTo = toFact?.value.trim() || null;
  const evidenceText = evidenceFact?.value.trim() || classFact.value.trim() || null;
  const valid = asosClass !== "UNKNOWN"
    && sourceFact?.status === "FOUND"
    && sourceKind !== null
    && sourceReference !== null
    && fromFact?.status === "FOUND"
    && effectiveFrom !== null
    && validDate(effectiveFrom)
    && (effectiveTo === null || (toFact?.status === "FOUND" && validDate(effectiveTo)))
    && (evidenceFact === undefined || evidenceFact.status === "FOUND")
    && evidenceText !== null;
  if (!valid) return { asosClass: "UNKNOWN", sourceKind, sourceReference, effectiveFrom, effectiveTo, evidenceText, status: "NEEDS_REVIEW" };
  return { asosClass, sourceKind, sourceReference, effectiveFrom, effectiveTo, evidenceText, status: "FOUND" };
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
  const asosClassEvidence = buildAsosClassEvidence(facts);
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
    asosClass: asosClassEvidence.asosClass,
    asosClassEvidence,
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
  if (profile.asosClass !== undefined && !ASOS_CLASS_VALUES.includes(profile.asosClass as AsosClass)) throw new Error("BILL_SUPPLY_PROFILE_INVALID:asosClass");
  if (profile.asosClassEvidence !== undefined) {
    const evidence = profile.asosClassEvidence;
    if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) throw new Error("BILL_SUPPLY_PROFILE_INVALID:asosClassEvidence");
    const item = evidence as Record<string, unknown>;
    if (!ASOS_CLASS_VALUES.includes(item.asosClass as AsosClass)) throw new Error("BILL_SUPPLY_PROFILE_INVALID:asosClassEvidence.asosClass");
    if (item.sourceKind !== null && !ASOS_CLASS_SOURCE_KIND_VALUES.includes(item.sourceKind as AsosClassSourceKind)) throw new Error("BILL_SUPPLY_PROFILE_INVALID:asosClassEvidence.sourceKind");
    for (const key of ["sourceReference", "effectiveFrom", "effectiveTo", "evidenceText"]) {
      if (item[key] !== null && typeof item[key] !== "string") throw new Error(`BILL_SUPPLY_PROFILE_INVALID:asosClassEvidence.${key}`);
    }
    if (typeof item.status !== "string" || !["FOUND", "NOT_FOUND", "INVALID", "NEEDS_REVIEW"].includes(item.status)) throw new Error("BILL_SUPPLY_PROFILE_INVALID:asosClassEvidence.status");
    if (profile.asosClass !== undefined && item.asosClass !== profile.asosClass) throw new Error("BILL_SUPPLY_PROFILE_INVALID:asosClassEvidence.mismatch");
  }
}
