/**
 * Tony (1/11): "un box che prevede di far risultare i preventivi che sono meno convenienti della bolletta di una percentuale e
 * farli risultare migliori di una percentuale che sarà da loro stabilita". Chosen as a real commercial discount: when the CTE
 * costs more than the bill by at most maxGapPercent, the company grants a discount that brings the quote targetSavingPercent
 * below the bill. The discount is a line of the quote and of the proposal, and the company applies it on its invoices: a
 * saving the customer would not find on the bill is never shown.
 */
export interface CommercialDiscountPolicy {
  readonly enabled: boolean;
  /** How much more than the bill (in % of the bill total) a quote may cost and still be discounted. */
  readonly maxGapPercent: number;
  /** The saving (in % of the bill total) the discounted quote shows. */
  readonly targetSavingPercent: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export const COMMERCIAL_DISCOUNT_RECORD_ID = "policy";
export const COMMERCIAL_DISCOUNT_MAX_PERCENT = 30;

export function emptyCommercialDiscount(): CommercialDiscountPolicy {
  return { enabled: false, maxGapPercent: 0, targetSavingPercent: 0, updatedAt: "", updatedBy: "" };
}

export function parseCommercialDiscount(value: unknown, now: string, actor: string): CommercialDiscountPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("COMMERCIAL_DISCOUNT_INVALID");
  const input = value as Record<string, unknown>;
  const percent = (key: string): number => {
    const raw = typeof input[key] === "string" ? Number(String(input[key]).replace(",", ".")) : input[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > COMMERCIAL_DISCOUNT_MAX_PERCENT) throw new Error("COMMERCIAL_DISCOUNT_PERCENT_INVALID");
    return Math.round(raw * 100) / 100;
  };
  if (typeof input.enabled !== "boolean") throw new Error("COMMERCIAL_DISCOUNT_INVALID");
  const policy = { enabled: input.enabled, maxGapPercent: percent("maxGapPercent"), targetSavingPercent: percent("targetSavingPercent"), updatedAt: now, updatedBy: actor };
  if (policy.enabled && policy.maxGapPercent <= 0) throw new Error("COMMERCIAL_DISCOUNT_PERCENT_INVALID");
  return policy;
}

/** The discount (same tax basis as the totals) that brings a quote costing more than the bill to the company's saving, or 0. */
export function commercialDiscountAmount(policy: Pick<CommercialDiscountPolicy, "enabled" | "maxGapPercent" | "targetSavingPercent"> | null | undefined, currentTotal: number | null, offerTotal: number | null): number {
  if (!policy?.enabled || currentTotal === null || offerTotal === null || currentTotal <= 0) return 0;
  const gapPercent = (offerTotal - currentTotal) / currentTotal * 100;
  if (gapPercent <= 0 || gapPercent > policy.maxGapPercent + 1e-9) return 0;
  return Math.round((offerTotal - currentTotal * (1 - policy.targetSavingPercent / 100)) * 100) / 100;
}
