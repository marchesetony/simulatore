// Tony (29/10): business CTEs are chosen on the annual consumption. When the bill does not print it, the annual
// consumption is the average monthly consumption the bill shows, times 12.
const MONTH_DAYS = 365.25 / 12;

/** Months a billing period covers, counting both ends; null when the period is too short to stand for a month. */
export function billedMonths(periodStart: string, periodEnd: string): number | null {
  const days = (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86_400_000 + 1;
  if (!Number.isFinite(days) || days < 20) return null;
  return Math.max(1, Math.round(days / MONTH_DAYS));
}

/** Annual consumption from the bill's months: each month's total when the bill lists them, else the billed total over its months. */
export function estimatedAnnualConsumption(input: { readonly billed: number; readonly periodStart: string; readonly periodEnd: string; readonly monthTotals?: readonly number[] | null }): number | null {
  const months = (input.monthTotals ?? []).filter((value) => Number.isFinite(value) && value > 0);
  if (months.length) return Math.round(months.reduce((sum, value) => sum + value, 0) / months.length * 12);
  const count = billedMonths(input.periodStart, input.periodEnd);
  return input.billed > 0 && count !== null ? Math.round(input.billed / count * 12) : null;
}
