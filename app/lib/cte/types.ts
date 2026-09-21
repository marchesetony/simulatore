import type {
  ApprovalMetadata,
  CustomerType,
  DatePeriod,
  EnergyVector,
  TaxInclusionState,
  VersionMetadata,
  VoltageLevel,
} from "../energy/types";
import type { CteAllowedCustomerType, IdentifierType, LegalForm, SupplyUseScope } from "../eligibility/domain";

export type CteApprovalMetadata = ApprovalMetadata;

export interface CteSupplier {
  readonly supplierId: string;
  readonly name: string;
}

export interface CteOffer {
  readonly offerId: string;
  readonly name: string;
  readonly code: string;
}

export interface CteEligibility {
  readonly customerTypes: readonly CustomerType[];
  /** Optional commercial scope. Legacy contracts without it retain coarse customerTypes semantics. */
  readonly customerScopes?: readonly CteCommercialCustomerScope[];
  /** Canonical legal-type scope, extracted only from explicit source evidence. */
  readonly allowedCustomerTypes?: readonly CteAllowedCustomerType[];
  /** Canonical supply-use scope, independent from customer legal type. */
  readonly allowedSupplyUses?: readonly SupplyUseScope[];
  readonly allowedLegalForms?: readonly LegalForm[];
  readonly allowedIdentifierTypes?: readonly IdentifierType[];
  readonly annualConsumptionRule?: CteAnnualConsumptionRule;
}

export interface CteAnnualConsumptionRule {
  readonly operator: ">" | ">=" | "<" | "<=" | "=";
  readonly value: number;
  readonly unit: "KWH_PER_YEAR" | "SMC_PER_YEAR";
  readonly sourceEvidence: string;
}

export type CteCommercialCustomerScope =
  | "DOMESTIC_BT"
  | "DOMESTIC_RESIDENT_BT"
  | "DOMESTIC_NON_RESIDENT_BT"
  | "NON_DOMESTIC_BT"
  | "NON_DOMESTIC_OTHER_USE"
  | "NON_DOMESTIC_BT_BTA6"
  | "ALL_ELECTRICITY"
  | "DOMESTIC_GAS"
  | "NON_DOMESTIC_GAS"
  | "ALL_GAS";

export interface ElectricityCteEligibility extends CteEligibility {
  readonly voltageLevels: readonly VoltageLevel[];
}

export type GasCteEligibility = CteEligibility;

export interface CtePrice {
  readonly amount: number;
  readonly currency: "EUR";
  readonly unit: "EUR_PER_KWH" | "EUR_PER_SMC";
  readonly taxTreatment: TaxInclusionState;
  readonly lossTreatment?: CteLossTreatment;
}

export type CteFeeUnit = "EUR_PER_KWH" | "EUR_PER_SMC" | "EUR_PER_POD" | "EUR_PER_MONTH" | "EUR_PER_YEAR" | "EUR_PER_CONTRACT";
export type CteFeePeriod = "MONTH" | "YEAR" | "CONTRACT";
export type CteLossTreatment = "NET_OF_LOSSES" | "GROSS_OF_LOSSES" | "OFFICIAL_REFERENCE" | "INCLUDED" | "EXCLUDED" | "NOT_DECLARED";
export type CteCapacityTimeClass = "ALL" | "PEAK" | "CAPACITY_MARKET_LIBERO";

export interface CteOfficialReference {
  readonly authority: "ARERA" | "TERNA" | "ARERA_TERNA";
  readonly document: string;
  readonly table?: string;
  readonly column?: string;
  readonly article?: string;
  readonly sourceEvidence: string;
}

export interface CtePunResolutionRule {
  readonly index: "PUN";
  readonly resolution: "MONTHLY_ARITHMETIC_MEAN";
  readonly periodBasis: "CALENDAR_MONTH";
  readonly timeBands: readonly ("MONO" | "F1" | "F2" | "F3" | "F23")[];
  readonly application: "PER_TIME_BAND";
  readonly spreadApplication: "ADD_TO_INDEXED_UNIT_PRICE";
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly sourceEvidence: string;
}

export interface CteCapacityMarketScheduleEntry {
  readonly voltageScope?: VoltageLevel;
  readonly timeClass: CteCapacityTimeClass;
  readonly value: number;
  readonly unit: "EUR_PER_KWH";
  readonly mode: "OFFICIAL_PASS_THROUGH" | "FIXED_VALUE";
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly lossTreatment: CteLossTreatment;
  readonly officialReference?: CteOfficialReference;
  readonly sourceEvidence: string;
}

export interface CteDispatchingReference {
  readonly mode: "OFFICIAL_PASS_THROUGH";
  readonly reference: CteOfficialReference;
  readonly formula: string;
  readonly lossTreatment: "OFFICIAL_REFERENCE";
  readonly snapshotValue?: number;
  readonly snapshotUnit?: "EUR_PER_KWH";
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly sourceEvidence: string;
}

export interface CteLossReference {
  readonly lossMode: "OFFICIAL_REFERENCE";
  readonly reference: CteOfficialReference;
  readonly applicationTargets: readonly ("DISPATCHING" | "ENERGY_INDEX" | "SPREAD" | "COMMERCIALIZATION_FEE" | "IMBALANCE" | "CAPACITY_MARKET")[];
  readonly sourceEvidence: string;
}

export interface CteFeeComponent {
  readonly feeId: string;
  readonly label: string;
  readonly amount: number;
  readonly currency: "EUR";
  readonly unit: CteFeeUnit;
  /** Optional semantic period for typed commercial fees. Legacy fees omit it. */
  readonly period?: CteFeePeriod;
  /** Derived display equivalent; never an additional billable fee. */
  readonly monthlyEquivalent?: number;
  readonly taxTreatment: TaxInclusionState;
  readonly lossTreatment?: CteLossTreatment;
}

export interface CteEconomicDuration {
  readonly value: number;
  readonly unit: "MONTHS";
  readonly sourceText: string;
}

export interface CteLossSemantics {
  readonly present: true;
  readonly rawText: string;
  readonly appliesTo: "SPREAD" | "ENERGY_PRICE" | "NETWORK_LOSSES" | "UNSPECIFIED";
  readonly provenance: string;
}

export interface CteExitFee {
  readonly amount: number;
  readonly currency: "EUR";
  readonly condition: "EARLY_EXIT_BEFORE_DURATION";
  readonly durationReference: CteEconomicDuration;
  readonly sourceText: string;
}

export type CtePassThroughKind = "DISPATCHING" | "CAPACITY_MARKET" | "OTHER_CONTRACTUAL_PASS_THROUGH";
export type CtePassThroughDeclarationState = "EXPLICIT_COMPONENT" | "INCLUDED_IN_ENERGY_PRICE" | "NOT_APPLICABLE" | "NOT_DECLARED" | "EXTERNAL_PASS_THROUGH";

type CtePassThroughBase = {
  readonly componentId: string;
  readonly kind: CtePassThroughKind;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly documentPresence?: "DOCUMENT_STATED" | "NOT_STATED";
  readonly amountStatus?: "DECLARED" | "NOT_DECLARED";
  readonly sourceText?: string;
};

export type CtePassThroughComponent = CtePassThroughBase & ({
  readonly declarationState: "EXPLICIT_COMPONENT";
  readonly fee: CteFeeComponent;
} | {
  readonly declarationState: "INCLUDED_IN_ENERGY_PRICE" | "NOT_APPLICABLE" | "NOT_DECLARED";
  readonly fee?: never;
  readonly externalReference?: never;
} | {
  readonly declarationState: "EXTERNAL_PASS_THROUGH";
  readonly fee?: never;
  readonly externalReference: string;
});

export type CteDeclaredComponent = {
  readonly status: "DECLARED";
  readonly component: CteFeeComponent;
} | {
  readonly status: "NOT_DECLARED";
  readonly reason: "NOT_PROVIDED" | "NOT_APPLICABLE";
};

export interface CteCommercialTerms {
  readonly fixedFees: readonly CteFeeComponent[];
  readonly variableFees: readonly CteFeeComponent[];
  readonly imbalance: CteDeclaredComponent;
  readonly oneOffFees: readonly CteFeeComponent[];
  readonly commercialDiscounts: readonly CteFeeComponent[];
  readonly passThroughComponents?: readonly CtePassThroughComponent[];
  readonly economicDuration?: CteEconomicDuration;
  readonly lossSemantics?: CteLossSemantics;
  readonly exitFee?: CteExitFee;
  readonly punRule?: CtePunResolutionRule;
  readonly capacityMarketSchedule?: readonly CteCapacityMarketScheduleEntry[];
  readonly dispatchingReference?: CteDispatchingReference;
  readonly lossReference?: CteLossReference;
}

export type ElectricityPricing = {
  readonly mode: "INDEXED";
  readonly reference: "PUN";
  readonly spread: CtePrice;
} | {
  readonly mode: "FIXED";
  readonly reference: "NONE";
  readonly fixedPrice: CtePrice;
  readonly spread: CteDeclaredComponent;
};

export type GasPricing = {
  readonly mode: "INDEXED";
  readonly reference: "PSV";
  readonly spread: CtePrice;
} | {
  readonly mode: "FIXED";
  readonly reference: "NONE";
  readonly fixedPrice: CtePrice;
  readonly spread: CteDeclaredComponent;
};

export type CteExpiry = {
  readonly status: "EXPIRES_ON";
  readonly date: string;
} | {
  readonly status: "NO_EXPIRY_DECLARED";
  readonly reason: "NOT_PROVIDED";
};

export interface CteBase extends VersionMetadata {
  readonly recordType: "CTE";
  readonly cteId: string;
  /** Import provenance used to keep synthetic QA cleanup tenant-safe. */
  readonly sourceProvenance?: string;
  readonly supplier: CteSupplier;
  readonly offer: CteOffer;
  readonly validity: DatePeriod;
  readonly expiry: CteExpiry;
  readonly currency: "EUR";
  readonly taxTreatment: TaxInclusionState;
  readonly commercialTerms: CteCommercialTerms;
}

export interface ElectricityCteContract extends CteBase {
  readonly vector: "EE";
  readonly eligibility: ElectricityCteEligibility;
  readonly pricing: ElectricityPricing;
}

export interface GasCteContract extends CteBase {
  readonly vector: "GAS";
  readonly eligibility: GasCteEligibility;
  readonly pricing: GasPricing;
}

export type CteContract = ElectricityCteContract | GasCteContract;

export type CalculationReadyOfferBase = {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly sourceCteId: string;
  readonly sourceCteVersion: string;
  readonly approval: ApprovalMetadata;
  readonly offerId: string;
  readonly supplierId: string;
  readonly offerCode: string;
  readonly offerName: string;
  readonly currency: "EUR";
  readonly taxTreatment: TaxInclusionState;
  readonly validity: DatePeriod;
  readonly expiry: CteExpiry;
  readonly eligibility: CteEligibility;
  readonly fixedFees: readonly CteFeeComponent[];
  readonly variableFees: readonly CteFeeComponent[];
  readonly imbalance: CteDeclaredComponent;
  readonly oneOffFees: readonly CteFeeComponent[];
  readonly commercialDiscounts: readonly CteFeeComponent[];
  readonly passThroughComponents?: readonly CtePassThroughComponent[];
  readonly economicDuration?: CteEconomicDuration;
  readonly lossSemantics?: CteLossSemantics;
  readonly exitFee?: CteExitFee;
  readonly punRule?: CtePunResolutionRule;
  readonly capacityMarketSchedule?: readonly CteCapacityMarketScheduleEntry[];
  readonly dispatchingReference?: CteDispatchingReference;
  readonly lossReference?: CteLossReference;
};

export interface ElectricityCalculationReadyOffer extends CalculationReadyOfferBase {
  readonly vector: "EE";
  readonly pricing: ElectricityPricing;
}

export interface GasCalculationReadyOffer extends CalculationReadyOfferBase {
  readonly vector: "GAS";
  readonly pricing: GasPricing;
}

export type CalculationReadyOffer = ElectricityCalculationReadyOffer | GasCalculationReadyOffer;

export type CteVector = EnergyVector;
