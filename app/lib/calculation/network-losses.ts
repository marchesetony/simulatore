import type { VoltageLevel } from "../energy/types.ts";

// Tony (15/11/2026, "Correzione perdite e Capacity Market"): the network loss coefficient is a typed percentage of the TIS
// Tabella 4, chosen by the supply's voltage and the billed period, never a €/kWh charge read as a percentage (the Capacity
// Market 0,003423 €/kWh of 338/2026 had been taken as a 0,34% loss factor). A period the table does not cover gets no
// coefficient: the charges that need it are then not determinable, never grossed up by a guessed factor.
//
// TIS Tabella 4, colonna A (punti di prelievo): delibera 117/2022/R/eel, in force from 1 January 2023 (BT 10%, replacing
// 10,2%); left unchanged by the following resolutions (535/2024/R/eel only recalls it) and confirmed for 2026 by delibera
// 430/2025/R/eel ("ivi inclusa l'attuale Tabella 4 del TIS"). 2027 is added only once ARERA confirms it.

export interface NetworkLossCoefficient {
  readonly kind: "NETWORK_LOSS_PERCENTAGE";
  /** Percentage points, e.g. 10 for BT. */
  readonly percent: number;
  readonly voltageLevel: VoltageLevel;
  readonly effectiveFrom: string;
  /** Exclusive. */
  readonly effectiveTo: string;
  readonly source: string;
}

interface TisTable4Period {
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly percent: Readonly<Record<VoltageLevel, number>>;
  readonly source: string;
}

export const TIS_TABLE_4_COLUMN_A_PERIODS: readonly TisTable4Period[] = [
  {
    effectiveFrom: "2023-01-01",
    effectiveTo: "2027-01-01",
    percent: { LV: 10, MV: 3.8, HV: 1.8, EHV: 0.7 },
    source: "TIS Tabella 4 colonna A, delibera 117/2022/R/eel (dal 1/1/2023), confermata per il 2026 dalla delibera 430/2025/R/eel",
  },
];

/** The TIS Tabella 4 coefficient for the whole period (start inclusive, end exclusive), or null when a day is not covered. */
export function tisTable4LossCoefficient(voltageLevel: VoltageLevel, periodStart: string, periodEnd: string, periods: readonly TisTable4Period[] = TIS_TABLE_4_COLUMN_A_PERIODS): NetworkLossCoefficient | null {
  const start = periodStart.slice(0, 10);
  const end = periodEnd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) return null;
  const period = periods.find((item) => item.effectiveFrom <= start && end <= item.effectiveTo);
  const percent = period?.percent[voltageLevel];
  if (!period || percent === undefined || !Number.isFinite(percent) || percent <= 0 || percent >= 50) return null;
  return { kind: "NETWORK_LOSS_PERCENTAGE", percent, voltageLevel, effectiveFrom: period.effectiveFrom, effectiveTo: period.effectiveTo, source: period.source };
}
