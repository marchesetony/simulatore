import type { BillSupplyProfile } from "./bill-supply-profile.ts";
import type { StructuredBillExtraction } from "./structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { customerTypeOf } from "./customer-type.ts";

type Evidence = Pick<StructuredBillExtraction, "customerType" | "customerTaxIdentifier" | "extendedFacts" | "economicChargeLines" | "powerKw">;
const found = <T extends string>(rawValue: string, normalizedValue: T) => ({ rawValue, normalizedValue, status: "FOUND" as const });
const missing = (field: { readonly status: string }) => field.status !== "FOUND";

/**
 * Tony (29/10, fattura dettagliata BPower): the detailed bill does not print voltage, supply use, residence or contracted
 * power, yet it is a household bill. What the bill itself proves fills the gaps, so the ARERA tables still apply:
 * - the "Bonus sociale disagio economico" is given only to resident domestic supplies;
 * - a household without an oneri quota fissa is resident (non-residents pay ASOS/ARIM per POD);
 * - the billed power ("Potenza fatturata", quota potenza in kW) is the contracted power;
 * - a household, or a supply up to 30 kW, is in bassa tensione.
 * A value read on the bill is never replaced.
 */
export function completeSupplyProfile(profile: BillSupplyProfile, extraction: Evidence): BillSupplyProfile {
  const lines = extraction.economicChargeLines ?? [];
  const texts = [...lines.map((line) => `${line.description} ${line.rawDescription ?? ""}`), ...(extraction.extendedFacts ?? []).filter((fact) => fact.status === "FOUND").map((fact) => fact.value)];
  const bonusSociale = texts.some((text) => /bonus\s+sociale/i.test(text));
  const householdRead = customerTypeOf({ customerType: extraction.customerType, customerTaxIdentifier: extraction.customerTaxIdentifier, extendedFacts: extraction.extendedFacts ?? [] }) === "RESIDENTIAL";
  let next = profile;
  if (missing(next.supplyUseCategory) && (householdRead || bonusSociale)) next = { ...next, supplyUseCategory: found("Domestico (dedotto dalla bolletta)", "DOMESTIC") };
  const domestic = next.supplyUseCategory.status === "FOUND" && next.supplyUseCategory.normalizedValue === "DOMESTIC";
  if (domestic && missing(next.domesticResidenceStatus)) {
    const fixedOneri = lines.some((line) => /oneri|asos|arim/i.test(`${line.description} ${line.rawDescription ?? ""}`) && /pod|mese|fiss/i.test(`${line.unit} ${line.description}`));
    if (bonusSociale || !fixedOneri) next = { ...next, domesticResidenceStatus: found("Residente (dedotto dalla bolletta)", "RESIDENT") };
  }
  const billedPower = extraction.powerKw?.status === "FOUND" && typeof extraction.powerKw.value === "number" && extraction.powerKw.value > 0 ? extraction.powerKw.value : null;
  if (missing(next.powerCommitted) && billedPower !== null) next = { ...next, powerCommitted: found(`${String(billedPower).replace(".", ",")} kW`, `${billedPower} kW`) };
  if (missing(next.voltageClass) && missing(next.nominalVoltage) && (domestic || (billedPower !== null && billedPower <= 30))) next = { ...next, voltageClass: found("BT (dedotta dalla bolletta)", "LV") };
  return next;
}
