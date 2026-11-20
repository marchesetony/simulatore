/**
 * Motore V3 (Tony, 16/11/2026): the typed model of an economic component and of the inputs the engine accepts.
 * Inputs are quantities measured on the supply (kWh, kVArh, kW, period) and parameters from their official or contractual
 * source (CTE, ARERA, Terna, GME, law). The model has no field for an amount printed on the bill: printed amounts only enter
 * the reconciliation (reconcile.ts), on their own side.
 */

export type V3Band = "F1" | "F2" | "F3";

/** Canonical categories: each one belongs to exactly one group and one reconciliation leaf. */
export type V3Category =
  | "ENERGY" | "LOSSES" | "COMMERCIALIZATION" | "IMBALANCE" | "DISPATCHING" | "CAPACITY_REGULATED" | "CAPACITY_CONTRACTUAL"
  | "SELLER_FIXED_FEE"
  | "NETWORK_FIXED" | "NETWORK_POWER" | "NETWORK_ENERGY" | "TRANSMISSION_ENERGY" | "METERING_FIXED" | "UC3_ENERGY" | "UC6_ENERGY" | "UC6_FIXED"
  | "ARIM_FIXED" | "ARIM_POWER" | "ARIM_ENERGY" | "ASOS_FIXED" | "ASOS_POWER" | "ASOS_ENERGY"
  | "REACTIVE_ENERGY"
  | "ONE_OFF_FEE"
  | "EXCISE" | "VAT";

export type V3Group = "SELLER" | "NETWORK" | "SYSTEM" | "REACTIVE" | "ONE_OFF" | "TAXES";

/** The amounts a bill prints separately (Bolletta 2.0 quadro sintetico and detail), at their finest level. */
export type V3LeafKey = "SELLER_CONSUMPTION" | "SELLER_FIXED" | "ONE_OFF" | "NETWORK" | "SYSTEM" | "REACTIVE" | "EXCISE" | "VAT";
/** Printed sums of leaves: the "rete e oneri" of the quotas, the taxes line, the bill total. */
export type V3ParentKey = "SELLER" | "NETWORK_AND_SYSTEM" | "TAXES" | "TOTAL";
export type V3ReconciliationKey = V3LeafKey | V3ParentKey;

export const CATEGORY_GROUP: Readonly<Record<V3Category, V3Group>> = {
  ENERGY: "SELLER", LOSSES: "SELLER", COMMERCIALIZATION: "SELLER", IMBALANCE: "SELLER", DISPATCHING: "SELLER", CAPACITY_REGULATED: "SELLER", CAPACITY_CONTRACTUAL: "SELLER", SELLER_FIXED_FEE: "SELLER",
  NETWORK_FIXED: "NETWORK", NETWORK_POWER: "NETWORK", NETWORK_ENERGY: "NETWORK", TRANSMISSION_ENERGY: "NETWORK", METERING_FIXED: "NETWORK", UC3_ENERGY: "NETWORK", UC6_ENERGY: "NETWORK", UC6_FIXED: "NETWORK",
  ARIM_FIXED: "SYSTEM", ARIM_POWER: "SYSTEM", ARIM_ENERGY: "SYSTEM", ASOS_FIXED: "SYSTEM", ASOS_POWER: "SYSTEM", ASOS_ENERGY: "SYSTEM",
  REACTIVE_ENERGY: "REACTIVE",
  ONE_OFF_FEE: "ONE_OFF",
  EXCISE: "TAXES", VAT: "TAXES",
};

export const CATEGORY_LEAF: Readonly<Record<V3Category, V3LeafKey>> = {
  ENERGY: "SELLER_CONSUMPTION", LOSSES: "SELLER_CONSUMPTION", COMMERCIALIZATION: "SELLER_CONSUMPTION", IMBALANCE: "SELLER_CONSUMPTION", DISPATCHING: "SELLER_CONSUMPTION", CAPACITY_REGULATED: "SELLER_CONSUMPTION", CAPACITY_CONTRACTUAL: "SELLER_CONSUMPTION",
  SELLER_FIXED_FEE: "SELLER_FIXED",
  NETWORK_FIXED: "NETWORK", NETWORK_POWER: "NETWORK", NETWORK_ENERGY: "NETWORK", TRANSMISSION_ENERGY: "NETWORK", METERING_FIXED: "NETWORK", UC3_ENERGY: "NETWORK", UC6_ENERGY: "NETWORK", UC6_FIXED: "NETWORK",
  ARIM_FIXED: "SYSTEM", ARIM_POWER: "SYSTEM", ARIM_ENERGY: "SYSTEM", ASOS_FIXED: "SYSTEM", ASOS_POWER: "SYSTEM", ASOS_ENERGY: "SYSTEM",
  REACTIVE_ENERGY: "REACTIVE",
  ONE_OFF_FEE: "ONE_OFF",
  EXCISE: "EXCISE", VAT: "VAT",
};

export const PARENT_LEAVES: Readonly<Record<V3ParentKey, readonly V3LeafKey[]>> = {
  SELLER: ["SELLER_CONSUMPTION", "SELLER_FIXED"],
  NETWORK_AND_SYSTEM: ["NETWORK", "SYSTEM"],
  TAXES: ["EXCISE", "VAT"],
  TOTAL: ["SELLER_CONSUMPTION", "SELLER_FIXED", "ONE_OFF", "NETWORK", "SYSTEM", "REACTIVE", "EXCISE", "VAT"],
};

export type V3SourceKind = "CTE" | "ARERA" | "TERNA" | "GME" | "LAW" | "MEASURE" | "RULE";
/**
 * How a value was checked. ORIGINAL_DOCUMENT: read on the issuing authority's own document. REPRODUCTION: read on a copy
 * published by someone else (e.g. a distributor), while the original could not be read: the value is usable but not verified
 * at the primary source, and every total that depends on it stays provisional.
 */
export interface V3Verification { readonly level: "ORIGINAL_DOCUMENT" | "REPRODUCTION"; readonly checkedOn: string; readonly note?: string }
/** Where a value comes from: document, table or rule, with the words or row that prove it. */
export interface V3Source { readonly kind: V3SourceKind; readonly reference: string; readonly evidence?: string; readonly verification?: V3Verification }

export type V3ParameterUnit = "EUR/MWh" | "EUR/kWh" | "EUR/kVArh" | "cEUR/kVArh" | "EUR/kW/year" | "EUR/POD/year" | "EUR/month" | "EUR/year" | "EUR/contract" | "RATIO";
/** A price, tariff or coefficient: exact decimal text, its unit and its source. */
export interface V3Parameter { readonly value: string; readonly unit: V3ParameterUnit; readonly source: V3Source }

export type V3LossTreatment = "NET_OF_LOSSES" | "GROSS_OF_LOSSES";

export type V3Completeness = "COMPLETE" | "INCOMPLETE" | "NOT_DETERMINABLE" | "NOT_DUE";

export type V3QuantityUnit = "kWh" | "kVArh" | "kW×month" | "month" | "POD×month" | "contract" | "EUR";
export type V3PriceUnit = "EUR/kWh" | "EUR/kVArh" | "EUR/kW/month" | "EUR/POD/month" | "EUR/month" | "EUR/contract" | "ratio";

export interface V3Component {
  /** Stable identity: category plus qualifier (band, fee id, tier). Two components never share it. */
  readonly id: string;
  readonly category: V3Category;
  readonly group: V3Group;
  readonly leaf: V3LeafKey;
  readonly label: string;
  /** Exact quantity and unit (kWh of the band, kW × months, months, contracts; the taxable base for VAT). */
  readonly quantity: { readonly value: string; readonly unit: V3QuantityUnit } | null;
  /** Exact unit price applied to the quantity, after any loss factor or monthly conversion the formula states. */
  readonly unitPrice: { readonly value: string; readonly unit: V3PriceUnit } | null;
  readonly formula: { readonly id: string; readonly expression: string };
  readonly period: { readonly start: string; readonly endExclusive: string };
  readonly sources: readonly V3Source[];
  readonly vatTaxable: boolean;
  readonly recurrence: "RECURRING" | "ONE_OFF";
  /** Exact amount before the one rounding, as decimal text; null when not determinable. */
  readonly exactAmount: string | null;
  /** Rounded amount in euro cents; null when not determinable. */
  readonly amountCents: number | null;
  readonly completeness: V3Completeness;
  /** Why the component is incomplete, not determinable or not due. */
  readonly reason?: string;
  /** Always calculated: the engine never takes an amount from a bill. */
  readonly provenance: "CALCULATED";
  readonly assumptions: readonly string[];
}

/**
 * Reactive energy measured on the supply (kVArh) in the period, by kind and band, as the meter reading or the billed quantity
 * reports it. "ALL" means the band is not known: the TIT applies its thresholds band by band, so such a measure cannot be priced.
 */
export interface V3ReactiveMeasure { readonly kind: "WITHDRAWN" | "INJECTED"; readonly band: V3Band | "ALL"; readonly kvarh: string }
/**
 * One row of the official reactive-energy table (TIT 2024-2027 art. 32 and Tabella 5; before 2024 Tabella 4): for the kVArh of
 * the given kind in each listed band, the part between `fromRatio` and `toRatio` × the active energy of the same band and month
 * is billed at `rate`. Valid on [validFrom, validToExclusive) for one voltage level. Rows are official values loaded as they are
 * published (c€/kVArh accepted), never values printed on a bill.
 */
export interface V3ReactiveTariffRow {
  readonly id: string;
  readonly voltage: "BT" | "MT";
  readonly validFrom: string;
  readonly validToExclusive: string | null;
  readonly kind: "WITHDRAWN" | "INJECTED";
  readonly bands: readonly V3Band[];
  readonly fromRatio: string;
  readonly toRatio: string | null;
  readonly rate: V3Parameter;
}

export interface V3FeeTerm { readonly id: string; readonly label: string; readonly rate: V3Parameter }
export interface V3PerKwhTerm { readonly rate: V3Parameter; readonly losses: V3LossTreatment }

export interface V3Input {
  readonly supply: {
    readonly vector: "EE";
    readonly customer: "NON_DOMESTIC" | "DOMESTIC";
    readonly voltage: "BT" | "MT" | "AT";
    /** Official tariff row the regulated parameters belong to (e.g. "BTA6"). */
    readonly tariffClass: string;
    /** kW the power quota is billed on, with its source (committed power or monthly maximum drawn, per tariff class). */
    readonly powerKw: { readonly value: string; readonly source: V3Source };
    /** Available power (kW): decides whether the reactive tariff applies to a BT supply (> 16,5 kW). Null when not known. */
    readonly availablePowerKw?: { readonly value: string; readonly source: V3Source } | null;
  };
  readonly period: { readonly start: string; readonly endExclusive: string };
  /** Active energy measured in the period (net of losses), by band. */
  readonly consumption: { readonly bands: Readonly<Record<V3Band, string>>; readonly source: V3Source };
  readonly reactive: { readonly measures: readonly V3ReactiveMeasure[]; readonly source: V3Source } | null;
  readonly contract: {
    readonly cteCode: string;
    readonly cteVersion: string;
    readonly energy: { readonly index: "PUN"; readonly spread: V3Parameter; readonly lossesOn: "INDEX_AND_SPREAD" | "INDEX_ONLY" | "NONE"; readonly lossesSource: V3Source };
    readonly commercialization: V3PerKwhTerm | null;
    readonly imbalance: V3PerKwhTerm | null;
    /** Official dispatching passed through, increased by the loss factor when the CTE says so. */
    readonly dispatching: { readonly losses: V3LossTreatment; readonly source: V3Source } | null;
    readonly capacityRegulated: { readonly losses: V3LossTreatment; readonly source: V3Source } | null;
    readonly capacityContractual: V3PerKwhTerm | null;
    readonly fixedFees: readonly V3FeeTerm[];
    readonly oneOffFees: readonly V3FeeTerm[];
  };
  readonly market: { readonly pun: Readonly<Record<V3Band, V3Parameter>> };
  readonly regulated: {
    readonly lossFactor: V3Parameter;
    readonly dispatching: V3Parameter | null;
    readonly capacity: V3Parameter | null;
    readonly network: { readonly fixed: V3Parameter | null; readonly power: V3Parameter | null; readonly energy: V3Parameter | null; readonly transmission: V3Parameter | null; readonly metering: V3Parameter | null; readonly uc3Energy: V3Parameter | null; readonly uc6Energy: V3Parameter | null; readonly uc6Fixed: V3Parameter | null };
    readonly system: { readonly arimFixed: V3Parameter | null; readonly arimPower: V3Parameter | null; readonly arimEnergy: V3Parameter | null; readonly asosFixed: V3Parameter | null; readonly asosPower: V3Parameter | null; readonly asosEnergy: V3Parameter | null };
    /** Official reactive table rows on file (any period and voltage): the engine selects the applicable ones. */
    readonly reactiveTariff: readonly V3ReactiveTariffRow[] | null;
  };
  /** Whether this bill is the first of the new supply: decides the one-off fees (null = unknown). */
  readonly billing: { readonly firstBillOfSupply: boolean | null; readonly source: V3Source };
  readonly taxes: {
    readonly vatRate: V3Parameter;
    /** Excise for non-domestic uses: monthly tiers of the law (first tier up to `tier1MonthlyKwh`). */
    readonly exciseNonDomestic: { readonly tier1Rate: V3Parameter; readonly tier1MonthlyKwh: string; readonly tier2Rate: V3Parameter; readonly tier2MonthlyKwh: string } | null;
  };
}
