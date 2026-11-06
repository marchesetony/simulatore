// Corrispettivo di dispacciamento (TIDE) for customers on the free market other than households: Terna publishes one
// value per quarter in c€/kWh, net of network losses (TIS Tabella 4), and CTEs pass it through ("corrispettivi di
// dispacciamento ... attualmente pari a 0,01155 €/kWh" in Be Smart is that value grossed up by 10%). Tony (28/10): "il
// valore terna lo abbiamo ... controlla": the BPower bill for September 2026 bills 0,010501 €/kWh, the 3° trimestre 2026
// value read from Terna's document. The refresh reads every new quarter from Terna (regulatory-refresh/terna.ts) and its
// stored values take precedence; this table is the fallback checked against Terna's document.

export interface TernaTideQuarter { readonly from: string; readonly to: string; readonly centsPerKwh: number; readonly reference: string; readonly url: string }

export const TERNA_TIDE_DISPATCHING_QUARTERS: readonly TernaTideQuarter[] = [
  { from: "2026-07-01", to: "2026-10-01", centsPerKwh: 1.0501, reference: "Terna, corrispettivi di dispacciamento TIDE 3° trimestre 2026", url: "https://dati.terna.it/corrispettivi" },
];

/** Stored Terna TIDE totals (DISPATCHING_TOTAL, variant TIDE) over the table, by quarter start. */
export function mergeTernaTideQuarters(stored: readonly { readonly componentCode: string; readonly regulatoryVariant?: string; readonly normalizedUnit: string; readonly normalizedValue: number; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly officialIdentifier: string; readonly sourceReference: string }[]): readonly TernaTideQuarter[] {
  const fromArchive = new Map<string, TernaTideQuarter>();
  for (const record of stored) {
    if (record.componentCode !== "DISPATCHING_TOTAL" || record.regulatoryVariant !== "TIDE" || record.normalizedUnit !== "EUR/KWH" || record.effectiveTo === null) continue;
    const from = record.effectiveFrom.slice(0, 10);
    fromArchive.set(from, { from, to: record.effectiveTo.slice(0, 10), centsPerKwh: Math.round(record.normalizedValue * 1e9) / 1e7, reference: record.officialIdentifier, url: record.sourceReference });
  }
  return [...fromArchive.values(), ...TERNA_TIDE_DISPATCHING_QUARTERS.filter((item) => !fromArchive.has(item.from))].sort((left, right) => left.from.localeCompare(right.from));
}

const DAY = 86_400_000;

/** The value in €/kWh for a period (start inclusive, end exclusive), weighted by days; null if a day is not covered. */
export function ternaTideForPeriod(periodStart: string, periodEnd: string, quarters: readonly TernaTideQuarter[] = TERNA_TIDE_DISPATCHING_QUARTERS): { readonly eurPerKwh: number; readonly quarters: readonly TernaTideQuarter[] } | null {
  const start = Date.parse(periodStart.slice(0, 10)); const end = Date.parse(periodEnd.slice(0, 10));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  let weighted = 0; const used: TernaTideQuarter[] = [];
  for (let cursor = start; cursor < end;) {
    const quarter = quarters.find((item) => Date.parse(item.from) <= cursor && cursor < Date.parse(item.to));
    if (!quarter) return null;
    const next = Math.min(end, Date.parse(quarter.to));
    weighted += quarter.centsPerKwh / 100 * (next - cursor) / DAY;
    if (!used.includes(quarter)) used.push(quarter);
    cursor = next;
  }
  return { eurPerKwh: weighted / ((end - start) / DAY), quarters: used };
}
