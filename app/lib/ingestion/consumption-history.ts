// Tony (30/10, "bisogna usare lo storico consumi"): the consumption history printed on the bill (the last months' kWh or
// Smc, as a table or chart) is read month by month, so the annual consumption can be averaged on it when not printed.
export interface ConsumptionHistoryMonth {
  readonly month: string;
  readonly quantity: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 36;

export const CONSUMPTION_HISTORY_WIRE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["month", "quantity"],
    properties: {
      month: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
      quantity: { type: "number", description: "Consumo totale del mese (kWh per la luce, Smc per il gas) copiato dallo storico consumi della bolletta." },
    },
  },
} as const;

/** Validated history, one entry per month in calendar order; throws on a malformed entry. */
export function normalizeConsumptionHistory(value: unknown): readonly ConsumptionHistoryMonth[] {
  if (!Array.isArray(value) || value.length > MAX_MONTHS) throw new Error("CONSUMPTION_HISTORY_INVALID");
  const byMonth = new Map<string, number>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("CONSUMPTION_HISTORY_INVALID");
    const { month, quantity } = item as Record<string, unknown>;
    if (typeof month !== "string" || !MONTH.test(month) || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) throw new Error("CONSUMPTION_HISTORY_INVALID");
    if (!byMonth.has(month)) byMonth.set(month, quantity);
  }
  return [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, quantity]) => ({ month, quantity }));
}

/** The latest twelve months with a consumption, the basis of the monthly average. */
export function historyMonthTotals(history: readonly ConsumptionHistoryMonth[] | null | undefined): readonly number[] {
  return (history ?? []).filter((item) => item.quantity > 0).slice(-12).map((item) => item.quantity);
}
