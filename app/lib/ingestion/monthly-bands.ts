/**
 * Optional, document-backed monthly electricity consumption detail.
 *
 * This is deliberately separate from period aggregate F1/F2/F3 fields:
 * absence means that the source document did not provide monthly detail;
 * zero is a real extracted value and is therefore retained.
 */
export interface StructuredBillMonthlyBand {
  readonly month: string;
  readonly f1: number;
  readonly f2: number;
  readonly f3: number;
}

export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_MONTHLY_BANDS = 120;

export interface BillingPeriodMonthBounds {
  readonly from: string;
  readonly to: string;
}

function validIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2] ? date : null;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function nextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/**
 * Selects complete calendar months represented by a billing period.
 * The returned list is ordered by the billing period and never includes
 * rows outside it. Partial or ambiguous periods fail closed.
 */
export function selectMonthlyBandsForBillingPeriod(billingPeriod: BillingPeriodMonthBounds | null | undefined, value: unknown, path = "monthlyBands"): readonly StructuredBillMonthlyBand[] {
  if (!billingPeriod) fail(`${path}.billingPeriod`, "REQUIRED");
  const from = validIsoDate(billingPeriod.from);
  const to = validIsoDate(billingPeriod.to);
  if (!from || !to || from.getTime() >= to.getTime()) fail(`${path}.billingPeriod`, "VALID_FULL_MONTH_PERIOD_REQUIRED");
  if (from.getUTCDate() !== 1) fail(`${path}.billingPeriod`, "PARTIAL_MONTH_PERIOD");

  // The domain normally uses [from,to); accept an explicit month-end date
  // only when it unambiguously denotes the inclusive end of a full month.
  const endExclusive = to.getUTCDate() === 1
    ? to
    : to.getUTCDate() === new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate()
      ? nextMonth(to)
      : null;
  if (!endExclusive) fail(`${path}.billingPeriod`, "PARTIAL_MONTH_PERIOD");

  const bands = normalizeMonthlyBands(value, path);
  const expected: string[] = [];
  for (let cursor = new Date(from.getTime()); cursor.getTime() < endExclusive.getTime(); cursor = nextMonth(cursor)) {
    expected.push(monthKey(cursor));
    if (expected.length > MAX_MONTHLY_BANDS) fail(path, "TOO_MANY_ITEMS");
  }
  const byMonth = new Map(bands.map((band) => [band.month, band]));
  const selected = expected.map((key) => byMonth.get(key));
  if (selected.some((band) => band === undefined)) fail(path, "MISSING_BILLING_PERIOD_MONTH");
  return selected as StructuredBillMonthlyBand[];
}

export const MONTHLY_BANDS_WIRE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["month", "f1", "f2", "f3"],
    properties: {
      month: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
      f1: { type: "number", description: "Consumo F1 in kWh copiato esattamente dal documento, inclusi tutti i decimali; non arrotondare o troncare." },
      f2: { type: "number", description: "Consumo F2 in kWh copiato esattamente dal documento, inclusi tutti i decimali; non arrotondare o troncare." },
      f3: { type: "number", description: "Consumo F3 in kWh copiato esattamente dal documento, inclusi tutti i decimali; non arrotondare o troncare." },
    },
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function fail(path: string, reason: string): never {
  throw new Error(`BILL_MONTHLY_BANDS_INVALID:${path}:${reason}`);
}

function finiteNonNegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(path, "FINITE_NON_NEGATIVE_NUMBER_REQUIRED");
  return value;
}

export function validateMonthlyBands(value: unknown, path = "monthlyBands"): asserts value is readonly StructuredBillMonthlyBand[] {
  if (!Array.isArray(value)) fail(path, "ARRAY_REQUIRED");
  if (value.length > MAX_MONTHLY_BANDS) fail(path, "TOO_MANY_ITEMS");
  const months = new Set<string>();
  let total = 0;
  for (const [index, candidate] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(candidate)) fail(itemPath, "OBJECT_REQUIRED");
    const keys = Object.keys(candidate).sort();
    if (keys.length !== 4 || keys.join(",") !== "f1,f2,f3,month") fail(itemPath, "UNEXPECTED_PROPERTY");
    if (typeof candidate.month !== "string" || !MONTH_KEY_PATTERN.test(candidate.month)) fail(`${itemPath}.month`, "YYYY_MM_REQUIRED");
    if (months.has(candidate.month)) fail(`${itemPath}.month`, "DUPLICATE_MONTH");
    months.add(candidate.month);
    const f1 = finiteNonNegative(candidate.f1, `${itemPath}.f1`);
    const f2 = finiteNonNegative(candidate.f2, `${itemPath}.f2`);
    const f3 = finiteNonNegative(candidate.f3, `${itemPath}.f3`);
    total += f1 + f2 + f3;
    if (!Number.isFinite(total)) fail(path, "TOTAL_OVERFLOW");
  }
}

export function normalizeMonthlyBands(value: unknown, path = "monthlyBands"): readonly StructuredBillMonthlyBand[] {
  validateMonthlyBands(value, path);
  return value.map((item) => ({ month: item.month, f1: item.f1, f2: item.f2, f3: item.f3 }));
}

/** Returns null when monthly detail is absent or explicitly empty. */
export function analyticalMonthlyTotalKwh(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const bands = normalizeMonthlyBands(value);
  if (bands.length === 0) return null;
  const total = bands.reduce((sum, band) => sum + band.f1 + band.f2 + band.f3, 0);
  return Number.isFinite(total) ? total : null;
}

export type MonthlyDisplayReconciliation = "PASS" | "NOT_AVAILABLE" | "FAIL_CLOSED";

/** Supplier display totals are accepted only when they equal the exact total or its integer display rounding. */
export function reconcileAnalyticalToDisplay(analytical: number | null, display: number | null): MonthlyDisplayReconciliation {
  if (analytical === null || display === null) return "NOT_AVAILABLE";
  if (!Number.isFinite(analytical) || !Number.isFinite(display)) return "FAIL_CLOSED";
  return display === analytical || Number.isInteger(display) && display === Math.round(analytical) ? "PASS" : "FAIL_CLOSED";
}

export function monthlyBandsEqual(left: readonly StructuredBillMonthlyBand[] | undefined, right: readonly StructuredBillMonthlyBand[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  const rightByMonth = new Map(right.map((band) => [band.month, band]));
  return left.length === right.length && left.every((band) => {
    const other = rightByMonth.get(band.month);
    return other?.month === band.month && other.f1 === band.f1 && other.f2 === band.f2 && other.f3 === band.f3;
  });
}
