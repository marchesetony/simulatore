import type { CteComponent, CteOfferVersion, Pricing, Readiness, ReadinessReason } from "./types";

function add(list: ReadinessReason[], reason: ReadinessReason): void { if (!list.includes(reason)) list.push(reason); }
function rateReady(rate: { applicability: string; amount: string | null; unit: string | null }, reasons: ReadinessReason[], indexed = false): void {
  if (rate.applicability === "NOT_PROVIDED") add(reasons, indexed ? "MISSING_SPREAD" : "MISSING_PRICE");
  if (rate.applicability === "APPLIES" && (rate.amount === null || rate.unit === null)) add(reasons, indexed ? "MISSING_SPREAD" : "MISSING_PRICE");
}
function componentReasons(components: readonly CteComponent[], reasons: ReadinessReason[]): void {
  const required = ["COMMERCIALIZATION", "MONTHLY_FEE", "ANNUAL_FEE", "IMBALANCE", "OTHER_VARIABLE", "DISCOUNT", "ONE_OFF"] as const;
  for (const kind of required) {
    const rows = components.filter(component => component.kind === kind);
    if (rows.length !== 1 || rows[0].applicability === "NOT_PROVIDED") add(reasons, "MISSING_APPLICABILITY");
  }
  const applied = new Set<string>();
  for (const component of components) {
    if (component.applicability === "NOT_PROVIDED") add(reasons, "MISSING_APPLICABILITY");
    if (component.applicability !== "APPLIES") continue;
    if (component.amount === null || component.unit === null) add(reasons, "AMBIGUOUS_UNIT");
    if (component.kind === "IMBALANCE") add(reasons, "AMBIGUOUS_IMBALANCE");
    if (component.kind === "DISCOUNT") add(reasons, "UNSUPPORTED_DISCOUNT");
    if (component.kind === "ONE_OFF") add(reasons, "UNSUPPORTED_ONE_OFF");
    if (component.kind === "COMMERCIALIZATION" || component.kind === "OTHER_VARIABLE") add(reasons, "AMBIGUOUS_COMPONENT");
    if (component.kind === "MONTHLY_FEE" || component.kind === "ANNUAL_FEE") {
      if (applied.has(component.kind)) add(reasons, "AMBIGUOUS_COMPONENT");
      applied.add(component.kind);
    }
  }
}
export function deriveReadiness(version: Pick<CteOfferVersion, "lifecycleStatus" | "supplier" | "offerCode" | "offerName" | "commodity" | "version" | "validFrom" | "validTo" | "pricing" | "components" | "taxTreatment">): Readiness {
  const reasons: ReadinessReason[] = [];
  if (version.lifecycleStatus !== "APPROVED") add(reasons, "NOT_APPROVED");
  if (!version.supplier) add(reasons, "MISSING_SUPPLIER");
  if (!version.offerCode || !version.offerName) add(reasons, "MISSING_OFFER_IDENTITY");
  if (!version.version) add(reasons, "MISSING_VERSION");
  if (version.commodity !== "EE") add(reasons, "UNSUPPORTED_COMMODITY");
  if (version.validFrom > version.validTo) add(reasons, "INVALID_PERIOD");
  const pricing = version.pricing as Pricing;
  if (pricing.mode === "FIXED") { rateReady(pricing.fixedPrice, reasons); if (pricing.fixedPrice.applicability !== "APPLIES") add(reasons, "MISSING_PRICE"); if (pricing.fixedPrice.unit !== "EUR_PER_KWH") add(reasons, "AMBIGUOUS_UNIT"); }
  else { if (pricing.reference !== "PUN") add(reasons, "MISSING_SPREAD"); rateReady(pricing.spread, reasons, true); if (pricing.spread.unit !== "EUR_PER_KWH") add(reasons, "AMBIGUOUS_UNIT"); }
  if (version.taxTreatment !== "EXCLUDED") add(reasons, "INCOMPATIBLE_TAX_TREATMENT");
  componentReasons(version.components, reasons);
  return { status: reasons.length ? "BLOCKED" : "READY", reasons };
}
