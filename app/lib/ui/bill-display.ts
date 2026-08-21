import type { PublicBillProfile } from "../foundation/real-bill";

type PublicBillFields = Readonly<Record<string, { readonly value: string | null | undefined }>>;

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasNumber(value: number | null | undefined): boolean {
  return value !== null && value !== undefined;
}

export function hasPublicBillData(profile: PublicBillProfile | null, fields: PublicBillFields): boolean {
  if (Object.values(fields).some((field) => hasText(field.value))) return true;
  if (!profile) return false;
  return Boolean(
    hasText(profile.customer.reference)
      || hasText(profile.customer.name)
      || profile.customer.customerType
      || profile.customer.taxIdentifiers.length
      || hasText(profile.supply.reference)
      || hasText(profile.supply.voltageLevel)
      || hasText(profile.billingPeriod.periodStart)
      || hasText(profile.billingPeriod.periodEnd)
      || hasText(profile.currentSupplier)
      || hasText(profile.offer.name)
      || hasText(profile.offer.code)
      || hasNumber(profile.consumption.f1)
      || hasNumber(profile.consumption.f2)
      || hasNumber(profile.consumption.f3)
      || hasNumber(profile.consumption.total)
      || hasNumber(profile.consumption.smc)
      || hasNumber(profile.consumption.correctionCoefficient)
      || profile.amounts.length,
  );
}

export function publicBillMissingLabels(profile: PublicBillProfile, fields: PublicBillFields): readonly string[] {
  const missing = new Set(profile.missing);
  if (!hasText(profile.customer.name) && !hasText(fields.customerName.value)) missing.add("Cliente");
  if (!hasText(profile.currentSupplier) && !hasText(fields.supplier.value)) missing.add("Fornitore");
  if (!hasText(profile.billingPeriod.periodStart) || !hasText(profile.billingPeriod.periodEnd)) {
    if (!hasText(fields.billingPeriod.value)) missing.add("Periodo bolletta");
  }
  if (!hasText(fields.annualConsumption.value)) missing.add("Consumo annuo");
  if (!hasText(fields.billedConsumption.value)) missing.add("Consumo fatturato");
  if (!hasText(fields.totalAmount.value)) missing.add("Totale bolletta");
  if (!hasText(profile.supply.reference) && !hasText(fields.pod.value)) missing.add(profile.vector === "EE" ? "POD" : "PDR");
  return [...missing];
}
