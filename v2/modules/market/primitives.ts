import { fail } from "./errors";

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_INPUT");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(row, key))) return fail("INVALID_INPUT");
  return row;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) return fail("INVALID_INPUT");
  return value.trim();
}
export function choice<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === "string" && options.includes(value as T) ? value as T : fail("INVALID_INPUT");
}
export function list<T>(value: unknown, parse: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > 10000) return fail("INVALID_INPUT");
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i) || value[i] === null || value[i] === undefined) return fail("INVALID_INPUT");
  }
  return value.map(parse);
}
export function distinct(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail("DUPLICATE_IDENTITY");
}
export function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value)) return fail("INVALID_INPUT");
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(/^-0$/, "0");
}
export function hashText(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return fail("INVALID_INPUT");
  return value;
}
