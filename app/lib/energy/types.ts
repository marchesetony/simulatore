export const ENERGY_DATA_SCHEMA_VERSION = 1 as const;

export type EnergyVector = "EE" | "GAS";
export type CustomerType = "RESIDENTIAL" | "NON_RESIDENTIAL";
export type TaxInclusionState = "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE";
export type QuantityUnit = "KWH" | "SMC";
export type MoneyUnit = "EUR";
export type MissingDataReason = "NOT_EXTRACTED" | "NOT_PROVIDED" | "NOT_APPLICABLE" | "UNREADABLE";

export type KnownNumber = {
  readonly status: "KNOWN";
  readonly value: number;
};

export type UnavailableNumber = {
  readonly status: "UNAVAILABLE";
  readonly reason: MissingDataReason;
};

export type NotApplicableNumber = {
  readonly status: "NOT_APPLICABLE";
  readonly reason: "NOT_APPLICABLE";
};

export type DeclaredNumber = KnownNumber | UnavailableNumber | NotApplicableNumber;

export type Quantity<U extends QuantityUnit = QuantityUnit> = {
  readonly unit: U;
  readonly status: "KNOWN";
  readonly value: number;
} | {
  readonly unit: U;
  readonly status: "UNAVAILABLE";
  readonly reason: MissingDataReason;
} | {
  readonly unit: U;
  readonly status: "NOT_APPLICABLE";
  readonly reason: "NOT_APPLICABLE";
};

export type DeclaredText = {
  readonly status: "KNOWN";
  readonly value: string;
} | {
  readonly status: "UNAVAILABLE";
  readonly reason: MissingDataReason;
} | {
  readonly status: "NOT_APPLICABLE";
  readonly reason: "NOT_APPLICABLE";
};

export type ApprovalMetadata = {
  readonly status: "DRAFT" | "NEEDS_REVIEW" | "REJECTED";
  readonly reason: string;
} | {
  readonly status: "APPROVED";
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly decisionId: string;
};

export interface VersionMetadata {
  readonly schemaVersion: typeof ENERGY_DATA_SCHEMA_VERSION;
  readonly recordId: string;
  readonly version: string;
  readonly parentVersionId: string | null;
  readonly tenantId: string;
  readonly approval: ApprovalMetadata;
}

export interface DatePeriod {
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface CustomerIdentity {
  readonly customerId: string;
  readonly customerType: CustomerType;
  readonly name: DeclaredText;
  readonly taxIdentifiers: readonly TaxIdentifier[];
}

export type TaxIdentifier = {
  readonly kind: "VAT_NUMBER" | "TAX_CODE";
  readonly value: string;
};

export interface MeterAndSupplyIdentifiers {
  readonly supplyId: string;
  readonly meterId: string;
}

export type VoltageLevel = "LV" | "MV" | "HV" | "EHV";

export interface ElectricitySupply extends MeterAndSupplyIdentifiers {
  readonly vector: "EE";
  readonly pod: string;
  readonly voltageLevel: VoltageLevel;
}

export interface GasSupply extends MeterAndSupplyIdentifiers {
  readonly vector: "GAS";
  readonly pdr: string;
}

export type Supply = ElectricitySupply | GasSupply;

export interface ElectricityConsumptionPeriod extends DatePeriod {
  readonly unit: "KWH";
  readonly quantity: Quantity<"KWH">;
}

export interface GasConsumptionPeriod extends DatePeriod {
  readonly unit: "SMC";
  readonly quantity: Quantity<"SMC">;
}

export type ConsumptionPeriod = ElectricityConsumptionPeriod | GasConsumptionPeriod;

export interface ElectricityCustomerSupplyRecord extends VersionMetadata {
  readonly recordType: "CUSTOMER_SUPPLY";
  readonly vector: "EE";
  readonly customer: CustomerIdentity;
  readonly supply: ElectricitySupply;
  readonly annualConsumption: Quantity<"KWH">;
  readonly consumptionPeriods: readonly ElectricityConsumptionPeriod[];
}

export interface GasCustomerSupplyRecord extends VersionMetadata {
  readonly recordType: "CUSTOMER_SUPPLY";
  readonly vector: "GAS";
  readonly customer: CustomerIdentity;
  readonly supply: GasSupply;
  readonly annualConsumption: Quantity<"SMC">;
  readonly consumptionPeriods: readonly GasConsumptionPeriod[];
}

export type CustomerSupplyRecord = ElectricityCustomerSupplyRecord | GasCustomerSupplyRecord;

export type ConsumptionBasis = "MEASURED" | "ESTIMATED" | "MIXED";
export type BillReviewState = "UNREVIEWED" | "NEEDS_REVIEW" | "REVIEWED" | "APPROVED" | "REJECTED";
export type BillFieldName =
  | "billingPeriod"
  | "customer"
  | "supply"
  | "consumption"
  | "supplier"
  | "offer"
  | "regulatedCharges";

export interface ExtractedFieldProvenance {
  readonly field: BillFieldName;
  readonly source: "BILL_DOCUMENT" | "MANUAL_REVIEW" | "REGULATORY_SOURCE" | "UNAVAILABLE";
  readonly sourceReference: string;
  readonly locator: string;
  readonly confidence: number;
  readonly reviewed: boolean;
}

export interface ExtractedValueProvenance {
  readonly path: string;
  readonly source: "BILL_DOCUMENT" | "MANUAL_REVIEW" | "REGULATORY_SOURCE" | "UNAVAILABLE";
  readonly sourceReference: string;
  readonly locator: string;
  readonly confidence: number;
  readonly reviewed: boolean;
}

export interface SupplierOfferReference {
  readonly supplier: string;
  readonly offerName: DeclaredText;
  readonly offerCode: DeclaredText;
}

export interface RegulatedCharge {
  readonly code: string;
  readonly label: string;
  readonly amount: number;
  readonly currency: MoneyUnit;
  readonly taxTreatment: TaxInclusionState;
}

export interface BillContractBase extends VersionMetadata {
  readonly recordType: "BILL";
  readonly vector: EnergyVector;
  readonly billId: string;
  readonly customerId: string;
  readonly customer?: CustomerIdentity;
  readonly supplyId: string;
  readonly billingPeriod: DatePeriod;
  readonly consumptionBasis: ConsumptionBasis;
  readonly currentSupplier: string;
  readonly offer: SupplierOfferReference;
  readonly regulatedCharges: readonly RegulatedCharge[];
  readonly fieldProvenance: readonly ExtractedFieldProvenance[];
  readonly valueProvenance?: readonly ExtractedValueProvenance[];
  readonly reviewState: BillReviewState;
}

export interface ElectricityBillConsumption {
  readonly vector: "EE";
  readonly f1: Quantity<"KWH">;
  readonly f2: Quantity<"KWH">;
  readonly f3: Quantity<"KWH">;
  readonly total: Quantity<"KWH">;
}

export interface GasBillConsumption {
  readonly vector: "GAS";
  readonly smc: Quantity<"SMC">;
  readonly correctionCoefficient: DeclaredNumber;
}

export interface ElectricityBillContract extends BillContractBase {
  readonly vector: "EE";
  readonly supply: ElectricitySupply;
  readonly consumption: ElectricityBillConsumption;
}

export interface GasBillContract extends BillContractBase {
  readonly vector: "GAS";
  readonly supply: GasSupply;
  readonly consumption: GasBillConsumption;
}

export type BillContract = ElectricityBillContract | GasBillContract;
