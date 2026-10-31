// A quote may only rest on recent facts: the supply period of the bill must fall
// within the last QUOTE_WINDOW_MONTHS before the quote date.
export const QUOTE_WINDOW_MONTHS = 4;

/** The earliest date a quote dated `asOf` (YYYY-MM-DD) may draw on. */
export function quoteWindowStart(asOf: string, months = QUOTE_WINDOW_MONTHS): string {
  const [year, month, day] = asOf.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** True when part of the supply period lies before the quote window. */
export function supplyPeriodTooOld(period: { readonly periodStart: string }, asOf: string): boolean {
  return period.periodStart < quoteWindowStart(asOf);
}
