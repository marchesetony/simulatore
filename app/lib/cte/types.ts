import type {
  ApprovalMetadata,
  CustomerType,
  DatePeriod,
  EnergyVector,
  TaxInclusionState,
  VersionMetadata,
  VoltageLevel,
} from "../energy/types";

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
}

export interface ElectricityCteEligibility extends CteEligibility {
  readonly voltageLevels: readonly VoltageLevel[];
}

export type GasCteEligibility = CteEligibility;

export interface CtePrice {
  readonly amount: number;
  readonly currency: "EUR";
  readonly unit: "EUR_PER_KWH" | "EUR_PER_SMC";
  readonly taxTreatment: TaxInclusionState;
}

export type CteFeeUnit = "EUR_PER_KWH" | "EUR_PER_SMC" | "EUR_PER_MONTH" | "EUR_PER_YEAR" | "EUR_PER_CONTRACT";

export interface CteFeeComponent {
  readonly feeId: string;
  readonly label: string;
  readonly amount: number;
  readonly currency: "EUR";
  readonly unit: CteFeeUnit;
  readonly taxTreatment: TaxInclusionState;
}

export type CtePassThroughKind = "DISPATCHING" | "CAPACITY_MARKET" | "OTHER_CONTRACTUAL_PASS_THROUGH";
export type CtePassThroughDeclarationState = "EXPLICIT_COMPONENT" | "INCLUDED_IN_ENERGY_PRICE" | "NOT_APPLICABLE" | "NOT_DECLARED" | "EXTERNAL_PASS_THROUGH";

type CtePassThroughBase = {
  readonly componentId: string;
  readonly kind: CtePassThroughKind;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
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
  readonly fixedFees: readonly CteFeeComponent[];
  readonly variableFees: readonly CteFeeComponent[];
  readonly imbalance: CteDeclaredComponent;
  readonly oneOffFees: readonly CteFeeComponent[];
  readonly commercialDiscounts: readonly CteFeeComponent[];
  readonly passThroughComponents?: readonly CtePassThroughComponent[];
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
