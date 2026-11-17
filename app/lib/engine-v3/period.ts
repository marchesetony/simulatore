import { add, integer, R0, rational, type Rational } from "./rational";

/**
 * Motore V3: months of a supply period, as an exact fraction. Each calendar month counts days supplied / days of that
 * month; a whole month is 1. Annual tariffs (€/anno) are applied as 1/12 per month: verified on 070789E (ottobre 2026,
 * BTA6 quota potenza 32,9297 €/kW/anno × 4 kW / 12 = 10,98 € as billed, while 31/365 would give 11,19 €).
 */
const DAY = 86_400_000;

function parseDay(text: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`V3_INVALID_DATE:${text}`);
  const value = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(value)) throw new Error(`V3_INVALID_DATE:${text}`);
  return value;
}

export interface V3MonthShare { readonly month: string; readonly days: number; readonly daysInMonth: number; readonly fraction: Rational }

/** Calendar months touched by [start, endExclusive), with the days supplied in each. */
export function monthShares(start: string, endExclusive: string): readonly V3MonthShare[] {
  const from = parseDay(start); const to = parseDay(endExclusive);
  if (to <= from) throw new Error("V3_EMPTY_PERIOD");
  const shares: V3MonthShare[] = [];
  let cursor = from;
  while (cursor < to) {
    const date = new Date(cursor);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const daysInMonth = Math.round((nextMonth - Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)) / DAY);
    const end = Math.min(nextMonth, to);
    const days = Math.round((end - cursor) / DAY);
    shares.push({ month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, days, daysInMonth, fraction: rational(BigInt(days), BigInt(daysInMonth)) });
    cursor = end;
  }
  return shares;
}

export function monthsIn(start: string, endExclusive: string): Rational {
  return monthShares(start, endExclusive).reduce((total, share) => add(total, share.fraction), R0);
}

export const TWELVE = integer(12);
