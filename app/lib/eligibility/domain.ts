import type { CustomerType, CustomerResidency } from "../energy/types";
import type { BillSupplyProfile } from "../ingestion/bill-supply-profile";
import type { CteContract, CteEligibility } from "../cte/types";

export type CustomerLegalType = "CONSUMER" | "BUSINESS" | "OTHER" | "NOT_DECLARED";
export type SupplyUseScope = "DOMESTIC" | "OTHER_USE" | "PUBLIC_LIGHTING" | "EV_CHARGING" | "OTHER" | "NOT_DECLARED";
export type CteAllowedCustomerType = "CONSUMER" | "BUSINESS" | "BOTH" | "NOT_DECLARED";
export type LegalForm = "NATURAL_PERSON" | "LEGAL_PERSON" | "PROFESSIONAL" | "ENTERPRISE" | "PUBLIC_BODY" | "OTHER" | "NOT_DECLARED";
export type IdentifierType = "TAX_CODE" | "VAT" | "OTHER" | "NOT_DECLARED";

export type EligibilityReasonCode =
  | "CUSTOMER_LEGAL_TYPE_MISMATCH"
  | "SUPPLY_USE_MISMATCH"
  | "IDENTIFIER_TYPE_MISMATCH"
  | "VOLTAGE_MISMATCH"
  | "CONSUMPTION_THRESHOLD_MISMATCH"
  | "POWER_THRESHOLD_MISMATCH"
  | "VALIDITY_MISMATCH"
  | "CALCULATION_NOT_READY"
  | "REVIEW_REQUIRED"
  | "EXPIRED_CTE"
  | "MISSING_REGULATORY_DATA"
  | "INVALID_CTE"
  | "MISSING_SOURCE_DOCUMENT"
  | "TENANT_MISMATCH"
  | "SECURITY_FAILURE";

export interface BillEligibilityContext {
  readonly customerLegalType: CustomerLegalType;
  readonly supplyUseScope: SupplyUseScope;
  readonly identifierTypes: readonly IdentifierType[];
  readonly legalForms: readonly LegalForm[];
  readonly evidence: readonly string[];
}

export interface CteCustomerScopeContext {
  readonly allowedCustomerTypes: readonly CteAllowedCustomerType[];
  readonly allowedSupplyUses: readonly SupplyUseScope[];
  readonly allowedLegalForms: readonly LegalForm[];
  readonly allowedIdentifierTypes: readonly IdentifierType[];
}

const folded = (value: string): string => value.normalize("NFKC").toLocaleLowerCase("it-IT").replace(/\s+/g, " ").trim();
const unique = <T extends string>(values: readonly T[]): readonly T[] => [...new Set(values)];

function evidenceOf(value: string | null | undefined): string { return typeof value === "string" ? value : ""; }

function explicitBusinessEvidence(evidence: readonly string[]): boolean {
  return evidence.some((value) => /\b(?:partita\s+iva|p\.?\s*iva|impresa|societ[aà]|azienda|professionista|uso\s+professionale|business|persona\s+giuridica|ente\s+pubblico)\b/i.test(value));
}

function explicitConsumerEvidence(evidence: readonly string[]): boolean {
  return evidence.some((value) => /persona\s+fisica|codice\s+fiscale|consumer|cliente\s+non\s+business|altri\s+usi\s+con\s+(?:cf|codice\s+fiscale)/i.test(value));
}

export function deriveSupplyUseScope(profile: BillSupplyProfile | null, evidence: readonly string[] = []): SupplyUseScope {
  const raw = folded(evidence.join(" "));
  const normalized = profile?.supplyUseCategory.normalizedValue;
  if (normalized === "DOMESTIC") return "DOMESTIC";
  if (normalized === "OTHER_USE") return "OTHER_USE";
  if (normalized === "PUBLIC_LIGHTING" || /illuminazione\s+pubblica/.test(raw)) return "PUBLIC_LIGHTING";
  if (normalized === "PUBLIC_EV_CHARGING" || /ricaric[ah].*(?:veicol|auto)|veicol.*elettric.*ricaric/.test(raw)) return "EV_CHARGING";
  if (/\baltri\s+usi\b|\baltro\s+uso\b/.test(raw)) return "OTHER_USE";
  return "NOT_DECLARED";
}

export function deriveBillEligibilityContext(input: {
  readonly customerType: CustomerType | null | undefined;
  readonly residency: CustomerResidency | null | undefined;
  readonly profile: BillSupplyProfile | null;
  readonly identifiers?: readonly { readonly kind: "VAT_NUMBER" | "TAX_CODE" }[];
  readonly evidence?: readonly string[];
}): BillEligibilityContext {
  const evidence = (input.evidence ?? []).map(evidenceOf).filter(Boolean);
  const supplyUseScope = deriveSupplyUseScope(input.profile, evidence);
  const identifierTypes = unique((input.identifiers ?? []).map((item) => item.kind === "VAT_NUMBER" ? "VAT" : item.kind === "TAX_CODE" ? "TAX_CODE" : "OTHER" as const));
  const legacyBusiness = input.customerType === "NON_RESIDENTIAL" && supplyUseScope !== "DOMESTIC" && !explicitConsumerEvidence(evidence);
  const business = explicitBusinessEvidence(evidence) || identifierTypes.includes("VAT") || legacyBusiness;
  const customerLegalType: CustomerLegalType = business
    ? "BUSINESS"
    : explicitConsumerEvidence(evidence) || supplyUseScope === "DOMESTIC" || input.customerType === "RESIDENTIAL" || (input.residency !== null && input.residency !== undefined)
      ? "CONSUMER"
      : "NOT_DECLARED";
  const legalForms: readonly LegalForm[] = business
    ? unique(evidence.flatMap((value): LegalForm[] => {
      const text = folded(value);
      const legalPerson = /\bpersona\s+giuridica\b|societ[aà]|ente\s+pubblico/.test(text);
      const professional = /\bprofessionista\b|\bprofessionale\b/.test(text);
      const enterprise = /\bimpresa\b|\bazienda\b/.test(text);
      return [...(legalPerson ? ["LEGAL_PERSON" as const] : []), ...(professional ? ["PROFESSIONAL" as const] : []), ...(enterprise ? ["ENTERPRISE" as const] : [])];
    }))
    : ["NATURAL_PERSON"];
  return { customerLegalType, supplyUseScope, identifierTypes: identifierTypes.length ? identifierTypes : ["NOT_DECLARED"], legalForms: legalForms.length ? legalForms : ["NOT_DECLARED"], evidence };
}

function explicitCustomerTypes(eligibility: CteEligibility): readonly CteAllowedCustomerType[] {
  if (eligibility.allowedCustomerTypes?.length) return eligibility.allowedCustomerTypes;
  const legacy = new Set(eligibility.customerTypes);
  const values: CteAllowedCustomerType[] = [];
  if (legacy.has("RESIDENTIAL")) values.push("CONSUMER");
  if (legacy.has("NON_RESIDENTIAL")) values.push("BUSINESS");
  return unique(values.length ? values : ["NOT_DECLARED"]);
}

function explicitSupplyUses(eligibility: CteEligibility): readonly SupplyUseScope[] {
  if (eligibility.allowedSupplyUses?.length) return eligibility.allowedSupplyUses;
  const scopes = eligibility.customerScopes ?? [];
  const values: SupplyUseScope[] = [];
  if (scopes.some((scope) => scope.startsWith("DOMESTIC_"))) values.push("DOMESTIC");
  if (scopes.includes("NON_DOMESTIC_OTHER_USE")) values.push("OTHER_USE");
  if (scopes.includes("ALL_ELECTRICITY") || scopes.includes("ALL_GAS")) return ["DOMESTIC", "OTHER_USE", "PUBLIC_LIGHTING", "EV_CHARGING", "OTHER"];
  return unique(values);
}

export function deriveCteCustomerScope(contract: CteContract): CteCustomerScopeContext {
  const eligibility = contract.eligibility;
  return {
    allowedCustomerTypes: explicitCustomerTypes(eligibility),
    allowedSupplyUses: explicitSupplyUses(eligibility),
    allowedLegalForms: eligibility.allowedLegalForms?.length ? eligibility.allowedLegalForms : ["NOT_DECLARED"],
    allowedIdentifierTypes: eligibility.allowedIdentifierTypes?.length ? eligibility.allowedIdentifierTypes : ["NOT_DECLARED"],
  };
}

export function evaluateCustomerAndSupply(input: { readonly bill: BillEligibilityContext; readonly cte: CteCustomerScopeContext }): readonly EligibilityReasonCode[] {
  const reasons: EligibilityReasonCode[] = [];
  const { bill, cte } = input;
  const customerMatches = cte.allowedCustomerTypes.includes("BOTH") || cte.allowedCustomerTypes.includes(bill.customerLegalType as Exclude<CteAllowedCustomerType, "BOTH">);
  if (bill.customerLegalType === "NOT_DECLARED" || cte.allowedCustomerTypes.includes("NOT_DECLARED") || !customerMatches) reasons.push("CUSTOMER_LEGAL_TYPE_MISMATCH");
  if (cte.allowedSupplyUses.length > 0 && (bill.supplyUseScope === "NOT_DECLARED" || !cte.allowedSupplyUses.includes(bill.supplyUseScope))) reasons.push("SUPPLY_USE_MISMATCH");
  if (cte.allowedIdentifierTypes.length > 0 && !cte.allowedIdentifierTypes.includes("NOT_DECLARED") && !bill.identifierTypes.some((type) => cte.allowedIdentifierTypes.includes(type))) reasons.push("IDENTIFIER_TYPE_MISMATCH");
  return unique(reasons);
}

export function reasonLabel(code: EligibilityReasonCode): string {
  const labels: Record<EligibilityReasonCode, string> = {
    CUSTOMER_LEGAL_TYPE_MISMATCH: "Il tipo giuridico del cliente non è ammesso dalla CTE.",
    SUPPLY_USE_MISMATCH: "L'uso della fornitura non è ammesso dalla CTE.",
    IDENTIFIER_TYPE_MISMATCH: "Il tipo di identificativo richiesto dalla CTE non è presente.",
    VOLTAGE_MISMATCH: "Il livello di tensione non è ammesso dalla CTE.",
    CONSUMPTION_THRESHOLD_MISMATCH: "Il consumo non soddisfa la soglia documentata della CTE.",
    POWER_THRESHOLD_MISMATCH: "La potenza non soddisfa la soglia documentata della CTE.",
    VALIDITY_MISMATCH: "Il periodo richiesto non è coperto dalla validità della CTE.",
    CALCULATION_NOT_READY: "La CTE non è pronta per il calcolo.",
    REVIEW_REQUIRED: "La CTE richiede revisione e non è utilizzabile.",
    EXPIRED_CTE: "La CTE è scaduta.",
    MISSING_REGULATORY_DATA: "Mancano dati regolatori approvati.",
    INVALID_CTE: "La CTE non è valida.",
    MISSING_SOURCE_DOCUMENT: "Manca il documento sorgente.",
    TENANT_MISMATCH: "La CTE non appartiene al tenant corrente.",
    SECURITY_FAILURE: "Verifica di sicurezza non superata.",
  };
  return labels[code];
}

export function customerLegalTypeFromLegacy(customerType: CustomerType): CustomerLegalType {
  return customerType === "RESIDENTIAL" ? "CONSUMER" : "BUSINESS";
}
