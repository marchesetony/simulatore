import type { CustomerResidency, CustomerType, TaxInclusionState, VoltageLevel } from "../energy/types";
import type { RegulatoryValueComponentCode, RegulatoryCustomerScope } from "../foundation/regulatory-types";

export const CALCULATION_SCHEMA_VERSION = 1 as const;
export const CALCULATION_ENGINE_VERSION = "1" as const;
export const CALCULATION_CURRENCY = "EUR" as const;

export interface SimulationPeriod {
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface SourceBillReference {
  readonly billId: string;
  /** Compatibility field: canonical BillVersion.versionId, never versionNumber. */
  readonly version: string;
}

export interface SimulationBaseline {
  readonly totalCommercialCost: number;
  readonly currency: "EUR";
  readonly taxTreatment: TaxInclusionState;
  readonly supplyPeriod: SimulationPeriod;
}

export interface SimulationRequestBase {
  readonly schemaVersion: typeof CALCULATION_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly calculationDate: string;
  readonly supplyPeriod: SimulationPeriod;
  readonly customerCategory: CustomerType;
  readonly residency?: CustomerResidency;
  readonly currency: "EUR";
  readonly taxTreatment: TaxInclusionState;
  readonly sourceBill?: SourceBillReference;
  readonly baseline?: SimulationBaseline;
}

export interface ElectricityMonthlyProfile {
  readonly month: string;
  readonly f1: number;
  readonly f2: number;
  readonly f3: number;
}

export interface ElectricityConsumptionInput {
  readonly basis: "PERIOD" | "ANNUAL";
  readonly unit: "KWH";
  readonly f1: number;
  readonly f2: number;
  readonly f3: number;
  readonly monthlyProfile?: readonly ElectricityMonthlyProfile[];
}

export interface ElectricitySimulationRequest extends SimulationRequestBase {
  readonly vector: "EE";
  readonly voltageLevel: VoltageLevel;
  readonly consumption: ElectricityConsumptionInput;
}

export interface GasMonthlyProfile {
  readonly month: string;
  readonly smc: number;
}

export interface GasCorrectionCoefficient {
  readonly required: boolean;
  readonly value?: number;
}

export interface GasConsumptionInput {
  readonly basis: "PERIOD" | "ANNUAL";
  readonly unit: "SMC";
  readonly smc: number;
  readonly monthlyProfile?: readonly GasMonthlyProfile[];
  readonly correctionCoefficient: GasCorrectionCoefficient;
}

export interface GasSimulationRequest extends SimulationRequestBase {
  readonly vector: "GAS";
  readonly consumption: GasConsumptionInput;
}

export type SimulationRequest = ElectricitySimulationRequest | GasSimulationRequest;

export type CalculationExclusionCode =
  | "TENANT_MISMATCH"
  | "VECTOR_MISMATCH"
  | "CTE_NOT_APPROVED"
  | "CTE_COMMERCIAL_BLOCKED"
  | "CTE_COMMERCIAL_DELETED"
  | "CTE_EXPIRED"
  | "CTE_VALIDITY_MISMATCH"
  | "CUSTOMER_NOT_ELIGIBLE"
  | "VOLTAGE_NOT_ELIGIBLE"
  | "TAX_TREATMENT_INCOMPATIBLE"
  | "CURRENCY_INCOMPATIBLE"
  | "CALCULATION_READY_INVALID"
  | "CALCULATION_INPUT_INVALID"
  | "MONTHLY_PROFILE_REQUIRED"
  | "MARKET_DATA_MISSING"
  | "MARKET_DATA_INVALID"
  | "CORRECTION_COEFFICIENT_REQUIRED"
  | "FEE_UNIT_MISMATCH"
  | "IMBALANCE_UNAVAILABLE"
  | "ONE_OFF_FEE_UNIT_INVALID"
  | "COMPARISON_INCOMPATIBLE";

export interface CalculationExclusion {
  readonly archiveId: string;
  readonly cteId: string;
  readonly vector: "EE" | "GAS";
  readonly supplier: string;
  readonly offerCode: string;
  readonly cteVersion: string | null;
  readonly code: CalculationExclusionCode;
  readonly message: string;
}

export interface CalculationMoney {
  readonly amount: number;
  readonly minorUnits: number;
  readonly currency: "EUR";
}

export interface CalculationComponent {
  readonly componentId: string;
  readonly category: "ENERGY" | "FIXED_FEE" | "VARIABLE_FEE" | "IMBALANCE" | "ONE_OFF_FEE" | "DISCOUNT" | "REGULATED_ENERGY" | "REGULATED_POWER" | "REGULATED_FIXED";
  readonly label: string;
  readonly sign: "CHARGE" | "DISCOUNT";
  readonly amount: CalculationMoney;
  readonly formulaId: string;
  readonly formulaInputs: Readonly<Record<string, string | number | boolean>>;
}

export interface RegulatoryDataReference {
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope: RegulatoryCustomerScope;
  readonly normalizedUnit: string;
  readonly normalizedValue: number;
  readonly regulatoryRecordId: string;
  readonly checksum: string;
  readonly officialIdentifier: string;
  readonly sourceReference: string;
  readonly segmentStart: string;
  readonly segmentEnd: string;
  readonly sourceSha256?: string;
  readonly publicationDate?: string;
}

export interface RegulatoryData {
  readonly references: readonly RegulatoryDataReference[];
}

export type CalculationCostScope = "COMMERCIAL_ONLY" | "COMMERCIAL_PLUS_REGULATED_PARTIAL";
export type RegulatedComponentIncluded = "UC3_ENERGY" | "UC6_ENERGY" | "UC6_POWER" | "NETWORK_FIXED" | "NETWORK_POWER" | "TRANSMISSION_ENERGY";

export interface CalculationMarketReference {
  readonly recordId: string;
  readonly version: string;
  readonly vector: "EE" | "GAS";
  readonly index: "PUN" | "PSV";
  readonly month: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface CalculationResult {
  readonly schemaVersion: typeof CALCULATION_SCHEMA_VERSION;
  readonly engineVersion: typeof CALCULATION_ENGINE_VERSION;
  readonly calculationId: string;
  readonly fingerprint: string;
  readonly calculatedAt: string;
  readonly tenantId: string;
  readonly vector: "EE" | "GAS";
  readonly customerCategory: CustomerType;
  readonly voltageLevel?: VoltageLevel;
  readonly calculationDate: string;
  readonly supplyPeriod: SimulationPeriod;
  readonly currency: "EUR";
  readonly taxTreatment: TaxInclusionState;
  readonly normalizedInput: SimulationRequest;
  readonly sourceCte: { readonly archiveId: string; readonly cteId: string; readonly versionId: string; readonly version: string; readonly supplier: string; readonly offerCode: string };
  readonly marketData: readonly CalculationMarketReference[];
  readonly components: readonly CalculationComponent[];
  readonly totalCommercialCost: CalculationMoney;
  readonly totalRegulatedSubsetCost: CalculationMoney | null;
  readonly totalCommercialPlusRegulatedSubsetCost: CalculationMoney | null;
  readonly costScope: CalculationCostScope;
  readonly regulatedComponentsIncluded: readonly RegulatedComponentIncluded[];
  readonly regulatoryData: RegulatoryData;
  readonly unitCost: { readonly amount: number; readonly unit: "EUR_PER_KWH" | "EUR_PER_SMC"; readonly currency: "EUR" };
  readonly savingsVsBaseline: CalculationMoney | null;
  readonly warnings: readonly string[];
  readonly roundingPolicy: "ROUND_HALF_UP_TO_CENT_PER_COMPONENT";
}
