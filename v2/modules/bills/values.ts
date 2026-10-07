import { BillError, type Period } from "./types";

export const MAX_CENTS = 100_000_000_000;
export function invalid(): never { throw new BillError("INVALID_INPUT"); }
export function strictObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(row, key))) return invalid();
  return row;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) return invalid();
  return value.toLowerCase();
}
export function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return invalid();
  return value.trim();
}
export function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) return invalid();
  return value as T;
}
export function date(value: unknown): string {
  if (typeof value !== "string" || !/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return invalid();
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return invalid();
  return value;
}
/** Both endpoints inclusive. A one-day period is valid. */
export function period(row: Record<string, unknown>): Period {
  const periodStart = date(row.periodStart), periodEnd = date(row.periodEnd);
  if (periodStart > periodEnd) return invalid();
  return { periodStart, periodEnd };
}
export function cents(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > MAX_CENTS) return invalid();
  return Object.is(value, -0) ? 0 : value;
}
export function decimal(value: unknown, scale: number, signed = false): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 24 ||
      !new RegExp(`^${signed ? "-?" : ""}(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,${scale}})?$`).test(value)) return invalid();
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(/^-0$/, "0");
}
export function scaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (BigInt(whole) * BigInt(10) ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"))) * BigInt(negative ? -1 : 1);
}
/** UI boundary: no floating point multiplication for monetary input. */
export function eurosToCents(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = decimal(value.trim().replace(",", "."), 2, true);
  if (normalized === null) return null;
  return cents(Number(scaled(normalized, 2)));
}
