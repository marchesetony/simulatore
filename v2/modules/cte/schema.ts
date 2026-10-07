import { BillError, type Period } from "../bills/types";
import { CTE_COMMODITIES, CTE_LIFECYCLE, type CteComponent, type CteCreateInput, type Pricing, type Rate } from "./types";

const bad = (): never => { throw new BillError("INVALID_INPUT"); };
const obj = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(row, key))) return bad();
  return row;
};
const text = (value: unknown, max: number): string => typeof value === "string" && value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : bad();
const date = (value: unknown): string => {
  const result = text(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return bad();
  const parsed = Date.parse(`${result}T00:00:00Z`); if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== result) return bad(); return result;
};
const decimal = (value: unknown): string | null => value === null ? null : typeof value === "string" && /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value) ? value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : bad();
const choice = <T extends string>(value: unknown, values: readonly T[]): T => typeof value === "string" && values.includes(value as T) ? value as T : bad();
export function period(value: unknown): Period { const row = obj(value, ["periodStart", "periodEnd"]); const periodStart = date(row.periodStart), periodEnd = date(row.periodEnd); if (periodStart > periodEnd) return bad(); return { periodStart, periodEnd }; }
function rate(value: unknown): Rate {
  const row = obj(value, ["applicability", "amount", "unit"]); const applicability = choice(row.applicability, ["APPLIES", "NOT_APPLICABLE", "NOT_PROVIDED"] as const); const amount = decimal(row.amount);
  const unit = row.unit === null ? null : choice(row.unit, ["EUR_PER_KWH", "EUR_PER_MONTH", "EUR_PER_YEAR"] as const);
  if (applicability !== "APPLIES" && (amount !== null || unit !== null)) return bad(); return { applicability, amount, unit };
}
function pricing(value: unknown): Pricing {
  const row = obj(value, ["mode", "reference", "fixedPrice", "spread"]); const mode = choice(row.mode, ["FIXED", "INDEXED"] as const); const spread = rate(row.spread);
  if (mode === "INDEXED") { if (row.reference !== "PUN" || (spread.unit !== null && spread.unit !== "EUR_PER_KWH")) return bad(); return { mode, reference: "PUN", spread }; }
  const fixedPrice = rate(row.fixedPrice); if (row.reference !== null || (fixedPrice.unit !== null && fixedPrice.unit !== "EUR_PER_KWH")) return bad(); return { mode, fixedPrice, spread };
}
function component(value: unknown): CteComponent {
  const row = obj(value, ["kind", "label", "applicability", "amount", "unit"]); const kind = choice(row.kind, ["COMMERCIALIZATION", "MONTHLY_FEE", "ANNUAL_FEE", "IMBALANCE", "OTHER_VARIABLE", "DISCOUNT", "ONE_OFF"] as const);
  const parsed = rate({ applicability: row.applicability, amount: row.amount, unit: row.unit });
  if (kind === "MONTHLY_FEE" && parsed.applicability === "APPLIES" && parsed.unit !== "EUR_PER_MONTH") return bad();
  if (kind === "ANNUAL_FEE" && parsed.applicability === "APPLIES" && parsed.unit !== "EUR_PER_YEAR") return bad();
  if (kind === "IMBALANCE" && parsed.applicability === "APPLIES" && parsed.unit !== "EUR_PER_KWH") return bad();
  return { kind, label: text(row.label, 160), ...parsed };
}
export function cteInput(value: unknown): CteCreateInput {
  try {
    const row = obj(value, ["supplier", "offerCode", "offerName", "commodity", "validFrom", "validTo", "lifecycleStatus", "pricing", "components", "taxTreatment"]);
    const components = row.components; if (!Array.isArray(components) || components.length > 20) return bad();
    const dates = period({ periodStart: row.validFrom, periodEnd: row.validTo });
    return { supplier: text(row.supplier, 160), offerCode: text(row.offerCode, 120), offerName: text(row.offerName, 160), commodity: choice(row.commodity, CTE_COMMODITIES),
      validFrom: dates.periodStart, validTo: dates.periodEnd, lifecycleStatus: choice(row.lifecycleStatus, CTE_LIFECYCLE), pricing: pricing(row.pricing), components: components.map(component), taxTreatment: choice(row.taxTreatment, ["EXCLUDED"] as const) };
  } catch (error) { if (error instanceof BillError) throw new Error("INVALID_INPUT"); throw error; }
}
