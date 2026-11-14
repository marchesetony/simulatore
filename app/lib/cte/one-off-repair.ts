// Tony (1/11, after Be Family Casa Protetta vs Fast): "non vorrei che lo stesso errore lo rifacciamo anche su altre cte, di
// nuovi clienti o anche su quelle che abbiamo". CTEs approved before the fix lost their first-bill one-off when they also had
// an early-exit penalty. Their reading is still stored with the ingestion (same id as the contract's cteId), so every read of
// the archive rebuilds the one-off from that reading, for every company, without re-uploading and without writing anything.
// The penalty is left out of the repaired contract: it is never priced, and a contract holds one or the other.
import type { CteContract } from "./types";
import type { CteArchiveRecord, CteArchiveRepository } from "./archive/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { tryBuildAuthoritativeCteContract } from "./review.ts";

/** The stored reading of one CTE, as far as the repair needs it. */
export interface StoredCteReading {
  readonly documentId: string;
  readonly fields: Parameters<typeof tryBuildAuthoritativeCteContract>[0]["fields"];
  readonly vector: "EE" | "GAS";
  readonly documentType: Parameters<typeof tryBuildAuthoritativeCteContract>[0]["documentType"];
  readonly ingestionId: string;
}
export interface StoredCteReadings { get(tenantId: string, recordId: string): Promise<{ readonly payload: StoredCteReading } | null> }

export function lostOneOff(contract: CteContract): boolean {
  return contract.commercialTerms.exitFee !== undefined && contract.commercialTerms.oneOffFees.length === 0;
}

/** The contract with the one-off its own reading holds, or the same contract when there is nothing to give back. */
export function withReadOneOff(contract: CteContract, reading: StoredCteReading | null, tenantId: string): CteContract {
  if (!reading || !lostOneOff(contract)) return contract;
  let rebuilt: CteContract | null = null;
  try { rebuilt = tryBuildAuthoritativeCteContract({ ...reading, tenantId }).contract; } catch { return contract; }
  const oneOffFees = rebuilt?.commercialTerms.oneOffFees ?? [];
  if (!oneOffFees.length) return contract;
  const { exitFee: _penalty, ...terms } = contract.commercialTerms;
  return { ...contract, commercialTerms: { ...terms, oneOffFees } } as CteContract;
}

export async function repairArchiveRecord(record: CteArchiveRecord, readings: StoredCteReadings): Promise<CteArchiveRecord> {
  if (!record.versions.some((version) => lostOneOff(version.contract))) return record;
  const cache = new Map<string, StoredCteReading | null>();
  const versions = [];
  for (const version of record.versions) {
    if (!lostOneOff(version.contract)) { versions.push(version); continue; }
    const id = version.contract.cteId;
    if (!cache.has(id)) cache.set(id, await readings.get(record.tenantId, id).then((found) => found?.payload ?? null, () => null));
    versions.push({ ...version, contract: withReadOneOff(version.contract, cache.get(id) ?? null, record.tenantId) });
  }
  return { ...record, versions };
}

export function withOneOffRepair(repository: CteArchiveRepository, readings: StoredCteReadings): CteArchiveRepository {
  return {
    ...repository,
    get: async (tenantId, archiveId) => { const record = await repository.get(tenantId, archiveId); return record ? repairArchiveRecord(record, readings) : null; },
    list: async (tenantId) => Promise.all((await repository.list(tenantId)).map((record) => repairArchiveRecord(record, readings))),
    ...(repository.listWithExclusions ? { listWithExclusions: async (tenantId: string) => { const result = await repository.listWithExclusions!(tenantId); return { records: await Promise.all(result.records.map((record) => repairArchiveRecord(record, readings))), excluded: result.excluded }; } } : {}),
    // Versions are immutable once stored: a save writes back the stored contract of every repaired version, never the repair.
    save: async (record, capability) => {
      const stored = await repository.get(record.tenantId, record.archiveId);
      const original = new Map((stored?.versions ?? []).filter((version) => lostOneOff(version.contract)).map((version) => [version.versionId, version.contract]));
      await repository.save(original.size ? { ...record, versions: record.versions.map((version) => original.has(version.versionId) ? { ...version, contract: original.get(version.versionId)! } : version) } : record, capability);
    },
    ...(repository.remove ? { remove: (tenantId: string, archiveId: string) => repository.remove!(tenantId, archiveId) } : {}),
  };
}
