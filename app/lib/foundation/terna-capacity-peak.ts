// Corrispettivo mercato capacità for supplies other than BT up to 55 kW (BT above 55 kW, MT, AT; TIV comma 34.8 bis):
// Terna publishes per quarter one unit charge for the kWh withdrawn in its peak hours and one for the other hours, in
// €/MWh net of network losses. Tony (30/10): "errore su come calcolare il capacity": the charge is computed, never left
// out. The refresh stores the values for the scopes of its registry (regulatory-refresh/registry.ts); the rates are the
// same for every customer outside the TIV, so any stored scope serves a supply whose own scope has none (MT, AT), and no
// new scope is stored.

export interface TernaCapacityQuarter { readonly from: string; readonly to: string; readonly peakEurPerKwh: number | null; readonly offPeakEurPerKwh: number | null; readonly reference: string; readonly url: string }

type StoredCapacity = { readonly authority?: string; readonly componentCode: string; readonly normalizedUnit: string; readonly normalizedValue: number; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly officialIdentifier: string; readonly sourceReference: string; readonly retrievedAt?: string };

/** Stored Terna capacity charges (CAPACITY_MARKET_PEAK / _OFF_PEAK, any scope) by quarter start; the latest reading wins. */
export function mergeTernaCapacityQuarters(stored: readonly StoredCapacity[]): readonly TernaCapacityQuarter[] {
  const byQuarter = new Map<string, { to: string; peak: StoredCapacity | null; offPeak: StoredCapacity | null }>();
  const newer = (left: StoredCapacity | null, right: StoredCapacity) => left === null || (right.retrievedAt ?? "") >= (left.retrievedAt ?? "") ? right : left;
  for (const record of stored) {
    if ((record.authority !== undefined && record.authority !== "TERNA") || record.normalizedUnit !== "EUR/KWH" || record.effectiveTo === null || !Number.isFinite(record.normalizedValue) || record.normalizedValue <= 0) continue;
    if (record.componentCode !== "CAPACITY_MARKET_PEAK" && record.componentCode !== "CAPACITY_MARKET_OFF_PEAK") continue;
    const from = record.effectiveFrom.slice(0, 10);
    const entry = byQuarter.get(from) ?? { to: record.effectiveTo.slice(0, 10), peak: null, offPeak: null };
    if (record.componentCode === "CAPACITY_MARKET_PEAK") entry.peak = newer(entry.peak, record); else entry.offPeak = newer(entry.offPeak, record);
    byQuarter.set(from, entry);
  }
  return [...byQuarter.entries()].map(([from, entry]) => ({ from, to: entry.to, peakEurPerKwh: entry.peak?.normalizedValue ?? null, offPeakEurPerKwh: entry.offPeak?.normalizedValue ?? null, reference: (entry.peak ?? entry.offPeak)?.officialIdentifier ?? "TERNA", url: (entry.peak ?? entry.offPeak)?.sourceReference ?? "" })).sort((left, right) => left.from.localeCompare(right.from));
}

const DAY = 86_400_000;

/** Peak and off-peak €/kWh for a period (start inclusive, end exclusive), weighted by days; null if a day lacks either. */
export function ternaCapacityForPeriod(periodStart: string, periodEnd: string, quarters: readonly TernaCapacityQuarter[]): { readonly peakEurPerKwh: number; readonly offPeakEurPerKwh: number; readonly quarters: readonly TernaCapacityQuarter[] } | null {
  const start = Date.parse(periodStart.slice(0, 10)); const end = Date.parse(periodEnd.slice(0, 10));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  let peak = 0; let offPeak = 0; const used: TernaCapacityQuarter[] = [];
  for (let cursor = start; cursor < end;) {
    const quarter = quarters.find((item) => Date.parse(item.from) <= cursor && cursor < Date.parse(item.to));
    if (!quarter || quarter.peakEurPerKwh === null || quarter.offPeakEurPerKwh === null) return null;
    const next = Math.min(end, Date.parse(quarter.to));
    peak += quarter.peakEurPerKwh * (next - cursor) / DAY; offPeak += quarter.offPeakEurPerKwh * (next - cursor) / DAY;
    if (!used.includes(quarter)) used.push(quarter);
    cursor = next;
  }
  const days = (end - start) / DAY;
  return { peakEurPerKwh: peak / days, offPeakEurPerKwh: offPeak / days, quarters: used };
}

/** Tony (30/10): "la regola dovrebbe esssere il prezzo massimo del mese su tutto il mese di riferimento". The highest Terna
 *  capacity rate in force in a month (YYYY-MM), for the kWh of a bill that does not print the peak-hour kWh. */
export function ternaCapacityMonthMax(month: string, quarters: readonly TernaCapacityQuarter[]): { readonly eurPerKwh: number; readonly quarters: readonly TernaCapacityQuarter[] } | null {
  const start = Date.parse(`${month}-01`);
  if (!Number.isFinite(start)) return null;
  const date = new Date(start); const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const used = quarters.filter((item) => Date.parse(item.from) < end && start < Date.parse(item.to));
  // Every day of the month must be covered by a published quarter.
  for (let cursor = start; cursor < end; cursor += DAY) if (!used.some((item) => Date.parse(item.from) <= cursor && cursor < Date.parse(item.to))) return null;
  const rates = used.flatMap((item) => [item.peakEurPerKwh, item.offPeakEurPerKwh]).filter((value): value is number => value !== null);
  return rates.length ? { eurPerKwh: Math.max(...rates), quarters: used } : null;
}
