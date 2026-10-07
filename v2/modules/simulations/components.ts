import type { Period } from "../bills/types";
import { FEE_KINDS, block, type CommercialTermsSnapshot, type CommercialResult, type MarketSnapshot, type Rate } from "./types";
import { add, cents, decimal, divide, integer, multiply, type Rational } from "./decimal";
import { bandQuantity, monthPeriods, wholeMonths, type ConsumptionGroup } from "./consumption";

type Component = CommercialResult["components"][number];
function component(kind: Component["kind"], value: Rational, period: Period, band: Component["band"] = "TOTAL"): Component {
  return { kind, ...period, band, amountCents: cents(value) };
}
function applicable(rate: Rate): boolean {
  if (rate.applicability === "UNKNOWN") return block("MISSING_COMMERCIAL_COMPONENT");
  if (rate.applicability === "NOT_APPLICABLE") return false;
  if (rate.amount === null) return block("MISSING_COMMERCIAL_COMPONENT");
  if (rate.unit === null) return block("UNKNOWN_UNIT");
  return true;
}
function energyRate(rate: Rate): Rational {
  if (!applicable(rate)) return block("MISSING_COMMERCIAL_COMPONENT");
  if (rate.unit !== "EUR_PER_KWH") return block("UNKNOWN_UNIT");
  return decimal(rate.amount!);
}
export function energyComponents(terms: CommercialTermsSnapshot, period: Period, groups: readonly ConsumptionGroup[], quantity: Rational,
  market: MarketSnapshot | null): readonly Component[] {
  if (terms.mode === "FIXED") {
    const rows = [component("ENERGY", multiply(energyRate(terms.fixedPrice), quantity), period)];
    if (applicable(terms.spread)) rows.push(component("SPREAD", multiply(energyRate(terms.spread), quantity), period));
    return rows;
  }
  if (terms.fixedPrice.applicability !== "NOT_APPLICABLE") return block("AMBIGUOUS_COMPONENT");
  const spread = energyRate(terms.spread), months = monthPeriods(period);
  if (!market) return block("MISSING_MARKET_DATA");
  const keys = market.values.map(row => `${row.month}/${row.band}`);
  if (new Set(keys).size !== keys.length) return block("AMBIGUOUS_MARKET_DATA");
  return months.flatMap(month => {
    const group = groups.find(group => group.periodStart === month.periodStart && group.periodEnd === month.periodEnd);
    if (!group) return block("INCOMPATIBLE_PERIOD");
    return (["F1", "F2", "F3"] as const).map(band => {
      const quantity = bandQuantity(group, band);
      const rate = market.values.find(row => row.month === month.periodStart.slice(0, 7) && row.band === band);
      if (!rate || rate.value === null) return block("MISSING_MARKET_DATA");
      return component("ENERGY", multiply(add(divide(decimal(rate.value), integer(1000)), spread), quantity), month, band);
    });
  });
}
export function feeComponents(terms: CommercialTermsSnapshot, period: Period): readonly Component[] {
  const keys = terms.fees.map(fee => fee.kind);
  if (new Set(keys).size !== keys.length) return block("AMBIGUOUS_COMPONENT");
  if (FEE_KINDS.some(kind => !keys.includes(kind))) return block("MISSING_COMMERCIAL_COMPONENT");
  const result: Component[] = [];
  for (const kind of FEE_KINDS) {
    const fee = terms.fees.find(fee => fee.kind === kind)!;
    // A declared imbalance is not proof of disjointness from spread or other charges.
    if (kind === "IMBALANCE" && fee.applicability === "APPLIES") return block("AMBIGUOUS_COMPONENT");
    if (!applicable(fee)) continue;
    // V1 generic charges/discounts and one-offs lack evidence of distinct scope/event here.
    if (kind === "OTHER_VARIABLE" || kind === "ONE_OFF" || kind === "DISCOUNT") return block("AMBIGUOUS_COMPONENT");
    if (fee.unit !== "EUR_PER_MONTH" && fee.unit !== "EUR_PER_YEAR") return block("UNKNOWN_UNIT");
    const months = integer(wholeMonths(period));
    const basis = fee.unit === "EUR_PER_YEAR" ? divide(months, integer(12)) : months;
    result.push(component(kind, multiply(decimal(fee.amount!), basis), period));
  }
  return result;
}
