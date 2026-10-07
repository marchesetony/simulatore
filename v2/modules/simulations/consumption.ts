import type { ConsumptionInput, Period } from "../bills/types";
import { decimal as validateDecimal, period as validatePeriod } from "../bills/values";
import { assertConsumptionInvariant } from "../bills/schema";
import { block } from "./types";
import { add, decimal, integer, type Rational } from "./decimal";

export interface ConsumptionGroup extends Period { readonly rows: readonly ConsumptionInput[] }
export function nextDay(day: string): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
export function monthPeriods(period: Period): readonly Period[] {
  const result: Period[] = [];
  let start = period.periodStart;
  while (start <= period.periodEnd) {
    const end = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const periodEnd = end.toISOString().slice(0, 10) < period.periodEnd ? end.toISOString().slice(0, 10) : period.periodEnd;
    result.push({ periodStart: start, periodEnd });
    start = nextDay(periodEnd);
  }
  return result;
}
export function consumptionGroups(rows: readonly ConsumptionInput[], period: Period): readonly ConsumptionGroup[] {
  validatePeriod({ ...period });
  if (!rows.length) return block("MISSING_CONSUMPTION");
  for (const row of rows) { validatePeriod({ ...row }); validateDecimal(row.energyKwh, 3); }
  const groups = new Map<string, ConsumptionInput[]>();
  for (const row of rows) {
    if (row.periodStart < period.periodStart || row.periodEnd > period.periodEnd) return block("INCOMPATIBLE_PERIOD");
    const key = `${row.periodStart}/${row.periodEnd}`, group = groups.get(key) ?? [];
    if (group.some(item => item.band === row.band)) return block("AMBIGUOUS_CONSUMPTION");
    group.push(row); groups.set(key, group);
  }
  assertConsumptionInvariant(rows);
  const ordered = [...groups.values()].map(rows => ({ periodStart: rows[0].periodStart, periodEnd: rows[0].periodEnd, rows }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].periodStart <= ordered[i - 1].periodEnd) return block("AMBIGUOUS_CONSUMPTION");
    if (ordered[i].periodStart !== nextDay(ordered[i - 1].periodEnd)) return block("INCOMPATIBLE_PERIOD");
  }
  if (ordered[0].periodStart !== period.periodStart || ordered[ordered.length - 1].periodEnd !== period.periodEnd) return block("INCOMPATIBLE_PERIOD");
  return ordered;
}
export function bandQuantity(group: ConsumptionGroup, band: "F1" | "F2" | "F3"): Rational {
  const value = group.rows.find(row => row.band === band)?.energyKwh;
  if (value === null || value === undefined) return block("MISSING_CONSUMPTION");
  return decimal(value);
}
export function groupTotal(group: ConsumptionGroup): Rational {
  const total = group.rows.find(row => row.band === "TOTAL")?.energyKwh;
  if (total !== null && total !== undefined) return decimal(total);
  return add(add(bandQuantity(group, "F1"), bandQuantity(group, "F2")), bandQuantity(group, "F3"));
}
export const totalQuantity = (groups: readonly ConsumptionGroup[]): Rational => groups.reduce((sum, group) => add(sum, groupTotal(group)), integer(0));
export function wholeMonths(period: Period): number {
  if (!period.periodStart.endsWith("-01") || !nextDay(period.periodEnd).endsWith("-01")) return block("INCOMPATIBLE_PERIOD");
  return monthPeriods(period).length;
}
