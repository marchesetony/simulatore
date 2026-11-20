// Tony (17/11/2026, binding, "intero periodo"): a quote may only rest on a bill whose whole supply (consumption) period falls
// within the last QUOTE_WINDOW_MONTHS. The window is measured on the server's Italian date, never on a date sent by the
// client, and never on the bill's issue date. It replaces the 2/11 rule that only looked at the end of the period (4 months).
export const QUOTE_WINDOW_MONTHS = 5;

/** The earliest date a quote dated `asOf` (YYYY-MM-DD) may draw on: the same day QUOTE_WINDOW_MONTHS earlier (clamped). */
export function quoteWindowStart(asOf: string, months = QUOTE_WINDOW_MONTHS): string {
  const [year, month, day] = asOf.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export type SupplyPeriodAdmission =
  | { readonly admitted: true; readonly windowStart: string; readonly today: string }
  | { readonly admitted: false; readonly code: "SOURCE_BILL_PERIOD_MISSING" | "SOURCE_BILL_PERIOD_INVALID" | "SOURCE_BILL_PERIOD_FUTURE" | "SOURCE_BILL_TOO_OLD"; readonly windowStart: string; readonly today: string };

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/**
 * Whether the bill's supply period may be quoted on `today` (the server's Italian date). Boundaries, both inclusive:
 * the first billed day must be on or after the window start (same day five months earlier) and the last billed day on or
 * before today. Missing, impossible or inverted dates, a period that ends in the future and a period that starts before the
 * window (even by one day, even when it ends inside it) are refused.
 */
export function supplyPeriodAdmission(period: { readonly periodStart?: string | null; readonly periodEnd?: string | null } | null | undefined, today: string): SupplyPeriodAdmission {
  const windowStart = quoteWindowStart(today);
  const refuse = (code: Exclude<SupplyPeriodAdmission, { admitted: true }>["code"]): SupplyPeriodAdmission => ({ admitted: false, code, windowStart, today });
  if (!period || !period.periodStart || !period.periodEnd) return refuse("SOURCE_BILL_PERIOD_MISSING");
  if (!validIsoDate(period.periodStart) || !validIsoDate(period.periodEnd) || period.periodStart > period.periodEnd) return refuse("SOURCE_BILL_PERIOD_INVALID");
  if (period.periodEnd > today) return refuse("SOURCE_BILL_PERIOD_FUTURE");
  if (period.periodStart < windowStart) return refuse("SOURCE_BILL_TOO_OLD");
  return { admitted: true, windowStart, today };
}

/** True when the supply period cannot be quoted on `today` (see supplyPeriodAdmission). */
export function supplyPeriodTooOld(period: { readonly periodStart?: string | null; readonly periodEnd?: string | null }, today: string): boolean {
  return !supplyPeriodAdmission(period, today).admitted;
}
