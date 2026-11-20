/**
 * Tony (1/11): the CTEs left out of a bill "devono essere ordinate per tipologia se la bolletta è business prima le business
 * ordinate da quella adeguata per vincoli sui consumi e a seguire le meno convenienti".
 * Sort key [group, distance]: group 0 = the bill's customer type and its consumption fits; 1 = customer type fits but the
 * consumption threshold does not (distance = kWh from the nearest threshold); 2 = other customer type.
 */
export interface ExcludedCteScope { readonly reasonCodes: readonly string[]; readonly customer: string | null; readonly consumption: string | null; }

export function exclusionRank(cte: ExcludedCteScope, business: boolean, annual: number | null): readonly [number, number] {
  const wanted = business ? "Business" : "Consumer";
  const scope = cte.customer ?? "";
  const otherType = cte.reasonCodes.some((code) => code === "CUSTOMER_LEGAL_TYPE_MISMATCH" || code === "CUSTOMER_NOT_ELIGIBLE") || (scope !== "" && scope !== "Non indicato" && !scope.includes(wanted));
  if (otherType) return [2, 0];
  if (!cte.reasonCodes.some((code) => code === "CONSUMPTION_THRESHOLD_MISMATCH" || code === "CONSUMPTION_NOT_ELIGIBLE")) return [0, 0];
  const limits = [...(cte.consumption ?? "").matchAll(/\d[\d.]*(?:,\d+)?/g)].map((match) => Number(match[0].replace(/\./g, "").replace(",", "."))).filter(Number.isFinite);
  return [1, annual === null || !limits.length ? Number.MAX_SAFE_INTEGER : Math.min(...limits.map((limit) => Math.abs(limit - annual)))];
}
