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

// Tony (2/11, a bimonthly Enel bill luglio-agosto refused on 2 November: "perchè"): the bill's date is the end of its supply
// period, as for the 4-month archive (Tony 1/11). A bill of two months is usable while its last month is within the window;
// only its start falling before the window no longer discards it.
/** True when the supply period ended before the quote window (its start when no end is known). */
export function supplyPeriodTooOld(period: { readonly periodStart: string; readonly periodEnd?: string | null }, asOf: string): boolean {
  return (period.periodEnd || period.periodStart) < quoteWindowStart(asOf);
}
