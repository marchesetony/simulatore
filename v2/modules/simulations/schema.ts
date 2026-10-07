import { choice, decimal, identifier, period, strictObject, text } from "../bills/values";
import { BillError } from "../bills/types";
import { FEE_KINDS, SimulationError, type CommercialTermsSnapshot, type MarketSnapshot, type Rate, type SimulationCreateInput } from "./types";

function rate(value: unknown): Rate {
  const row = strictObject(value, ["applicability", "amount", "unit"]);
  const applicability = choice(row.applicability, ["APPLIES", "NOT_APPLICABLE", "UNKNOWN"]);
  const amount = decimal(row.amount, 6);
  const unit = row.unit === null ? null : choice(row.unit, ["EUR_PER_KWH", "EUR_PER_MONTH", "EUR_PER_YEAR", "EUR_PER_CONTRACT"]);
  if (applicability === "NOT_APPLICABLE" && (amount !== null || unit !== null)) throw new SimulationError("INVALID_INPUT");
  return { applicability, amount, unit };
}
export function terms(value: unknown, allowSource = false): CommercialTermsSnapshot | null {
  if (value === null) return null;
  const raw = value as Record<string, unknown>;
  const hasSource = Object.hasOwn(raw, "source");
  if (hasSource && !allowSource) throw new SimulationError("INVALID_INPUT");
  const row = strictObject(value, ["reference", "periodStart", "periodEnd", "mode", "taxTreatment", "fixedPrice", "spread", "fees", ...(hasSource ? ["source"] : [])]);
  if (!Array.isArray(row.fees) || row.fees.length > 20) throw new SimulationError("INVALID_INPUT");
  const source = Object.hasOwn(row, "source") ? (() => { const item = strictObject(row.source, ["type", "cteId", "cteVersion"]); return { type: choice(item.type, ["CTE"] as const), cteId: text(item.cteId, 120), cteVersion: text(item.cteVersion, 40) }; })() : undefined;
  return { ...period(row), reference: text(row.reference, 120), mode: choice(row.mode, ["FIXED", "INDEXED"]),
    taxTreatment: choice(row.taxTreatment, ["EXCLUDED"]), fixedPrice: rate(row.fixedPrice), spread: rate(row.spread),
    ...(source ? { source } : {}),
    fees: row.fees.map(value => {
      const fee = strictObject(value, ["kind", "applicability", "amount", "unit"]);
      const { kind, ...rest } = fee;
      return { kind: choice(kind, FEE_KINDS), ...rate(rest) };
    }) };
}
function market(value: unknown): MarketSnapshot | null {
  if (value === null) return null;
  const row = strictObject(value, ["reference", "values"]);
  if (!Array.isArray(row.values) || row.values.length > 360) throw new SimulationError("INVALID_INPUT");
  return { reference: text(row.reference, 120), values: row.values.map(value => {
    const item = strictObject(value, ["month", "band", "value", "unit", "versionReference"]);
    if (typeof item.month !== "string" || !/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(item.month)) throw new SimulationError("INVALID_INPUT");
    return { month: item.month, band: choice(item.band, ["F1", "F2", "F3"]), value: decimal(item.value, 6, true),
      unit: choice(item.unit, ["EUR_PER_MWH"]), versionReference: text(item.versionReference, 120) };
  }) };
}
export function simulationInput(value: unknown, allowSource = false): SimulationCreateInput {
  try {
    const row = strictObject(value, ["billId", "calculationPeriod", "currentCommercialTerms", "candidateCommercialTerms", "marketSnapshot"]);
    const dates = strictObject(row.calculationPeriod, ["periodStart", "periodEnd"]);
    return { billId: identifier(row.billId), calculationPeriod: period(dates),
      currentCommercialTerms: terms(row.currentCommercialTerms, allowSource), candidateCommercialTerms: terms(row.candidateCommercialTerms, allowSource),
      marketSnapshot: market(row.marketSnapshot) };
  } catch (error) {
    if (error instanceof BillError) throw new SimulationError("INVALID_INPUT");
    throw error;
  }
}
