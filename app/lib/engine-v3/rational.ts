/**
 * Motore V3 (Tony, 16/11/2026, "Ricostruzione motore economico V3"): exact arithmetic. Every quantity, price and amount is a
 * fraction of two integers, so no binary floating point enters a calculation and the only rounding of the engine is the one
 * in rounding.ts. Values enter as decimal strings ("0,009888" or "0.009888"), never as JavaScript numbers.
 */
export interface Rational { readonly n: bigint; readonly d: bigint }

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

function gcd(a: bigint, b: bigint): bigint {
  let x = a < ZERO ? -a : a; let y = b < ZERO ? -b : b;
  while (y !== ZERO) { const t = x % y; x = y; y = t; }
  return x === ZERO ? ONE : x;
}

export function rational(n: bigint, d: bigint = ONE): Rational {
  if (d === ZERO) throw new Error("V3_DIVISION_BY_ZERO");
  const sign = d < ZERO ? -ONE : ONE;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
}

/** A decimal written by a person or an official table: digits, one optional decimal separator ("," or "."), optional sign. */
export function parseDecimal(text: string): Rational {
  const clean = text.trim().replace(/\s/g, "");
  const match = /^([+-]?)(\d+)(?:[.,](\d+))?$/.exec(clean);
  if (!match) throw new Error(`V3_INVALID_DECIMAL:${text}`);
  const decimals = match[3] ?? "";
  const n = BigInt(`${match[2]}${decimals}`) * (match[1] === "-" ? -ONE : ONE);
  return rational(n, TEN ** BigInt(decimals.length));
}

export function integer(value: number): Rational {
  if (!Number.isSafeInteger(value)) throw new Error(`V3_NOT_AN_INTEGER:${value}`);
  return rational(BigInt(value));
}

export const R0 = rational(ZERO);
export const R1 = rational(ONE);

export const add = (a: Rational, b: Rational): Rational => rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational => rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational): Rational => rational(a.n * b.d, a.d * b.n);
export const neg = (a: Rational): Rational => rational(-a.n, a.d);
export const cmp = (a: Rational, b: Rational): number => { const left = a.n * b.d; const right = b.n * a.d; return left === right ? 0 : left < right ? -1 : 1; };
export const isZero = (a: Rational): boolean => a.n === ZERO;
export const sum = (values: readonly Rational[]): Rational => values.reduce(add, R0);
export const min = (a: Rational, b: Rational): Rational => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Rational, b: Rational): Rational => (cmp(a, b) >= 0 ? a : b);

/** Exact decimal text when the fraction terminates within `limit` digits, else the value truncated with "…". For display and audit only. */
export function toDecimalString(value: Rational, limit = 12): string {
  const negative = value.n < ZERO;
  const n = negative ? -value.n : value.n;
  const whole = n / value.d;
  let rest = n % value.d;
  let digits = "";
  while (rest !== ZERO && digits.length < limit) { rest *= TEN; digits += (rest / value.d).toString(); rest %= value.d; }
  const text = `${negative ? "-" : ""}${whole.toString()}${digits ? `.${digits}` : ""}`;
  return rest === ZERO ? text : `${text}…`;
}
