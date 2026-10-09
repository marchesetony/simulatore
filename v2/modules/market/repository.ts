import "server-only";
import type { AcquisitionAttempt, PublicationEvent } from "./acquisition";
import { FoundationError } from "./errors";
import type { Review } from "./governance";
import type { MarketObservation, MarketSnapshot, MarketSource, MarketVersion } from "./types";

export interface WriteGuard { readonly expectedRevision: number; readonly idempotencyKey: string }
export interface Receipt { readonly revision: number; readonly idempotencyKey: string }
/** One transaction: reject the ENTIRE batch on conflict, dangling reference or invalid snapshot.
 * IDs append-only. Reused idempotency keys must have identical content and return the original receipt.
 * Persist raw documents in a separately attested store before registering their references.
 * Reviews are append-only events; never update version content. CAS spans the whole domain catalog.
 * Shared institutional data contains no tenant/customer/bill data. Consumers remain tenant-scoped.
 * PUBLISHED attempts require a matching immutable event and a newly published snapshot in the same batch.
 * Validate event/attempt/source/version identities and chronology with validatePublication before committing.
 */
export interface AtomicBatch<S, V, R, Snapshot> {
  readonly sources: readonly S[];
  readonly versions: readonly V[];
  readonly records: readonly R[];
  readonly reviews: readonly { readonly versionId: string; readonly review: Review }[];
  readonly snapshots: readonly Snapshot[];
  readonly attempts: readonly AcquisitionAttempt[];
  readonly publications: readonly PublicationEvent[];
}
export interface SnapshotRepository<S, V, R, Snapshot> {
  commit(batch: AtomicBatch<S, V, R, Snapshot>, guard: WriteGuard): Promise<Receipt>;
  getSnapshot(snapshotId: string): Promise<Snapshot | null>;
  /** Explicit version IDs and cutoff. Never infer latest or sort a revision label. */
  selectAsOf(versionIds: readonly string[], asOf: string): Promise<readonly V[]>;
}
export type MarketBatch = AtomicBatch<MarketSource, MarketVersion, MarketObservation, MarketSnapshot>;
export type MarketRepository = SnapshotRepository<MarketSource, MarketVersion, MarketObservation, MarketSnapshot>;
/** Fail-closed production placeholder, no database/schema/provider installed. */
export function unavailableRepository<S, V, R, Snapshot>(): SnapshotRepository<S, V, R, Snapshot> {
  const blocked = async (): Promise<never> => { throw new FoundationError("UNAVAILABLE"); };
  return Object.freeze({ commit: blocked, getSnapshot: blocked, selectAsOf: blocked });
}
export const marketRepository: MarketRepository = unavailableRepository();
