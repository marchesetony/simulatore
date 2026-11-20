import type { ConsumptionHistoryMonth } from "../ingestion/consumption-history";

// Tony (29/10): business CTEs are chosen on the annual consumption. When the bill does not print it, the annual
// consumption is the average monthly consumption the bill shows, times 12.
// Tony (12/11/2026, "CONSUMO ANNUO STIMATO", opzione B): (1) the annual consumption printed on the bill comes first; (2) else
// the valid monthly history, average × 12; (3) else the billed consumption annualised on the months the period lasts; (4)
// otherwise no value. The estimate is never the declared annual consumption: it is kept apart, at full precision (rounded
// only on screen), always shown as "CONSUMO ANNUO STIMATO — non rappresenta un consumo annuo effettivo" with its origin and
// the months or period it comes from. History checks: a month repeated with different values makes the history unreliable
// (never dropped silently), a month repeated with the same value counts once, a month at 0 kWh counts, missing months are
// reported, a history without any consumption is not used.
const MONTH_DAYS = 365.25 / 12;
const HISTORY_MONTHS = 12;

export const ANNUAL_ESTIMATE_LABEL = "CONSUMO ANNUO STIMATO — non rappresenta un consumo annuo effettivo";

/** Months a billing period covers, counting both ends; null when the period is too short to stand for a month. */
export function billedMonths(periodStart: string, periodEnd: string): number | null {
  const days = (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86_400_000 + 1;
  if (!Number.isFinite(days) || days < 20) return null;
  return Math.max(1, Math.round(days / MONTH_DAYS));
}

export interface ConsumptionHistoryAssessment {
  readonly usable: boolean;
  /** The months used, oldest first: the latest twelve, each once. */
  readonly months: readonly ConsumptionHistoryMonth[];
  /** Why the history is not usable, or what it lacks (missing months), in Italian. */
  readonly issues: readonly string[];
}

const nextMonth = (month: string): string => {
  const [year, value] = month.split("-").map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, "0")}`;
};

/** Checks the history month by month: repetitions, contradictions, gaps, months without consumption. */
export function assessConsumptionHistory(history: readonly ConsumptionHistoryMonth[] | null | undefined): ConsumptionHistoryAssessment {
  const entries = (history ?? []).filter((item) => /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) && Number.isFinite(item.quantity) && item.quantity >= 0);
  if (!entries.length) return { usable: false, months: [], issues: history?.length ? ["storico consumi senza mesi validi"] : [] };
  const byMonth = new Map<string, number[]>();
  for (const item of entries) byMonth.set(item.month, [...(byMonth.get(item.month) ?? []), item.quantity]);
  const issues: string[] = [];
  const contradictory = [...byMonth.entries()].filter(([, values]) => new Set(values).size > 1);
  for (const [month, values] of contradictory) issues.push(`mese ${month} ripetuto nello storico con valori diversi (${[...new Set(values)].join(" e ")}): storico non attendibile`);
  const months = [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-HISTORY_MONTHS).map(([month, values]) => ({ month, quantity: values[0] }));
  const missing: string[] = [];
  for (let index = 1; index < months.length; index += 1) for (let month = nextMonth(months[index - 1].month); month < months[index].month; month = nextMonth(month)) missing.push(month);
  if (missing.length) issues.push(`mesi mancanti nello storico: ${missing.join(", ")}`);
  if (contradictory.length) return { usable: false, months: [], issues };
  if (months.every((item) => item.quantity === 0)) return { usable: false, months: [], issues: [...issues, "storico consumi senza consumi"] };
  return { usable: true, months, issues };
}

export interface AnnualConsumption {
  readonly status: "DECLARED" | "ESTIMATED" | "NOT_DETERMINABLE";
  readonly source: "DECLARED" | "HISTORY" | "BILLED_MONTHS" | "BILLED_PERIOD" | null;
  /** Full precision: rounded only when shown. */
  readonly value: number | null;
  /** The months the estimate averages (history or the bill's own months), oldest first. */
  readonly months: readonly string[];
  /** The billed period the estimate annualises, with the months it lasts. */
  readonly period: { readonly start: string; readonly end: string; readonly months: number } | null;
  /** The consumption the estimate starts from (sum of the months, or the billed consumption). */
  readonly basisTotal: number | null;
  readonly issues: readonly string[];
}

/** The annual consumption of a bill: printed, else estimated from the history, else from the billed period, else none. */
export function resolveAnnualConsumption(input: {
  readonly declared: number | null;
  readonly billed: number | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly history?: readonly ConsumptionHistoryMonth[] | null;
  /** The bill's own months of the billed period (monthly bands), when it lists them. */
  readonly billedMonthTotals?: readonly ConsumptionHistoryMonth[] | null;
}): AnnualConsumption {
  if (input.declared !== null && Number.isFinite(input.declared) && input.declared > 0) return { status: "DECLARED", source: "DECLARED", value: input.declared, months: [], period: null, basisTotal: null, issues: [] };
  const history = assessConsumptionHistory(input.history);
  if (history.usable) {
    const total = history.months.reduce((sum, item) => sum + item.quantity, 0);
    return { status: "ESTIMATED", source: "HISTORY", value: total / history.months.length * 12, months: history.months.map((item) => item.month), period: null, basisTotal: total, issues: history.issues };
  }
  const own = (input.billedMonthTotals ?? []).filter((item) => Number.isFinite(item.quantity) && item.quantity >= 0);
  if (own.length && own.some((item) => item.quantity > 0)) {
    const total = own.reduce((sum, item) => sum + item.quantity, 0);
    return { status: "ESTIMATED", source: "BILLED_MONTHS", value: total / own.length * 12, months: own.map((item) => item.month), period: null, basisTotal: total, issues: history.issues };
  }
  const count = input.periodStart && input.periodEnd ? billedMonths(input.periodStart, input.periodEnd) : null;
  if (input.billed !== null && Number.isFinite(input.billed) && input.billed > 0 && count !== null && input.periodStart && input.periodEnd) {
    return { status: "ESTIMATED", source: "BILLED_PERIOD", value: input.billed / count * 12, months: [], period: { start: input.periodStart, end: input.periodEnd, months: count }, basisTotal: input.billed, issues: history.issues };
  }
  return { status: "NOT_DETERMINABLE", source: null, value: null, months: [], period: null, basisTotal: null, issues: [...history.issues, "dati insufficienti per stimare il consumo annuo"] };
}

