import type { EconomicState } from "../market/economic-state";
import type { Source, Version } from "../market/governance";
import type { Period } from "../market/temporal";
import type { SelectionPolicy } from "../market/types";

export type RegulatorySource = Source & { readonly authorityReference: string };
export type RegulatoryVersion = Version;
export type EconomicDomain = "NETWORK" | "SYSTEM_CHARGE" | "DISPATCH" | "TAX" | "COMMERCIAL" | "MARKET";
export type ApplicationBasis = "ENERGY_KWH" | "ENERGY_MWH" | "POWER_KW" | "POWER_KW_YEAR" | "MONTH" | "YEAR" | "PERIOD" | "PERCENTAGE";
export type RegulatoryUnit = "EUR_PER_KWH" | "EUR_PER_MWH" | "EUR_PER_KW" | "EUR_PER_KW_YEAR" | "EUR_PER_MONTH" | "EUR_PER_YEAR" | "EUR_PER_PERIOD" | "PERCENT";
export type RegulatoryComponent = EconomicState & Period & {
  readonly componentId: string; readonly code: string; readonly economicDomain: EconomicDomain;
  readonly customerScope: string; readonly applicationBasis: ApplicationBasis; readonly unit: RegulatoryUnit;
  readonly sourceVersionId: string; readonly sourceLocator: string;
  readonly applicability: { readonly status: "APPLIES" | "DOES_NOT_APPLY"; readonly evidence: string };
  readonly includes: readonly string[]; readonly excludes: readonly string[];
};
export interface RegulatoryRequest {
  readonly snapshotId: string; readonly coverage: Period; readonly selectionPolicy: SelectionPolicy;
  readonly asOf: string; readonly createdAt: string; readonly componentIds: readonly string[];
  /** Explicit required economic identities; completeness cannot be inferred from provided rows. */
  readonly requiredIdentities: readonly string[];
}
export interface RegulatorySnapshot extends RegulatoryRequest {
  readonly schemaVersion: 1; readonly components: readonly RegulatoryComponent[];
  readonly relationComponents: readonly RegulatoryComponent[];
  readonly versions: readonly RegulatoryVersion[]; readonly sources: readonly RegulatorySource[];
  readonly versionHistory: readonly RegulatoryVersion[];
  readonly validationResult: "VALID"; readonly hash: string;
}
