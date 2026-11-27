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

/**
 * Validated history in calendar order; throws on a malformed entry. Tony (12/11/2026, "non scartare silenziosamente mesi
 * duplicati o contraddittori"): a month repeated with the same value is kept once (the same consumption is never counted
 * twice); a month repeated with different values keeps every value, so the estimate sees the contradiction
 * (calculation/annual-consumption.ts, assessConsumptionHistory) and does not use the history.
 */
export function normalizeConsumptionHistory(value: unknown): readonly ConsumptionHistoryMonth[] {
  if (!Array.isArray(value) || value.length > MAX_MONTHS) throw new Error("CONSUMPTION_HISTORY_INVALID");
  const byMonth = new Map<string, number[]>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("CONSUMPTION_HISTORY_INVALID");
    const { month, quantity } = item as Record<string, unknown>;
    if (typeof month !== "string" || !MONTH.test(month) || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) throw new Error("CONSUMPTION_HISTORY_INVALID");
    const values = byMonth.get(month) ?? [];
    if (!values.includes(quantity)) byMonth.set(month, [...values, quantity]);
  }
  return [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([month, quantities]) => quantities.map((quantity) => ({ month, quantity })));
}
