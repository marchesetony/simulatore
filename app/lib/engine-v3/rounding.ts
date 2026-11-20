import { rational, type Rational } from "./rational";

/**
 * Motore V3: the one monetary rounding of the engine. Each component's exact amount is rounded once, to the euro cent, half
 * away from zero (arrotondamento commerciale, as the bills print their lines). Totals, the VAT base and the reconciliation sum
 * rounded component amounts and are never rounded again; no intermediate value is rounded.
 */
export const MONEY_ROUNDING = { currency: "EUR", decimals: 2, mode: "HALF_AWAY_FROM_ZERO", appliedTo: "each component amount, once" } as const;

const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);

/** Integer euro cents of an exact amount. */
export function roundToCents(amount: Rational): number {
  const scaled = amount.n * HUNDRED;
  const negative = scaled < ZERO;
  const magnitude = negative ? -scaled : scaled;
  let cents = magnitude / amount.d;
  if ((magnitude % amount.d) * TWO >= amount.d) cents += BigInt(1);
  const value = Number(negative ? -cents : cents);
  if (!Number.isSafeInteger(value)) throw new Error("V3_AMOUNT_OUT_OF_RANGE");
  return value;
}

export const centsToRational = (cents: number): Rational => rational(BigInt(cents), HUNDRED);
export const centsToEuro = (cents: number): number => cents / 100;
export const sumCents = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
/** "1.234,56" style text for reports. */
export function formatCents(cents: number): string {
  const negative = cents < 0; const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "−" : ""}${whole},${String(abs % 100).padStart(2, "0")}`;
}
