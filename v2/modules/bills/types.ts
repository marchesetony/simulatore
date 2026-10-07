export const LINE_KINDS = [
  "ENERGY", "COMMERCIALIZATION", "SELLER_OTHER", "NETWORK", "SYSTEM_CHARGES",
  "EXCISE", "VAT", "TV_LICENSE", "PREVIOUS_BALANCE", "RECALCULATION", "OTHER_AMOUNTS", "UNKNOWN",
] as const;
export type LineKind = typeof LINE_KINDS[number];
export type Band = "TOTAL" | "F1" | "F2" | "F3";
export interface Period { readonly periodStart: string; readonly periodEnd: string }
export interface Supply { readonly id: string; readonly tenantId: string; readonly customerId: string; readonly pod: string }
export interface ConsumptionInput extends Period {
  readonly band: Band;
  /** Exact decimal kWh, maximum three fractional digits; null is unknown. */
  readonly energyKwh: string | null;
}
export interface LineInput extends Period {
  readonly kind: LineKind;
  readonly level: "AGGREGATE" | "DETAIL";
  readonly description: string;
  readonly quantity: string | null;
  readonly unit: string | null;
  /** Exact decimal EUR per unit, maximum six fractional digits. */
  readonly unitPrice: string | null;
  /** Signed integer euro cents. */
  readonly amount: number | null;
  readonly documentTotalParticipation: "INCLUDED" | "EXCLUDED" | "UNKNOWN";
}
export interface BillConsumption extends ConsumptionInput { readonly id: string; readonly billId: string; readonly tenantId: string }
export interface BillLine extends LineInput { readonly id: string; readonly billId: string; readonly tenantId: string }
export interface BillInput extends Period {
  readonly documentNumber: string;
  readonly issueDate: string;
  readonly declaredDocumentTotal: number | null;
  readonly currency: "EUR";
  readonly consumptions: readonly ConsumptionInput[];
  readonly lines: readonly LineInput[];
}
export interface BillCreateInput extends BillInput { readonly customerId: string; readonly supplyId: string }
export interface Reconciliation {
  readonly status: "NOT_DETERMINABLE" | "MATCH" | "DIFFERENCE";
  readonly reconstructedTotal: number | null;
  readonly difference: number | null;
  readonly reason: "INCOMPLETE_DETAILS" | "UNPROVEN_COVERAGE" | "AMBIGUOUS_DETAILS" | "AMBIGUOUS_AGGREGATION" | "UNKNOWN_AMOUNT_OR_SCOPE" | "DECLARED_TOTAL_MISSING" | null;
  readonly categories: Readonly<Record<"currentCharges" | "tvLicense" | "previousBalance" | "otherAmounts", number | null>>;
}
export interface Bill extends Omit<BillInput, "consumptions" | "lines"> {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly supplyId: string;
  readonly completenessStatus: "INCOMPLETE" | "COMPLETE";
  readonly validationStatus: "UNVALIDATED" | "VALID" | "INVALID";
  readonly reconciliation: Reconciliation;
  readonly consumptions: readonly BillConsumption[];
  readonly lines: readonly BillLine[];
}
export type BillErrorCode = "INVALID_INPUT" | "DENIED" | "NOT_FOUND" | "UNAVAILABLE";
export class BillError extends Error {
  constructor(readonly code: BillErrorCode) { super(code); this.name = "BillError"; }
}
