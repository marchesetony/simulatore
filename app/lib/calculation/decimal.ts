export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const NEGATIVE_ONE = BigInt(-1);
const TWO = BigInt(2);
const TEN = BigInt(10);

function gcd(left: bigint, right: bigint): bigint {
  let a = left < ZERO ? -left : left;
  let b = right < ZERO ? -right : right;
  while (b !== ZERO) { const next = a % b; a = b; b = next; }
  return a === ZERO ? ONE : a;
}

function normalize(numerator: bigint, denominator: bigint): Rational {
  if (denominator === ZERO) throw new Error("DECIMAL_DIVISION_BY_ZERO");
  const sign = denominator < ZERO ? NEGATIVE_ONE : ONE;
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: (denominator / divisor) * sign };
}

export const rational = (numerator: bigint, denominator = ONE): Rational => normalize(numerator, denominator);
export const zero = (): Rational => ({ numerator: ZERO, denominator: ONE });

export function fromNumber(value: number): Rational {
  if (!Number.isFinite(value)) throw new Error("DECIMAL_NUMBER_INVALID");
  const text = value.toString().toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const exponent = exponentText ? Number.parseInt(exponentText, 10) : 0;
  const negative = coefficient.startsWith("-");
  const unsigned = negative || coefficient.startsWith("+") ? coefficient.slice(1) : coefficient;
  const parts = unsigned.split(".");
  const digits = `${parts[0] ?? "0"}${parts[1] ?? ""}`;
  const decimalPlaces = (parts[1]?.length ?? 0) - exponent;
  let numerator = BigInt(digits || "0") * (negative ? NEGATIVE_ONE : ONE);
  let denominator = ONE;
  if (decimalPlaces >= 0) denominator = TEN ** BigInt(decimalPlaces);
  else numerator *= TEN ** BigInt(-decimalPlaces);
  return normalize(numerator, denominator);
}

export const add = (left: Rational, right: Rational): Rational => normalize(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
export const negate = (value: Rational): Rational => ({ numerator: -value.numerator, denominator: value.denominator });
export const subtract = (left: Rational, right: Rational): Rational => add(left, negate(right));
export const multiply = (left: Rational, right: Rational): Rational => normalize(left.numerator * right.numerator, left.denominator * right.denominator);
export const divide = (left: Rational, right: Rational): Rational => normalize(left.numerator * right.denominator, left.denominator * right.numerator);
export const equals = (left: Rational, right: Rational): boolean => left.numerator === right.numerator && left.denominator === right.denominator;

function roundSigned(value: Rational, scale: bigint): bigint {
  const numerator = value.numerator * scale;
  const sign = numerator < ZERO ? NEGATIVE_ONE : ONE;
  const absolute = numerator < ZERO ? -numerator : numerator;
  let result = absolute / value.denominator;
  if ((absolute % value.denominator) * TWO >= value.denominator) result += ONE;
  return result * sign;
}

export function roundCents(value: Rational): number {
  const result = roundSigned(value, BigInt(100));
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("CALCULATION_AMOUNT_OVERFLOW");
  return Number(result);
}

export function minorToMoney(minorUnits: number): { readonly amount: number; readonly minorUnits: number; readonly currency: "EUR" } {
  return { amount: minorUnits / 100, minorUnits, currency: "EUR" };
}

export function toDecimal(value: Rational, decimalPlaces = 6): number {
  const scale = TEN ** BigInt(decimalPlaces);
  const rounded = roundSigned(value, scale);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("CALCULATION_AMOUNT_OVERFLOW");
  return Number(rounded) / Number(scale);
}
