import type { EconomicState } from "./economic-state";
import type { Source, Version } from "./governance";
import type { Period } from "./temporal";

export type MarketSource = Source;
export type MarketVersion = Version;
export type Band = "F1" | "F2" | "F3";
export type MarketObservation = EconomicState & {
  readonly observationId: string; readonly versionId: string; readonly referenceMonth: string;
  readonly band: Band; readonly unit: "EUR_PER_MWH"; readonly sourceLocator: string;
};
export interface SelectionPolicy {
  readonly mode: "REPLAY" | "RECALCULATION";
  readonly previousSnapshotId: string | null;
  readonly versionIds: readonly string[];
}
export interface MarketRequest {
  readonly snapshotId: string; readonly coverage: Period; readonly selectionPolicy: SelectionPolicy;
  readonly asOf: string; readonly createdAt: string; readonly observationIds: readonly string[];
}
export interface MarketSnapshot extends MarketRequest {
  readonly schemaVersion: 1;
  readonly sources: readonly MarketSource[];
  readonly versions: readonly MarketVersion[];
  readonly versionHistory: readonly MarketVersion[];
  readonly observations: readonly MarketObservation[];
  readonly hash: string;
}
