import type { StructuredBillExtendedFact } from "../ingestion/structured-bill.ts";
import type { ElectricitySupplyContext } from "./trusted-ee-supply-context.ts";
import {
  EXCISE_SPECIAL_USE_VALUES,
  EXCISE_TAX_TREATMENT_VALUES,
  FISCAL_EVIDENCE_SOURCE_KINDS,
  FISCAL_MIXED_USE_VALUES,
  VAT_TREATMENT_VALUES,
  type ApprovedBillBinding,
  type ExciseSpecialUse,
  type ExciseTaxTreatment,
  type FiscalEvidence,
  type FiscalEvidenceSourceKind,
  type FiscalMixedUseEvidence,
  type FiscalMixedUseStatus,
  type VatTreatment,
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
} from "../foundation/fiscal-types.ts";

export type MonthlyProfileStatus = "MONTHLY_PROFILE_AVAILABLE" | "MONTHLY_PROFILE_MISSING" | "NOT_REQUIRED" | "UNKNOWN";
export type FiscalEvidenceTemporalStatus = "VALID" | "NOT_YET_VALID" | "EXPIRED" | "PARTIAL_OR_AMBIGUOUS" | "UNKNOWN";

export interface TrustedFiscalEvidenceSource {
  readonly sourceKind: FiscalEvidenceSourceKind;
  readonly sourceReference: string;
  readonly approvedBillBinding?: ApprovedBillBinding;
}

export interface TrustedElectricityFiscalContextInput {
  readonly supplyContext: ElectricitySupplyContext;
  readonly extendedFacts: readonly StructuredBillExtendedFact[];
  readonly simulationPeriod?: { readonly periodStart: string; readonly periodEnd: string };
  readonly evidenceSource?: TrustedFiscalEvidenceSource;
}

export interface TrustedElectricityFiscalContext {
  /** All technical/customer facts remain owned by the existing trusted supply context. */
  readonly supplyContext: ElectricitySupplyContext;
  readonly exciseTaxTreatment: ExciseTaxTreatment;
  readonly exciseSpecialUse: ExciseSpecialUse;
  readonly vatTreatment: VatTreatment;
  readonly mixedUseStatus: FiscalMixedUseStatus;
  readonly monthlyProfileStatus: MonthlyProfileStatus;
  readonly fiscalEvidenceTemporalStatus: FiscalEvidenceTemporalStatus;
  readonly exciseEvidence?: FiscalEvidence;
  readonly vatEvidence?: FiscalEvidence;
  readonly mixedUseEvidence?: FiscalMixedUseEvidence;
}

const factCodes = {
  exciseTreatment: "EXCISE_TREATMENT_RAW",
  exciseSpecialUse: "EXCISE_SPECIAL_USE_RAW",
  exciseEvidence: "EXCISE_EVIDENCE_RAW",
  vatTreatment: "VAT_TREATMENT_RAW",
  vatReference: "VAT_DECLARATION_REFERENCE",
  vatEvidence: "VAT_EVIDENCE_RAW",
  effectiveFrom: "FISCAL_EVIDENCE_EFFECTIVE_FROM",
  effectiveTo: "FISCAL_EVIDENCE_EFFECTIVE_TO",
  mixedUse: "MIXED_USE_RAW",
  mixedUsePercentages: "MIXED_USE_PERCENTAGES_RAW",
  mixedUseEvidence: "MIXED_USE_EVIDENCE_RAW",
  monthlyProfile: "MONTHLY_PROFILE_RAW",
} as const;

const allowedSourceKinds = new Set<string>(FISCAL_EVIDENCE_SOURCE_KINDS);

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

function validDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function factsFor(facts: readonly StructuredBillExtendedFact[], code: string): readonly StructuredBillExtendedFact[] {
  return facts.filter((fact) => fact.code === code);
}

function oneFact(facts: readonly StructuredBillExtendedFact[], code: string): StructuredBillExtendedFact | undefined {
  const matches = factsFor(facts, code);
  return matches.length === 1 ? matches[0] : undefined;
}

function explicitValue(fact: StructuredBillExtendedFact | undefined): string | null {
  return fact?.status === "FOUND" && fact.value.trim().length > 0 ? fact.value.trim() : null;
}

function exactValue<T extends string>(fact: StructuredBillExtendedFact | undefined, values: readonly T[]): T | null {
  const value = explicitValue(fact);
  if (!value) return null;
  const candidate = normalized(value);
  return values.includes(candidate as T) ? candidate as T : null;
}

function sourceIsTrusted(source: TrustedFiscalEvidenceSource | undefined): source is TrustedFiscalEvidenceSource {
  if (!source || !allowedSourceKinds.has(source.sourceKind) || source.sourceReference.trim().length === 0) return false;
  if (source.sourceKind === "APPROVED_SOURCE_BILL") {
    return Boolean(source.approvedBillBinding?.billId.trim() && source.approvedBillBinding.approvedVersionId.trim());
  }
  return true;
}

function evidenceParts(raw: string | null, fallbackReference: string | null): { readonly evidenceReference: string; readonly evidenceText: string } | null {
  if (!raw) return null;
  const separator = raw.indexOf("::");
  if (separator > 0) {
    const evidenceReference = raw.slice(0, separator).trim();
    const evidenceText = raw.slice(separator + 2).trim();
    if (evidenceReference && evidenceText) return { evidenceReference, evidenceText };
    return null;
  }
  if (!fallbackReference || fallbackReference.trim().length === 0 || raw.trim().length === 0) return null;
  return { evidenceReference: fallbackReference.trim(), evidenceText: raw.trim() };
}

function evidenceTextIsSufficient(text: string): boolean {
  const value = normalized(text);
  if (value.length < 12) return false;
  if (["ACCISA", "ESENTE ACCISA", "TAXABLE", "STANDARD"].includes(value)) return false;
  if (/^IVA\s+\d+(?:[.,]\d+)?%$/.test(value)) return false;
  return true;
}

function temporalStatus(effectiveFrom: string | null, effectiveTo: string | null, period: TrustedElectricityFiscalContextInput["simulationPeriod"]): FiscalEvidenceTemporalStatus {
  if (!effectiveFrom || !validDate(effectiveFrom) || (effectiveTo !== null && !validDate(effectiveTo))) return "UNKNOWN";
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) return "UNKNOWN";
  if (!period) return "UNKNOWN";
  if (!validDate(period.periodStart) || !validDate(period.periodEnd) || period.periodStart >= period.periodEnd) return "UNKNOWN";
  if (effectiveFrom >= period.periodEnd) return "NOT_YET_VALID";
  if (effectiveTo !== null && effectiveTo <= period.periodStart) return "EXPIRED";
  if (effectiveFrom > period.periodStart || (effectiveTo !== null && effectiveTo < period.periodEnd)) return "PARTIAL_OR_AMBIGUOUS";
  return "VALID";
}

function evidenceStatus(status: FiscalEvidenceTemporalStatus): FiscalEvidence["status"] {
  if (status === "EXPIRED") return "EXPIRED";
  if (status === "VALID") return "APPROVED";
  return "NEEDS_REVIEW";
}

function buildEvidence(
  facts: readonly StructuredBillExtendedFact[],
  evidenceCode: string,
  fallbackReference: string | null,
  source: TrustedFiscalEvidenceSource | undefined,
  period: TrustedElectricityFiscalContextInput["simulationPeriod"],
): { readonly evidence: FiscalEvidence | null; readonly temporalStatus: FiscalEvidenceTemporalStatus } {
  const evidenceFact = oneFact(facts, evidenceCode);
  const raw = explicitValue(evidenceFact);
  const effectiveFrom = explicitValue(oneFact(facts, factCodes.effectiveFrom));
  const effectiveTo = explicitValue(oneFact(facts, factCodes.effectiveTo));
  const status = temporalStatus(effectiveFrom, effectiveTo, period);
  const parts = evidenceParts(raw, fallbackReference);
  if (!parts || !sourceIsTrusted(source)) return { evidence: null, temporalStatus: status };
  const binding = source.approvedBillBinding;
  const evidence: FiscalEvidence = {
    sourceKind: source.sourceKind,
    sourceReference: source.sourceReference,
    evidenceReference: parts.evidenceReference,
    evidenceText: parts.evidenceText,
    effectiveFrom,
    effectiveTo,
    status: evidenceStatus(status),
    ...(binding ? { approvedBillBinding: binding } : {}),
  };
  return { evidence, temporalStatus: status };
}

function monthlyProfileStatus(facts: readonly StructuredBillExtendedFact[]): MonthlyProfileStatus {
  const fact = oneFact(facts, factCodes.monthlyProfile);
  if (!fact) return factsFor(facts, factCodes.monthlyProfile).length > 1 ? "UNKNOWN" : "MONTHLY_PROFILE_MISSING";
  if (fact.status === "FOUND" && fact.value.trim().length > 0) return "MONTHLY_PROFILE_AVAILABLE";
  if (fact.status === "NOT_FOUND") return "MONTHLY_PROFILE_MISSING";
  return "UNKNOWN";
}

function fiscalEvidenceFor(
  facts: readonly StructuredBillExtendedFact[],
  treatmentFact: StructuredBillExtendedFact | undefined,
  treatmentValues: readonly string[],
  evidenceCode: string,
  fallbackReference: string | null,
  source: TrustedFiscalEvidenceSource | undefined,
  period: TrustedElectricityFiscalContextInput["simulationPeriod"],
): { readonly treatment: string | null; readonly evidence: FiscalEvidence | null; readonly temporalStatus: FiscalEvidenceTemporalStatus } {
  const treatment = exactValue(treatmentFact, treatmentValues);
  const built = buildEvidence(facts, evidenceCode, fallbackReference, source, period);
  if (!treatment || treatment === "UNKNOWN" || !built.evidence || !evidenceTextIsSufficient(built.evidence.evidenceText) || built.temporalStatus !== "VALID") return { treatment: "UNKNOWN", evidence: built.evidence, temporalStatus: built.temporalStatus };
  return { treatment, evidence: built.evidence, temporalStatus: built.temporalStatus };
}

function mixedEvidenceFor(
  facts: readonly StructuredBillExtendedFact[],
  source: TrustedFiscalEvidenceSource | undefined,
  period: TrustedElectricityFiscalContextInput["simulationPeriod"],
): { readonly status: FiscalMixedUseStatus; readonly evidence: FiscalMixedUseEvidence | null; readonly temporalStatus: FiscalEvidenceTemporalStatus } {
  const mixedUse = exactValue(oneFact(facts, factCodes.mixedUse), FISCAL_MIXED_USE_VALUES);
  const built = buildEvidence(facts, factCodes.mixedUseEvidence, null, source, period);
  if (!mixedUse || mixedUse === "UNKNOWN" || !built.evidence || !evidenceTextIsSufficient(built.evidence.evidenceText) || built.temporalStatus !== "VALID") return { status: "UNKNOWN", evidence: built.evidence, temporalStatus: built.temporalStatus };
  return {
    status: mixedUse,
    evidence: built.evidence,
    temporalStatus: built.temporalStatus,
  };
}

/**
 * Builds a fiscal view from approved/document evidence only. Technical facts are
 * intentionally accepted as a nested trusted supply context and never used to
 * infer a fiscal treatment.
 */
export function buildTrustedElectricityFiscalContext(input: TrustedElectricityFiscalContextInput): TrustedElectricityFiscalContext {
  const facts = input.extendedFacts;
  const vatReference = explicitValue(oneFact(facts, factCodes.vatReference));
  const excise = fiscalEvidenceFor(facts, oneFact(facts, factCodes.exciseTreatment), EXCISE_TAX_TREATMENT_VALUES, factCodes.exciseEvidence, null, input.evidenceSource, input.simulationPeriod);
  const vat = fiscalEvidenceFor(facts, oneFact(facts, factCodes.vatTreatment), VAT_TREATMENT_VALUES, factCodes.vatEvidence, vatReference, input.evidenceSource, input.simulationPeriod);
  const mixed = mixedEvidenceFor(facts, input.evidenceSource, input.simulationPeriod);
  const specialUse = excise.evidence?.status === "APPROVED"
    ? exactValue(oneFact(facts, factCodes.exciseSpecialUse), EXCISE_SPECIAL_USE_VALUES) ?? "UNKNOWN"
    : "UNKNOWN";
  const temporalStatuses = [excise.temporalStatus, vat.temporalStatus, mixed.temporalStatus];
  const fiscalEvidenceTemporalStatus = temporalStatuses.includes("PARTIAL_OR_AMBIGUOUS")
    ? "PARTIAL_OR_AMBIGUOUS"
    : temporalStatuses.includes("EXPIRED")
      ? "EXPIRED"
      : temporalStatuses.includes("NOT_YET_VALID")
        ? "NOT_YET_VALID"
        : temporalStatuses.includes("VALID")
          ? "VALID"
          : "UNKNOWN";
  return {
    supplyContext: input.supplyContext,
    exciseTaxTreatment: excise.treatment as ExciseTaxTreatment,
    exciseSpecialUse: specialUse,
    vatTreatment: vat.treatment as VatTreatment,
    mixedUseStatus: mixed.status,
    monthlyProfileStatus: monthlyProfileStatus(facts),
    fiscalEvidenceTemporalStatus,
    ...(excise.evidence ? { exciseEvidence: excise.evidence } : {}),
    ...(vat.evidence ? { vatEvidence: vat.evidence } : {}),
    ...(mixed.evidence ? { mixedUseEvidence: mixed.evidence } : {}),
  };
}

export function fiscalTreatmentFromAtecoOnly(): { readonly exciseTaxTreatment: "UNKNOWN"; readonly vatTreatment: "UNKNOWN" } {
  return { exciseTaxTreatment: "UNKNOWN", vatTreatment: "UNKNOWN" };
}
