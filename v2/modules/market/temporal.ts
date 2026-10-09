import { fail } from "./errors";
import { object } from "./primitives";

export interface Period { readonly validFrom: string; readonly validTo: string }
export function date(value: unknown): string {
  if (typeof value !== "string" || !/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return fail("INVALID_INPUT");
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return fail("INVALID_INPUT");
  return value;
}
export function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail("INVALID_INPUT");
  date(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail("INVALID_INPUT");
  return value;
}
export function period(value: unknown): Period {
  const row = object(value, ["validFrom", "validTo"]), validFrom = date(row.validFrom), validTo = date(row.validTo);
  if (validFrom > validTo) return fail("INVALID_INPUT");
  return { validFrom, validTo };
}
export function month(value: unknown): string {
  if (typeof value !== "string" || !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value)) return fail("INVALID_INPUT");
  return value;
}
export function months(coverage: Period): readonly string[] {
  const p = period(coverage), result: string[] = [];
  for (let current = p.validFrom.slice(0, 7); current <= p.validTo.slice(0, 7);) {
    result.push(current);
    current = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5)), 1)).toISOString().slice(0, 7);
  }
  return result;
}
/** Inclusive coverage, without pro-rata or conversion from V1 intervals. */
export function completeCoverage(required: Period, segments: readonly Period[]): void {
  const target = period(required), rows = segments.map(period).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let cursor = Date.parse(target.validFrom);
  const end = Date.parse(target.validTo);
  for (const row of rows) {
    const from = Math.max(Date.parse(row.validFrom), Date.parse(target.validFrom));
    const to = Math.min(Date.parse(row.validTo), end);
    if (from > to) return fail("INVALID_INPUT");
    if (from < cursor) return fail("OVERLAP");
    if (from > cursor) return fail("GAP");
    cursor = to + 86400000;
  }
  if (cursor !== end + 86400000) fail("GAP");
}
