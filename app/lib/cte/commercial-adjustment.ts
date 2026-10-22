import type { CalculationReadyOffer, CteFeeComponent } from "./types";
import type { CteCommercialAdjustment } from "./archive/types";

// Company-set levers on top of an approved CTE, so a proposal can be made convenient
// without re-approving the document: the energy price per kWh/Smc and the monthly fixed fee.
export const MAX_ENERGY_PRICE_DELTA = 1;
export const MAX_MONTHLY_FEE_DELTA = 500;

function fail(code: string): never { throw new Error(code); }
function amount(value: unknown, limit: number): number {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || Math.abs(parsed) > limit) fail("CTE_ADJUSTMENT_INVALID");
  return Math.round(parsed * 1e6) / 1e6;
}

export function parseCommercialAdjustment(input: Record<string, unknown>, actor: string, at: string): CteCommercialAdjustment | null {
  const energyPriceDelta = amount(input.energyPriceDelta ?? 0, MAX_ENERGY_PRICE_DELTA);
  const monthlyFeeDelta = amount(input.monthlyFeeDelta ?? 0, MAX_MONTHLY_FEE_DELTA);
  if (energyPriceDelta === 0 && monthlyFeeDelta === 0) return null;
  return { energyPriceDelta, monthlyFeeDelta, updatedAt: at, updatedBy: actor };
}

export function validateCommercialAdjustment(value: unknown): CteCommercialAdjustment | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) fail("COMMERCIAL_METADATA_INVALID");
  const item = value as Record<string, unknown>;
  if (typeof item.updatedAt !== "string" || Number.isNaN(Date.parse(item.updatedAt)) || typeof item.updatedBy !== "string" || !item.updatedBy.trim()) fail("COMMERCIAL_METADATA_INVALID");
  return { energyPriceDelta: amount(item.energyPriceDelta, MAX_ENERGY_PRICE_DELTA), monthlyFeeDelta: amount(item.monthlyFeeDelta, MAX_MONTHLY_FEE_DELTA), updatedAt: item.updatedAt, updatedBy: item.updatedBy };
}

/** The offer as the company sells it: indexed spread or fixed price moved by the delta, plus a fee or discount line. */
export function applyCommercialAdjustment(offer: CalculationReadyOffer, adjustment: CteCommercialAdjustment | null | undefined): CalculationReadyOffer {
  if (!adjustment) return offer;
  let next: CalculationReadyOffer = offer;
  if (adjustment.energyPriceDelta !== 0) {
    const pricing = offer.pricing;
    const moved = pricing.mode === "INDEXED"
      ? { ...pricing, spread: { ...pricing.spread, amount: round(pricing.spread.amount + adjustment.energyPriceDelta) } }
      : { ...pricing, fixedPrice: { ...pricing.fixedPrice, amount: round(pricing.fixedPrice.amount + adjustment.energyPriceDelta) } };
    if (pricing.mode === "FIXED" && (moved as typeof pricing).fixedPrice.amount < 0) fail("CTE_ADJUSTMENT_OUT_OF_RANGE");
    next = { ...next, pricing: moved } as CalculationReadyOffer;
  }
  if (adjustment.monthlyFeeDelta !== 0) {
    const fee: CteFeeComponent = { feeId: "company-adjustment:monthly-fee", label: adjustment.monthlyFeeDelta > 0 ? "Correttivo quota fissa" : "Sconto quota fissa", amount: Math.abs(adjustment.monthlyFeeDelta), currency: "EUR", unit: "EUR_PER_MONTH", period: "MONTH", taxTreatment: offer.taxTreatment };
    next = adjustment.monthlyFeeDelta > 0 ? { ...next, fixedFees: [...next.fixedFees, fee] } : { ...next, commercialDiscounts: [...next.commercialDiscounts, fee] };
  }
  return next;
}

function round(value: number): number { return Math.round(value * 1e6) / 1e6; }
