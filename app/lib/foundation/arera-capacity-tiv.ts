// Corrispettivo mercato capacità for low-voltage supplies up to 55 kW: ARERA fixes one value per month in the quarterly
// update of the TIV (art. 4.1 of each "Aggiornamento, per il trimestre ..." resolution, commi 34.8, 41.9 and 48.9 TIV),
// in c€/kWh net of network losses, which apply with TIS Tabella 4. Free-market CTEs pass it through (Be Smart: "comma
// 34.8 bis del TIV così come definito ed aggiornato dall'ARERA"). Tony (27/10): the BPower bill for September 2026 bills
// 0,3197 c€/kWh on the kWh grossed up by 10%, the value of 219/2026/R/eel. The refresh reads every new resolution from
// ARERA on its own (regulatory-refresh/arera-capacity.ts) and its stored values take precedence; this table is the
// fallback checked by hand against each PDF, so a quote never stops while ARERA's site is unreachable.

export interface AreraCapacityMonth { readonly month: string; readonly centsPerKwh: number; readonly resolution: string; readonly url: string }

const at = (resolution: string, url: string, values: Readonly<Record<string, number>>): readonly AreraCapacityMonth[] =>
  Object.entries(values).map(([month, centsPerKwh]) => ({ month, centsPerKwh, resolution, url }));

export const ARERA_TIV_CAPACITY_MONTHS: readonly AreraCapacityMonth[] = [
  ...at("428/2025/R/eel art. 4.1", "https://www.arera.it/fileadmin/allegati/docs/25/428-2025-R-eel.pdf", { "2025-10": 0.4275, "2025-11": 0.4275, "2025-12": 0.8189 }),
  ...at("586/2025/R/eel art. 4.1", "https://www.arera.it/fileadmin/allegati/docs/25/586-2025-R-eel.pdf", { "2026-01": 1.2345, "2026-02": 1.0583, "2026-03": 0.4349 }),
  ...at("96/2026/R/eel art. 4.1", "https://www.arera.it/fileadmin/allegati/docs/26/96-2026-R-eel.pdf", { "2026-04": 0.3619, "2026-05": 0.3619, "2026-06": 0.7593 }),
  ...at("219/2026/R/eel art. 4.1", "https://www.arera.it/fileadmin/allegati/docs/26/219-2026-R-eel.pdf", { "2026-07": 2.4466, "2026-08": 0.6288, "2026-09": 0.3197 }),
  ...at("338/2026/R/eel art. 4.1", "https://www.arera.it/fileadmin/allegati/docs/26/338-2026-R-eel.pdf", { "2026-10": 0.3423, "2026-11": 0.3423, "2026-12": 0.9243 }),
];

const DAY = 86_400_000;

/** The months the archive holds from the automatic refresh (CAPACITY_MARKET, ALL_ELECTRICITY, monthly), over the table. */
export function mergeAreraCapacityMonths(stored: readonly { readonly componentCode: string; readonly customerScope: string; readonly normalizedUnit: string; readonly normalizedValue: number; readonly effectiveFrom: string; readonly officialIdentifier: string; readonly sourceReference: string }[]): readonly AreraCapacityMonth[] {
  const fromArchive = new Map<string, AreraCapacityMonth>();
  for (const record of stored) {
    if (record.componentCode !== "CAPACITY_MARKET" || record.customerScope !== "ALL_ELECTRICITY" || record.normalizedUnit !== "EUR/KWH" || !/:art\.4\.1:/.test(record.officialIdentifier)) continue;
    const month = record.effectiveFrom.slice(0, 7);
    fromArchive.set(month, { month, centsPerKwh: Math.round(record.normalizedValue * 1e8) / 1e6, resolution: `${record.officialIdentifier.split(":")[0]} art. 4.1`, url: record.sourceReference });
  }
  return [...fromArchive.values(), ...ARERA_TIV_CAPACITY_MONTHS.filter((item) => !fromArchive.has(item.month))].sort((left, right) => left.month.localeCompare(right.month));
}

/** The value in €/kWh for a period (ISO start inclusive, end exclusive), weighted by days per month; null if a month is missing. */
export function areraCapacityForPeriod(periodStart: string, periodEnd: string, months: readonly AreraCapacityMonth[] = ARERA_TIV_CAPACITY_MONTHS): { readonly eurPerKwh: number; readonly months: readonly AreraCapacityMonth[] } | null {
  const start = Date.parse(periodStart.slice(0, 10)); const end = Date.parse(periodEnd.slice(0, 10));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  let weighted = 0; const used: AreraCapacityMonth[] = [];
  for (let cursor = start; cursor < end;) {
    const date = new Date(cursor);
    const next = Math.min(end, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    const month = months.find((item) => item.month === date.toISOString().slice(0, 7));
    if (!month) return null;
    weighted += month.centsPerKwh / 100 * (next - cursor) / DAY;
    if (!used.includes(month)) used.push(month);
    cursor = next;
  }
  return { eurPerKwh: weighted / ((end - start) / DAY), months: used };
}
