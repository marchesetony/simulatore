import { economicState } from "./economic-state";
import { fail } from "./errors";
import { immutable } from "./integrity";
import { choice, distinct, list, object, text } from "./primitives";
import { month, period, timestamp } from "./temporal";
import type { MarketObservation, MarketRequest, SelectionPolicy } from "./types";

export { parseSource as parseMarketSource, parseVersion as parseMarketVersion } from "./governance";
export function selectionPolicy(input: unknown): SelectionPolicy {
  const r = object(input, ["mode", "previousSnapshotId", "versionIds"]);
  const result = { mode: choice(r.mode, ["REPLAY", "RECALCULATION"]),
    previousSnapshotId: r.previousSnapshotId === null ? null : text(r.previousSnapshotId), versionIds: list(r.versionIds, text) };
  distinct(result.versionIds);
  if (!result.versionIds.length || (result.mode === "RECALCULATION" && !result.previousSnapshotId) ||
      (result.mode === "REPLAY" && result.previousSnapshotId !== null)) return fail("INVALID_INPUT");
  return result;
}
export function parseMarketObservation(input: unknown): MarketObservation {
  const r = object(input, ["observationId", "versionId", "referenceMonth", "band", "unit", "sourceLocator", "valueState", "value", "evidence"]);
  return immutable({ observationId: text(r.observationId), versionId: text(r.versionId), referenceMonth: month(r.referenceMonth),
    band: choice(r.band, ["F1", "F2", "F3"]), unit: choice(r.unit, ["EUR_PER_MWH"]), sourceLocator: text(r.sourceLocator),
    ...economicState({ valueState: r.valueState, value: r.value, evidence: r.evidence }) });
}
export function parseMarketRequest(input: unknown): MarketRequest {
  const r = object(input, ["snapshotId", "coverage", "selectionPolicy", "asOf", "createdAt", "observationIds"]);
  const result = { snapshotId: text(r.snapshotId), coverage: period(r.coverage), selectionPolicy: selectionPolicy(r.selectionPolicy),
    asOf: timestamp(r.asOf), createdAt: timestamp(r.createdAt), observationIds: list(r.observationIds, text) };
  distinct(result.observationIds);
  if (result.asOf > result.createdAt) return fail("INVALID_INPUT");
  return immutable(result);
}
