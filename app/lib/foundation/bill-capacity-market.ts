import type { RegulatoryValueRecord } from "./regulatory-types.ts";

export type CapacityCustomerReference = Pick<RegulatoryValueRecord, "authority" | "officialIdentifier" | "sourceReference" | "effectiveFrom" | "effectiveTo" | "originalValue" | "originalUnit" | "normalizedValue" | "normalizedUnit" | "applicationBasis" | "customerScope" | "componentCode" | "referenceDomain">;

function applicable(record: Pick<RegulatoryValueRecord, "effectiveFrom" | "effectiveTo" | "customerScope">, period: string, scope: string): boolean {
  const at = Date.parse(period);
  return record.customerScope === scope && Date.parse(record.effectiveFrom) <= at && (record.effectiveTo === null || at < Date.parse(record.effectiveTo));
}

export function resolveCustomerFacingCapacityMarketReference(records: readonly RegulatoryValueRecord[], period: { readonly from: string; readonly to: string }, customerScope: string): CapacityCustomerReference | null {
  const archived = records.find((record) => record.authority === "ARERA" && record.componentCode === "CAPACITY_MARKET" && record.referenceDomain === "CAPACITY_MARKET" && applicable(record, period.from, customerScope) && record.effectiveFrom === period.from && record.effectiveTo === period.to);
  return archived ?? null;
}
