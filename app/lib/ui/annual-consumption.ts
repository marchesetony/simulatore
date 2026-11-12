import { ANNUAL_ESTIMATE_LABEL, resolveAnnualConsumption, type AnnualConsumption } from "../calculation/annual-consumption";
import type { BillDocumentModel } from "./models";

// Tony (12/11/2026, "CONSUMO ANNUO STIMATO"): an estimate is always shown with its label, its origin and the months or the
// period it comes from; kWh and Smc without decimals (display only, the value keeps its precision).
const WHOLE = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export const quantityText = (value: number, unit: "kWh" | "Smc"): string => `${WHOLE.format(value)} ${unit}`;
const monthName = (month: string): string => { const [year, value] = month.split("-"); return `${MONTHS[Number(value) - 1] ?? value} ${year}`; };
const isoDate = (value: string): string => value.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$3/$2/$1");
const consecutive = (months: readonly string[]): boolean => months.every((month, index) => {
  if (index === 0) return true;
  const [y0, m0] = months[index - 1].split("-").map(Number); const [y1, m1] = month.split("-").map(Number);
  return y1 * 12 + m1 - (y0 * 12 + m0) === 1;
});
const monthsText = (months: readonly string[]): string => months.length > 1 && consecutive(months) ? `${monthName(months[0])} – ${monthName(months[months.length - 1])}` : months.map(monthName).join(", ");

/** "Media di 6 mesi dello storico consumi (maggio 2026 – ottobre 2026: 2.374 kWh) × 12" and the like; null for a declared value. */
export function annualEstimateOrigin(annual: AnnualConsumption, unit: "kWh" | "Smc"): string | null {
  if (annual.status !== "ESTIMATED" || annual.basisTotal === null) return null;
  const issues = annual.issues.length ? `. Note: ${annual.issues.join("; ")}` : "";
  if (annual.source === "HISTORY") return `media di ${annual.months.length} ${annual.months.length === 1 ? "mese" : "mesi"} dello storico consumi (${monthsText(annual.months)}: ${quantityText(annual.basisTotal, unit)}) × 12${issues}`;
  if (annual.source === "BILLED_MONTHS") return `media di ${annual.months.length} ${annual.months.length === 1 ? "mese fatturato" : "mesi fatturati"} (${monthsText(annual.months)}: ${quantityText(annual.basisTotal, unit)}) × 12, storico consumi non utilizzabile${issues}`;
  if (annual.source === "BILLED_PERIOD" && annual.period) return `consumo del periodo fatturato ${isoDate(annual.period.start)} – ${isoDate(annual.period.end)} (${quantityText(annual.basisTotal, unit)} in ${annual.period.months} ${annual.period.months === 1 ? "mese" : "mesi"}) ÷ ${annual.period.months} × 12, storico consumi non utilizzabile${issues}`;
  return null;
}

/** One line: the value and, for an estimate, the mandatory label and its origin. */
export function annualConsumptionLine(annual: AnnualConsumption, unit: "kWh" | "Smc"): string {
  if (annual.value === null) return `Consumo annuo non determinabile${annual.issues.length ? ` (${annual.issues.join("; ")})` : ""}`;
  if (annual.status === "DECLARED") return `${quantityText(annual.value, unit)} (dichiarato in bolletta)`;
  return `${quantityText(annual.value, unit)} · ${ANNUAL_ESTIMATE_LABEL} · ${annualEstimateOrigin(annual, unit)}`;
}

/** The bill's annual consumption as the review screen sees it: the declared field, else the estimate from the reading. */
export function billAnnualConsumption(bill: Pick<BillDocumentModel, "fields" | "structuredBill">): AnnualConsumption {
  const number = (value: string | null | undefined) => { const parsed = value === null || value === undefined || value.trim() === "" ? NaN : Number(value); return Number.isFinite(parsed) ? parsed : null; };
  const dates = /(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/.exec(bill.fields.billingPeriod?.value ?? "");
  return resolveAnnualConsumption({
    declared: number(bill.fields.annualConsumption?.value),
    billed: number(bill.fields.billedConsumption?.value),
    periodStart: dates?.[1] ?? null,
    periodEnd: dates?.[2] ?? null,
    history: bill.structuredBill?.consumptionHistory ?? null,
  });
}
