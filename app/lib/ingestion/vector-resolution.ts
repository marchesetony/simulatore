import type { StructuredBillExtraction, StructuredBillField } from "./structured-bill.ts";

export type ResolvedBillVector = "EE" | "GAS" | "UNKNOWN";

export type BillVectorResolution = {
  readonly vector: ResolvedBillVector;
  readonly reviewRequired: boolean;
  readonly reason: "VALID_POD" | "VALID_PDR" | "CONFLICTING_IDENTIFIERS" | "SECONDARY_EE" | "SECONDARY_GAS" | "INSUFFICIENT_EVIDENCE";
  readonly eeEvidenceCount: number;
  readonly gasEvidenceCount: number;
  readonly modelVector: ResolvedBillVector;
};

const valueOf = <T>(field: StructuredBillField<T>): T | null => field.status === "FOUND" ? field.value : null;
const foundText = (field: StructuredBillField<string>): string | null => {
  const value = valueOf(field);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};
const validNumber = (field: StructuredBillField<number>, positive = false): boolean => {
  const value = valueOf(field);
  return typeof value === "number" && Number.isFinite(value) && (positive ? value > 0 : value >= 0);
};
const validPod = (field: StructuredBillField<string>): boolean => {
  const value = foundText(field);
  return value !== null && /^IT[A-Z0-9]{6,30}$/i.test(value);
};
const validPdr = (field: StructuredBillField<string>): boolean => {
  const value = foundText(field);
  return value !== null && /^\d{14}$/.test(value);
};

function secondaryEvidence(extraction: StructuredBillExtraction): { readonly ee: number; readonly gas: number } {
  const ee = [
    validNumber(extraction.f1Consumption),
    validNumber(extraction.f2Consumption),
    validNumber(extraction.f3Consumption),
    validNumber(extraction.powerKw),
    extraction.voltageLevel.status === "FOUND" && valueOf(extraction.voltageLevel) !== null,
    validNumber(extraction.billedConsumption),
    validNumber(extraction.annualConsumption),
  ].filter(Boolean).length;
  const gas = [
    validNumber(extraction.smcConsumption),
    validNumber(extraction.conversionCoefficient, true),
    validNumber(extraction.pcs),
    validNumber(extraction.smcConsumption) && validNumber(extraction.billedConsumption),
  ].filter(Boolean).length;
  return { ee, gas };
}

export function resolveBillVectorFromEvidence(extraction: StructuredBillExtraction): BillVectorResolution {
  const modelVector: ResolvedBillVector = valueOf(extraction.vector) ?? "UNKNOWN";
  const pod = validPod(extraction.pod);
  const pdr = validPdr(extraction.pdr);
  const secondary = secondaryEvidence(extraction);
  if (pod && pdr) return { vector: "UNKNOWN", reviewRequired: true, reason: "CONFLICTING_IDENTIFIERS", eeEvidenceCount: secondary.ee, gasEvidenceCount: secondary.gas, modelVector };
  if (pod) return { vector: "EE", reviewRequired: modelVector !== "UNKNOWN" && modelVector !== "EE", reason: "VALID_POD", eeEvidenceCount: secondary.ee, gasEvidenceCount: secondary.gas, modelVector };
  if (pdr) return { vector: "GAS", reviewRequired: modelVector !== "UNKNOWN" && modelVector !== "GAS", reason: "VALID_PDR", eeEvidenceCount: secondary.ee, gasEvidenceCount: secondary.gas, modelVector };
  if (secondary.ee >= 2 && secondary.gas === 0) return { vector: "EE", reviewRequired: modelVector !== "UNKNOWN" && modelVector !== "EE", reason: "SECONDARY_EE", eeEvidenceCount: secondary.ee, gasEvidenceCount: secondary.gas, modelVector };
  if (secondary.gas >= 2 && secondary.ee === 0) return { vector: "GAS", reviewRequired: modelVector !== "UNKNOWN" && modelVector !== "GAS", reason: "SECONDARY_GAS", eeEvidenceCount: secondary.ee, gasEvidenceCount: secondary.gas, modelVector };
  return { vector: "UNKNOWN", reviewRequired: true, reason: "INSUFFICIENT_EVIDENCE", eeEvidenceCount: secondary.ee, gasEvidenceCount: secondary.gas, modelVector };
}
