import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte, syntheticElectricityCte as base } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { CteArchiveRecordUnreadableError, readStoredCteArchives, validateStoredCteArchive } from "../app/lib/cte/archive/validation.ts";
import { withOneOffRepair } from "../app/lib/cte/one-off-repair.ts";
import { createMarketArchive } from "../app/lib/market/service.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { syntheticElectricityPun } from "../app/lib/energy/synthetic-fixtures.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { SupabaseProductionStorageAdapter } from "../app/lib/production/supabase.ts";

// Tony (9/11/2026, "lettura tollerante, scrittura rigorosa"): one unreadable CTE must not stop the company's archive or the
// simulations of its valid CTEs; a single read and every write stay strict. Synthetic data only, no database, no local archive.
const tenant = "tenant_tolerant-smoke";
const otherTenant = "tenant_other-smoke";
const approval = { status: "APPROVED", reviewer: "smoke-reviewer", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "smoke-approval" };
const fee = (feeId, amount, unit) => ({ feeId, label: feeId, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const cte = (id, tenantId = tenant) => ({
  ...structuredClone(base), recordId: id, cteId: id, tenantId, approval,
  supplier: { supplierId: `${id}-supplier`, name: `${id} Supplier` }, offer: { offerId: `${id}-offer`, name: `${id} Offer`, code: `${id}-CODE` },
  validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
  eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] },
  pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.2, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
  commercialTerms: { fixedFees: [fee(`${id}-fixed`, 4, "EUR_PER_MONTH")], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [] },
});
const now = "2026-01-02T00:00:00.000Z";
const request = () => parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 } }, tenant);
// The realistic incompatibility: a value an older reader does not know (here the stored legacy index).
const breakRecord = (record) => { const copy = structuredClone(record); copy.versions[0].contract.pricing = { ...copy.versions[0].contract.pricing, mode: "INDEXED", reference: "FORMULA_INDEX", spread: { amount: 0.01, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" } }; return copy; };
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(" ")); };

const root = await mkdtemp(path.join(os.tmpdir(), "cte-tolerant-read-"));
try {
  // ---------- Local archive ----------
  const repository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const valid1 = await createCteArchive(repository, { tenantId: tenant, contract: cte("cte-valid-1"), now, actor: "SMOKE" });
  const valid2 = await createCteArchive(repository, { tenantId: tenant, contract: cte("cte-valid-2"), now, actor: "SMOKE" });
  const otherValid = await createCteArchive(repository, { tenantId: otherTenant, contract: cte("cte-other-valid", otherTenant), now, actor: "SMOKE" });
  const otherBroken = await createCteArchive(repository, { tenantId: otherTenant, contract: cte("cte-other-broken", otherTenant), now, actor: "SMOKE" });

  // 1. All valid.
  let listed = await repository.listWithExclusions(tenant);
  assert.deepEqual(listed.records.map((record) => record.archiveId).sort(), [valid1.archiveId, valid2.archiveId].sort());
  assert.deepEqual(listed.excluded, []);
  console.log("ALL_VALID_ARCHIVE=PASS");

  // Break one record of this tenant and one of the other tenant directly in the stored file (as an older/newer writer would).
  const file = path.join(root, "cte", "metadata.json");
  const store = JSON.parse(await readFile(file, "utf8"));
  const brokenOwn = breakRecord(store.records.find((record) => record.archiveId === valid2.archiveId));
  store.records = store.records.map((record) => record.archiveId === valid2.archiveId ? brokenOwn : record.archiveId === otherBroken.archiveId ? breakRecord(record) : record);
  await writeFile(file, JSON.stringify(store));
  const brokenOwnRaw = JSON.stringify(brokenOwn);
  const brokenOtherRaw = JSON.stringify(store.records.find((record) => record.archiveId === otherBroken.archiveId));

  // 2. One unreadable record among valid ones: the others are listed, the excluded one is reported without content.
  listed = await repository.listWithExclusions(tenant);
  assert.deepEqual(listed.records.map((record) => record.archiveId), [valid1.archiveId]);
  assert.deepEqual(listed.excluded, [{ tenantId: tenant, archiveId: valid2.archiveId, code: "EE_REFERENCE_INVALID" }]);
  assert.deepEqual((await repository.list(tenant)).map((record) => record.archiveId), [valid1.archiveId]);
  assert.ok(warnings.some((line) => line === `[CTE_ARCHIVE_RECORD_EXCLUDED] tenant=${tenant} archive=${valid2.archiveId} code=EE_REFERENCE_INVALID`));
  assert.ok(warnings.every((line) => !line.includes("Supplier") && !line.includes("0.01")), "log carries identifiers and code only");
  console.log("ONE_INVALID_AMONG_VALID=PASS");

  // 3. Unreadable record of another tenant: invisible to this tenant, reported only to its own tenant.
  assert.deepEqual((await repository.listWithExclusions(otherTenant)).records.map((record) => record.archiveId), [otherValid.archiveId]);
  assert.deepEqual((await repository.listWithExclusions(otherTenant)).excluded.map((item) => item.archiveId), [otherBroken.archiveId]);
  assert.equal(listed.excluded.some((item) => item.tenantId === otherTenant), false);
  console.log("OTHER_TENANT_ISOLATED=PASS");

  // 4. Single read of the unreadable CTE: explicit error, never null.
  await assert.rejects(repository.get(tenant, valid2.archiveId), (error) => error instanceof CteArchiveRecordUnreadableError && error.reason === "EE_REFERENCE_INVALID" && error.archiveId === valid2.archiveId);
  assert.equal((await repository.get(tenant, valid1.archiveId))?.archiveId, valid1.archiveId);
  console.log("SINGLE_READ_STRICT=PASS");

  // 5. Writes stay strict: an invalid record is refused; the unreadable one cannot be overwritten or removed.
  await assert.rejects(repository.save(breakRecord(await repository.get(tenant, valid1.archiveId))), /EE_REFERENCE_INVALID/);
  const overwrite = { ...structuredClone(await repository.get(tenant, valid1.archiveId)), archiveId: valid2.archiveId };
  validateStoredCteArchive(overwrite);
  await assert.rejects(repository.save(overwrite), CteArchiveRecordUnreadableError);
  await assert.rejects(repository.remove(tenant, valid2.archiveId), CteArchiveRecordUnreadableError);
  console.log("SAVE_INVALID_REFUSED=PASS");

  // 8. No loss or change of the stored originals, even after writes of other records.
  const extra = await createCteArchive(repository, { tenantId: tenant, contract: cte("cte-valid-3"), now, actor: "SMOKE" });
  const after = JSON.parse(await readFile(file, "utf8"));
  assert.equal(JSON.stringify(after.records.find((record) => record.archiveId === valid2.archiveId)), brokenOwnRaw);
  assert.equal(JSON.stringify(after.records.find((record) => record.archiveId === otherBroken.archiveId)), brokenOtherRaw);
  assert.equal(after.records.length, 5);
  assert.ok(after.records.some((record) => record.archiveId === extra.archiveId));
  console.log("ORIGINAL_RECORDS_PRESERVED=PASS");

  // 9. Simulations on valid CTEs are unchanged by an unreadable neighbour.
  const marketRepository = new LocalMarketArchiveRepository(path.join(root, "market"));
  await createMarketArchive(marketRepository, { tenantId: tenant, record: { ...structuredClone(syntheticElectricityPun), tenantId: tenant, recordId: "pun-2026-01", version: "1", month: "2026-01", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01", publicationDate: "2026-02-01", approval }, now, actor: "SMOKE" });
  const cleanRepository = new LocalCteArchiveRepository(path.join(root, "clean"));
  await createCteArchive(cleanRepository, { tenantId: tenant, archiveId: valid1.archiveId, contract: cte("cte-valid-1"), now, actor: "SMOKE" });
  const withNeighbour = await calculateApprovedOffer(repository, marketRepository, request(), valid1.archiveId);
  const alone = await calculateApprovedOffer(cleanRepository, marketRepository, request(), valid1.archiveId);
  // Same CTE content in a clean archive: same components and totals (version ids differ, so fingerprints do).
  assert.deepEqual(withNeighbour.components.map((item) => [item.componentId, item.amount.minorUnits]), alone.components.map((item) => [item.componentId, item.amount.minorUnits]));
  assert.ok(withNeighbour.components.length > 0);
  assert.equal(withNeighbour.totalCommercialCost.minorUnits, alone.totalCommercialCost.minorUnits);
  // The one-off repair wrapper used at runtime keeps the exclusion summary.
  const wrapped = withOneOffRepair(repository, { list: async () => [], get: async () => null });
  assert.deepEqual((await wrapped.listWithExclusions(tenant)).excluded.map((item) => item.archiveId), [valid2.archiveId]);
  console.log("VALID_CTE_SIMULATION_UNCHANGED=PASS");

  // Store-level corruption is still an error, never an empty archive.
  await writeFile(file, JSON.stringify({ schemaVersion: 2, records: [] }));
  await assert.rejects(repository.list(tenant), /ARCHIVE_STORE_CORRUPT/);
  console.log("STORE_CORRUPTION_NOT_EMPTY=PASS");

  // ---------- Supabase archive (fake provider) ----------
  const rows = [];
  const row = (tenantId, record) => ({ collection: "cte-archives", tenant_id: tenantId, record_id: record.archiveId, schema_version: 1, version: 1, created_at: now, updated_at: now, payload: structuredClone(record), idempotency_key: null });
  class FakeQuery {
    constructor(client) { this.client = client; this.filters = []; this.single = false; }
    select() { return this; } eq(column, value) { this.filters.push([column, value]); return this; } order() { return this; } maybeSingle() { this.single = true; return this; }
    then(resolve) {
      if (this.client.failure) return resolve({ data: null, error: { code: this.client.failure } });
      const selected = rows.filter((candidate) => this.filters.every(([column, value]) => candidate[column] === value)).map((candidate) => structuredClone(candidate));
      return resolve({ data: this.single ? (selected[0] ?? null) : selected, error: null });
    }
  }
  const client = { failure: null, from: () => new FakeQuery(client), storage: { from: () => ({}) }, rpc: async (name, args) => {
    if (name !== "runtime_put_record") throw new Error(`UNEXPECTED_RPC:${name}`);
    const current = rows.find((candidate) => candidate.tenant_id === args.p_tenant_id && candidate.record_id === args.p_record_id && candidate.collection === args.p_collection);
    if (current) { current.version += 1; current.payload = structuredClone(args.p_payload); return { data: [structuredClone(current)], error: null }; }
    const created = { ...row(args.p_tenant_id, args.p_payload), collection: args.p_collection }; rows.push(created); return { data: [structuredClone(created)], error: null };
  } };
  const supabase = new SupabaseProductionStorageAdapter(client, "bill-documents").cteArchiveRepository;
  const validRecord = JSON.parse(JSON.stringify(after.records.find((record) => record.archiveId === valid1.archiveId)));
  const brokenRecord = JSON.parse(brokenOwnRaw);
  rows.push(row(tenant, validRecord), row(tenant, brokenRecord), row(otherTenant, JSON.parse(brokenOtherRaw)));
  const providerList = await supabase.listWithExclusions(tenant);
  assert.deepEqual(providerList.records.map((record) => record.archiveId), [valid1.archiveId]);
  assert.deepEqual(providerList.excluded, [{ tenantId: tenant, archiveId: valid2.archiveId, code: "EE_REFERENCE_INVALID" }]);
  await assert.rejects(supabase.get(tenant, valid2.archiveId), CteArchiveRecordUnreadableError);
  assert.equal((await supabase.get(tenant, valid1.archiveId))?.archiveId, valid1.archiveId);
  await assert.rejects(supabase.save(breakRecord(validRecord)), /EE_REFERENCE_INVALID/);
  await assert.rejects(supabase.save({ ...validRecord, archiveId: valid2.archiveId, versions: validRecord.versions.map((version) => ({ ...version })) }), CteArchiveRecordUnreadableError);
  assert.equal(JSON.stringify(rows.find((candidate) => candidate.record_id === valid2.archiveId).payload), brokenOwnRaw);
  console.log("SUPABASE_TOLERANT_LIST_STRICT_READ_WRITE=PASS");

  // 6-7. Connection and authorization errors still fail the call: never an apparently empty archive.
  for (const failure of ["PGRST301", "42501", "PERSISTENCE_PROVIDER_ERROR"]) {
    client.failure = failure;
    await assert.rejects(supabase.list(tenant), new RegExp(failure));
    await assert.rejects(supabase.listWithExclusions(tenant), new RegExp(failure));
    await assert.rejects(supabase.get(tenant, valid1.archiveId), new RegExp(failure));
  }
  client.failure = null;
  console.log("CONNECTION_AND_AUTHORIZATION_ERRORS_PROPAGATE=PASS");

  // Pure helper: per-record validation, codes only.
  const pure = readStoredCteArchives([{ tenantId: tenant, archiveId: "a", payload: validRecord }, { tenantId: tenant, archiveId: "b", payload: { secret: "IBAN IT00" } }]);
  assert.equal(pure.records.length, 1);
  assert.equal(pure.excluded[0].archiveId, "b");
  assert.ok(!JSON.stringify(pure.excluded).includes("IBAN"));
  assert.equal(syntheticElectricityCte.pricing.reference, "PUN");
  console.log("cte archive tolerant read smoke: ok");
} finally {
  console.warn = originalWarn;
  await rm(root, { recursive: true, force: true });
}
