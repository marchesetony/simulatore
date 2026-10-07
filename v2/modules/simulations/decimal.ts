import { block } from "./types";

/** Exact rational arithmetic. V1 decimal.ts principle, fed decimal strings rather than Number. */
export interface Rational { readonly n: bigint; readonly d: bigint }
export function decimal(value: string): Rational {
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return { n: BigInt(whole + fraction) * BigInt(value.startsWith("-") ? -1 : 1), d: BigInt(10) ** BigInt(fraction.length) };
}
export const integer = (value: number): Rational => ({ n: BigInt(value), d: BigInt(1) });
export const add = (a: Rational, b: Rational): Rational => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
export const multiply = (a: Rational, b: Rational): Rational => ({ n: a.n * b.n, d: a.d * b.d });
export const divide = (a: Rational, b: Rational): Rational => ({ n: a.n * b.d, d: a.d * b.n });
export function rounded(value: Rational, scale: number): bigint {
  const negative = value.n < BigInt(0);
  const numerator = (negative ? -value.n : value.n) * BigInt(scale);
  const quotient = numerator / value.d;
  const halfUp = numerator % value.d * BigInt(2) >= value.d ? BigInt(1) : BigInt(0);
  return (quotient + halfUp) * BigInt(negative ? -1 : 1);
}
export function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return block("AMOUNT_OUT_OF_RANGE");
  return Number(value);
}
export const cents = (value: Rational): number => safe(rounded(value, 100));
export function percentage(saving: number, current: number): string | null {
  if (current <= 0) return null;
  const value = rounded({ n: BigInt(saving) * BigInt(100), d: BigInt(current) }, 100);
  const magnitude = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`;
}
