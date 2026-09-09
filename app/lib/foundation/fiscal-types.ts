export const EXCISE_TAX_TREATMENT_VALUES = ["TAXABLE", "EXEMPT", "NOT_SUBJECT", "UNKNOWN"] as const;
export type ExciseTaxTreatment = typeof EXCISE_TAX_TREATMENT_VALUES[number];

export const EXCISE_SPECIAL_USE_VALUES = [
  "ORDINARY",
  "ELECTRICITY_PRODUCTION",
  "RENEWABLE_AUTOPRODUCTION",
  "RAIL_TRANSPORT",
  "URBAN_INTERURBAN_TRANSPORT",
  "CHEMICAL_REDUCTION",
  "ELECTROLYTIC_METALLURGICAL",
  "MINERALOGICAL",
  "ENERGY_COST_OVER_50_PERCENT",
  "MIXED_USE",
  "UNKNOWN",
] as const;
export type ExciseSpecialUse = typeof EXCISE_SPECIAL_USE_VALUES[number];

export const VAT_TREATMENT_VALUES = ["DOMESTIC_REDUCED", "QUALIFIED_BUSINESS_REDUCED", "STANDARD", "UNKNOWN"] as const;
export type VatTreatment = typeof VAT_TREATMENT_VALUES[number];

export const FISCAL_MIXED_USE_VALUES = ["SINGLE_USE", "MIXED_USE", "UNKNOWN"] as const;
export type FiscalMixedUseStatus = typeof FISCAL_MIXED_USE_VALUES[number];

export const FISCAL_EVIDENCE_SOURCE_KINDS = [
  "APPROVED_SOURCE_BILL",
  "APPROVED_SOURCE_DOCUMENT",
  "APPROVED_CUSTOMER_DECLARATION",
  "OFFICIAL_AUTHORITY_EVIDENCE",
] as const;
export type FiscalEvidenceSourceKind = typeof FISCAL_EVIDENCE_SOURCE_KINDS[number];

export const FISCAL_EVIDENCE_STATUSES = ["APPROVED", "NEEDS_REVIEW", "EXPIRED", "INVALID"] as const;
export type FiscalEvidenceStatus = typeof FISCAL_EVIDENCE_STATUSES[number];

export const FISCAL_SOURCE_HEALTH_VALUES = ["FRESH", "STALE", "BLOCKED", "UNKNOWN"] as const;
export type FiscalSourceHealth = typeof FISCAL_SOURCE_HEALTH_VALUES[number];

export const FISCAL_RULE_AUTHORITIES = ["ADM", "MEF", "NORMATTIVA", "AGENZIA_ENTRATE"] as const;
export type FiscalRuleAuthority = typeof FISCAL_RULE_AUTHORITIES[number];

export const FISCAL_RULE_TAX_KINDS = ["EXCISE", "VAT"] as const;
export type FiscalRuleTaxKind = typeof FISCAL_RULE_TAX_KINDS[number];

export type FiscalRuleCustomerScope =
  | "DOMESTIC_RESIDENT_BT"
  | "DOMESTIC_NON_RESIDENT_BT"
  | "NON_DOMESTIC_BT"
  | "NON_DOMESTIC_BT_BTA6"
  | "OTHER";

export interface ApprovedBillBinding {
  readonly billId: string;
  readonly approvedVersionId: string;
}

export interface FiscalEvidence {
  readonly sourceKind: FiscalEvidenceSourceKind;
  readonly sourceReference: string;
  readonly evidenceReference: string;
  readonly evidenceText: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly status: FiscalEvidenceStatus;
  readonly approvedBillBinding?: ApprovedBillBinding;
  readonly documentIdentifier?: string;
  readonly declarationIdentifier?: string;
  readonly approvalReference?: string;
}

export interface FiscalEvidenceAssertion<T extends string> {
  readonly value: T;
  readonly evidence: FiscalEvidence;
}

export interface FiscalMixedUseShare {
  readonly treatment: string;
  readonly percentage: number;
}

export interface FiscalMixedUseEvidence extends FiscalEvidence {
  readonly quantitativeShares?: readonly FiscalMixedUseShare[];
}

export interface FiscalRuleTierDefinition {
  readonly from?: number;
  readonly to?: number | null;
  readonly normalizedUnit: string;
  readonly rate?: number;
  readonly fixedAmount?: number;
}

export interface FiscalRuleRecordContract {
  readonly authority: FiscalRuleAuthority;
  readonly ruleCode: string;
  readonly taxKind: FiscalRuleTaxKind;
  readonly customerScope: FiscalRuleCustomerScope;
  readonly treatment: ExciseTaxTreatment | VatTreatment;
  readonly normalizedUnit?: string;
  readonly rate?: number;
  readonly tiers?: readonly FiscalRuleTierDefinition[];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly sourceReference: string;
  readonly officialIdentifier: string;
  readonly publicationDate: string;
  readonly retrievedAt: string;
  readonly checksum: string;
  readonly provenance: string;
  readonly sourceHealth: FiscalSourceHealth;
  readonly reviewStatus: "REVIEWED" | "NEEDS_REVIEW" | "BLOCKED";
}
