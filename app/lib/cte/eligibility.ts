import type { CustomerType, DatePeriod, VoltageLevel } from "../energy/types";
import type { CteArchiveRecord, CteArchiveVersion } from "./archive/types";
import type { CteCommercialCustomerScope, CteContract } from "./types";
import type { EligibilityReasonCode, CustomerLegalType, IdentifierType, SupplyUseScope } from "../eligibility/domain";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deriveCteCustomerScope, evaluateCustomerAndSupply, reasonLabel, customerLegalTypeFromLegacy } from "../eligibility/domain.ts";

export type CteEligibilityStatus = "COMPATIBLE" | "NOT_COMPATIBLE";

export type CteEligibilityReasonCode =
  | "CTE_TENANT_MISMATCH"
  | "CTE_VECTOR_MISMATCH"
  | "CTE_NOT_APPROVED"
  | "CTE_COMMERCIAL_NOT_ACTIVE"
  | "CTE_VALIDITY_MISMATCH"
  | "CTE_EXPIRED"
  | "CTE_CUSTOMER_NOT_ELIGIBLE"
  | "CTE_CONSUMPTION_NOT_ELIGIBLE"
  | "CTE_VOLTAGE_NOT_ELIGIBLE"
  | "CTE_BTA6_NOT_ELIGIBLE"
  | "CTE_PRICING_UNSUPPORTED"
  | "CTE_ELIGIBLE";

export interface CteEligibilityContext {
  readonly tenantId: string;
  readonly vector: "EE" | "GAS";
  readonly customerType: CustomerType;
  readonly customerScope?: CteCommercialCustomerScope;
  readonly customerLegalType?: CustomerLegalType;
  readonly supplyUseScope?: SupplyUseScope;
  readonly identifierTypes?: readonly IdentifierType[];
  readonly annualConsumption?: number;
  readonly voltageLevel?: VoltageLevel;
  readonly supplyPeriod: DatePeriod;
  readonly calculationDate: string;
  /** BTA6 has no dedicated CTE field in the authoritative contract. */
  readonly bta6Required?: boolean;
}

export function isCommercialCustomerScopeCompatible(
  contract: CteContract,
  customerType: CustomerType,
  customerScope?: CteCommercialCustomerScope,
): boolean {
  if (!contract.eligibility.customerTypes.includes(customerType)) return false;
  const scopes = contract.eligibility.customerScopes;
  if (!scopes?.length) return true;
  if (!customerScope) return false;
  if (contract.vector === "EE") {
    if (scopes.includes("ALL_ELECTRICITY")) return true;
    if ((customerScope === "DOMESTIC_RESIDENT_BT" || customerScope === "DOMESTIC_NON_RESIDENT_BT") && scopes.includes("DOMESTIC_BT")) return true;
    if ((customerScope === "NON_DOMESTIC_BT" || customerScope === "NON_DOMESTIC_BT_BTA6") && scopes.includes("NON_DOMESTIC_OTHER_USE")) return true;
  } else if (scopes.includes("ALL_GAS")) return true;
  return scopes.includes(customerScope);
}

function isAnnualConsumptionCompatible(contract: CteContract, annualConsumption: number | undefined): boolean {
  const rule = contract.eligibility.annualConsumptionRule;
  if (!rule) return true;
  if (annualConsumption === undefined || !Number.isFinite(annualConsumption)) return false;
  switch (rule.operator) {
    case ">": return annualConsumption > rule.value;
    case ">=": return annualConsumption >= rule.value;
    case "<": return annualConsumption < rule.value;
    case "<=": return annualConsumption <= rule.value;
    case "=": return annualConsumption === rule.value;
  }
}

export interface CteEligibilityCandidate {
  readonly archiveId: string;
  readonly cteId: string;
  readonly versionId: string | null;
  readonly version: string | null;
  readonly supplier: string;
  readonly offer: string;
  readonly validity: DatePeriod | null;
  readonly pricing: { readonly mode: string | null; readonly reference: string | null };
  readonly eligibilityStatus: CteEligibilityStatus;
  readonly eligibilityReason: CteEligibilityReasonCode;
  readonly compatibilityReason: string;
  readonly reasonCodes?: readonly EligibilityReasonCode[];
}

function currentCandidateVersion(record: CteArchiveRecord): CteArchiveVersion | null {
  if (record.currentApprovedVersionId) {
    return record.versions.find((version) => version.versionId === record.currentApprovedVersionId) ?? null;
  }
  return record.versions.slice().sort((left, right) => right.versionNumber - left.versionNumber)[0] ?? null;
}

function pricingOf(contract: CteContract | null): { readonly mode: string | null; readonly reference: string | null } {
  return contract ? { mode: contract.pricing.mode, reference: contract.pricing.reference } : { mode: null, reference: null };
}

function pricingSupported(contract: CteContract): boolean {
  if (contract.vector === "EE") {
    return contract.pricing.mode === "INDEXED"
      ? contract.pricing.reference === "PUN" && contract.pricing.spread.unit === "EUR_PER_KWH"
      : contract.pricing.mode === "FIXED" && contract.pricing.reference === "NONE" && contract.pricing.fixedPrice.unit === "EUR_PER_KWH";
  }
  return contract.pricing.mode === "INDEXED"
    ? contract.pricing.reference === "PSV" && contract.pricing.spread.unit === "EUR_PER_SMC"
    : contract.pricing.mode === "FIXED" && contract.pricing.reference === "NONE" && contract.pricing.fixedPrice.unit === "EUR_PER_SMC";
}

function baseCandidate(record: CteArchiveRecord, version: CteArchiveVersion | null): Omit<CteEligibilityCandidate, "eligibilityStatus" | "eligibilityReason" | "compatibilityReason"> {
  const contract = version?.contract ?? null;
  return {
    archiveId: record.archiveId,
    cteId: record.cteId,
    versionId: version?.versionId ?? null,
    version: contract?.version ?? null,
    supplier: contract?.supplier.name ?? "",
    offer: contract?.offer.name ?? "",
    validity: contract?.validity ?? null,
    pricing: pricingOf(contract),
  };
}

function result(
  base: Omit<CteEligibilityCandidate, "eligibilityStatus" | "eligibilityReason" | "compatibilityReason">,
  eligibilityReason: CteEligibilityReasonCode,
  compatibilityReason: string,
  reasonCodes: readonly EligibilityReasonCode[] = [],
): CteEligibilityCandidate {
  return {
    ...base,
    eligibilityStatus: eligibilityReason === "CTE_ELIGIBLE" ? "COMPATIBLE" : "NOT_COMPATIBLE",
    eligibilityReason,
    compatibilityReason,
    ...(reasonCodes.length ? { reasonCodes } : {}),
  };
}

/**
 * Evaluates only authoritative archive/contract dimensions. Market availability,
 * regulatory data and bill-derived values remain separate server-side concerns.
 */
export function evaluateCteEligibility(record: CteArchiveRecord, context: CteEligibilityContext): CteEligibilityCandidate {
  const version = currentCandidateVersion(record);
  const base = baseCandidate(record, version);
  if (record.tenantId !== context.tenantId) return result(base, "CTE_TENANT_MISMATCH", "La CTE appartiene a un tenant diverso.");
  if (record.vector !== context.vector || version?.contract.vector !== context.vector) return result(base, "CTE_VECTOR_MISMATCH", "Il vettore della CTE non coincide con quello della bolletta.");
  if (!version || record.currentApprovedVersionId !== version.versionId || version.status !== "APPROVED" || version.contract.approval.status !== "APPROVED") return result(base, "CTE_NOT_APPROVED", "La CTE non ha una versione approvata utilizzabile.");
  if ((record.commercialStatus ?? "ACTIVE") !== "ACTIVE") return result(base, "CTE_COMMERCIAL_NOT_ACTIVE", "La CTE non è commercialmente attiva.");

  const contract = version.contract;
  const { periodStart, periodEnd } = context.supplyPeriod;
  if (contract.validity.periodStart > periodStart || contract.validity.periodEnd < periodEnd || context.calculationDate < contract.validity.periodStart || context.calculationDate >= contract.validity.periodEnd) {
    return result(base, "CTE_VALIDITY_MISMATCH", "Il periodo della simulazione non è coperto dalla validità della CTE.");
  }
  if ((contract.expiry.status === "EXPIRES_ON" && (context.calculationDate > contract.expiry.date || periodEnd > contract.expiry.date)) || (contract.expiry.status === "NO_EXPIRY_DECLARED" && periodEnd > contract.validity.periodEnd)) {
    return result(base, "CTE_EXPIRED", "La CTE è scaduta o non copre il periodo richiesto.");
  }
  const billCustomerLegalType = context.customerLegalType ?? customerLegalTypeFromLegacy(context.customerType);
  const billSupplyUseScope = context.supplyUseScope ?? (context.customerScope?.startsWith("DOMESTIC_") ? "DOMESTIC" : context.customerScope === "NON_DOMESTIC_OTHER_USE" ? "OTHER_USE" : "NOT_DECLARED");
  const commercialReasons = evaluateCustomerAndSupply({
    bill: { customerLegalType: billCustomerLegalType, supplyUseScope: billSupplyUseScope, identifierTypes: context.identifierTypes ?? ["NOT_DECLARED"], legalForms: ["NOT_DECLARED"], evidence: [] },
    cte: deriveCteCustomerScope(contract),
  });
  if (commercialReasons.length || !isCommercialCustomerScopeCompatible(contract, context.customerType, context.customerScope)) return result(base, "CTE_CUSTOMER_NOT_ELIGIBLE", commercialReasons[0] ? reasonLabel(commercialReasons[0]) : "La tipologia o lo scope commerciale cliente non è ammesso dalla CTE.", commercialReasons.length ? commercialReasons : ["CUSTOMER_LEGAL_TYPE_MISMATCH"]);
  if (!isAnnualConsumptionCompatible(contract, context.annualConsumption)) return result(base, "CTE_CONSUMPTION_NOT_ELIGIBLE", "Il consumo annuo non soddisfa la soglia commerciale della CTE.");
  if (context.vector === "EE" && (context.voltageLevel === undefined || contract.vector !== "EE" || !contract.eligibility.voltageLevels.includes(context.voltageLevel))) {
    return result(base, "CTE_VOLTAGE_NOT_ELIGIBLE", "Il livello di tensione non è ammesso dalla CTE.");
  }
  if (context.bta6Required && (contract.vector !== "EE" || !contract.eligibility.customerTypes.includes("NON_RESIDENTIAL") || !contract.eligibility.voltageLevels.includes("LV"))) {
    return result(base, "CTE_BTA6_NOT_ELIGIBLE", "La CTE non espone i requisiti tecnici minimi per BTA6.");
  }
  if (!pricingSupported(contract)) return result(base, "CTE_PRICING_UNSUPPORTED", "La modalità di pricing della CTE non è supportata.");
  return result(base, "CTE_ELIGIBLE", "CTE compatibile con i dati tecnici e contrattuali della bolletta.");
}

/** Returns one authoritative eligibility decision per archive candidate. */
export function listCteEligibility(records: readonly CteArchiveRecord[], context: CteEligibilityContext): readonly CteEligibilityCandidate[] {
  return records.slice().sort((left, right) => left.archiveId.localeCompare(right.archiveId)).map((record) => evaluateCteEligibility(record, context));
}

export function compatibleCteCandidates(records: readonly CteArchiveRecord[], context: CteEligibilityContext): readonly CteEligibilityCandidate[] {
  return listCteEligibility(records, context).filter((candidate) => candidate.eligibilityStatus === "COMPATIBLE");
}
