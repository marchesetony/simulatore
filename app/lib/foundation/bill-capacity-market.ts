import type { RegulatoryValueRecord } from "./regulatory-types.ts";

export type CapacityCustomerReference = Pick<RegulatoryValueRecord, "authority" | "officialIdentifier" | "sourceReference" | "effectiveFrom" | "effectiveTo" | "originalValue" | "originalUnit" | "normalizedValue" | "normalizedUnit" | "applicationBasis" | "customerScope" | "componentCode" | "referenceDomain">;

const CUSTOMER_SCOPES = new Set(["DOMESTIC_BT", "DOMESTIC_RESIDENT_BT", "DOMESTIC_NON_RESIDENT_BT"]);
const CUSTOMER_REFERENCE_SOURCE = "ARERA 219/2026/R/eel";

const MONTHLY_VALUES = [
  { from: "2026-07-01", to: "2026-08-01", value: 2.4466, month: "Luglio 2026" },
  { from: "2026-08-01", to: "2026-09-01", value: 0.6288, month: "Agosto 2026" },
  { from: "2026-09-01", to: "2026-10-01", value: 0.3197, month: "Settembre 2026" },
] as const;

function applicable(record: Pick<RegulatoryValueRecord, "effectiveFrom" | "effectiveTo" | "customerScope">, period: string, scope: string): boolean {
  const at = Date.parse(period);
  return CUSTOMER_SCOPES.has(scope) && (record.customerScope === scope || record.customerScope === "DOMESTIC_BT") && Date.parse(record.effectiveFrom) <= at && (record.effectiveTo === null || at < Date.parse(record.effectiveTo));
}

export function resolveCustomerFacingCapacityMarketReference(records: readonly RegulatoryValueRecord[], period: { readonly from: string; readonly to: string }, customerScope: string): CapacityCustomerReference | null {
  const archived = records.find((record) => record.authority === "ARERA" && record.componentCode === "CAPACITY_MARKET" && record.referenceDomain === "CAPACITY_MARKET" && applicable(record, period.from, customerScope) && record.effectiveFrom === period.from && record.effectiveTo === period.to);
  if (archived) return archived;
  const month = MONTHLY_VALUES.find((candidate) => candidate.from === period.from && candidate.to === period.to);
  if (!month || !CUSTOMER_SCOPES.has(customerScope)) return null;
  return {
    authority: "ARERA",
    officialIdentifier: "219/2026/R/eel",
    sourceReference: CUSTOMER_REFERENCE_SOURCE,
    effectiveFrom: month.from,
    effectiveTo: month.to,
    originalValue: month.value,
    originalUnit: "CENT_EUR/KWH",
    normalizedValue: month.value / 100,
    normalizedUnit: "EUR/KWH",
    applicationBasis: `Deliberazione 219/2026/R/eel, articolo 4; corrispettivo customer-facing mercato della capacità; ${month.month}; profilo domestico`,
    customerScope: customerScope === "DOMESTIC_RESIDENT_BT" ? "DOMESTIC_RESIDENT_BT" : "DOMESTIC_BT",
    componentCode: "CAPACITY_MARKET",
    referenceDomain: "CAPACITY_MARKET",
  };
}

export const CAPACITY_CUSTOMER_REFERENCE_SOURCE = CUSTOMER_REFERENCE_SOURCE;
