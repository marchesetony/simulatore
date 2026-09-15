import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import { aggregateGmePt15Intervals, classifyGmePt15Band, loadGmeHistoricalPunRecords, MAX_OUTER_ZIP_BYTES } from "../app/lib/market/gme-historical-archive.ts";
import { createOfficialPunSourceReader } from "../app/lib/market-refresh/source.ts";
import { runPunMarketRefresh } from "../app/lib/market-refresh/service.ts";

const archivePath = process.env.GME_A7_ARCHIVE_PATH ?? join(tmpdir(), "simulatore-gme-audit-20260911-075709", "Anno2026.zip");
const archiveBytes = await readFile(archivePath);
const fetcher = async () => ({ status: 200, headers: { get: () => "application/octet-stream" }, arrayBuffer: async () => archiveBytes.buffer.slice(archiveBytes.byteOffset, archiveBytes.byteOffset + archiveBytes.byteLength) });
const expected = {
  "2026-05": [119.351258457661, 107.174032852273, 131.437566444444, 120.81478809593],
  "2026-06": [132.504586652778, 125.760125119048, 151.700243860947, 127.235538359375],
  "2026-07": [157.038393581989, 154.2014475, 169.383664594972, 152.256162323718],
  "2026-08": [179.998943098118, 174.516221601732, 204.353050857988, 171.715990930233],
};
const result = await loadGmeHistoricalPunRecords({ tenantId: "tenant_a7", referenceMonths: ["2026-05", "2026-06", "2026-07", "2026-08"], retrievedAt: "2026-09-11T00:00:00.000Z", fetcher });
assert.equal(result.workbookName, "Anno 2026_08_15.xlsx");
assert.equal(result.worksheetName, "Prezzi-Prices");
assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
assert.equal(result.records.length, 4);
for (const record of result.records) {
  const values = [record.monthly?.value, record.f1?.value, record.f2?.value, record.f3?.value];
  assert.ok(values.every(Number.isFinite));
  assert.ok(values.every((value, index) => Math.abs(value - expected[record.month][index]) < 1e-9));
  assert.equal(record.source.authority, "GME");
  assert.equal(record.source.sourceType, "OFFICIAL");
  assert.equal(record.source.sourceSha256, result.sourceSha256);
  assert.equal(record.effectiveFrom, `${record.month}-01`);
}
console.log("GME_HISTORICAL_MAY_AUGUST_VALUES=PASS");

const synthetic = (date, count) => Array.from({ length: count }, (_, index) => ({ date, hour: Math.floor(index / 4) + 1, period: index + 1, pun: index + 0.125 }));
for (const [date, count, companion] of [["2026-03-29", 92, "2026-03-30"], ["2026-05-04", 96, null], ["2026-10-25", 100, "2026-10-26"]]) {
  const intervals = [...synthetic(date, count), ...(companion ? synthetic(companion, 96) : [])];
  const record = aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: date.slice(0, 7), intervals, requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" });
  assert.ok(record.monthly && record.f1 && record.f2 && record.f3);
}
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-03", intervals: synthetic("2026-03-29", 96), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PT15_DAY_COUNT_INVALID/);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-05", intervals: synthetic("2026-05-04", 92), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PT15_DAY_COUNT_INVALID/);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-05", intervals: synthetic("2026-05-04", 100), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PT15_DAY_COUNT_INVALID/);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-10", intervals: synthetic("2026-10-25", 96), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PT15_DAY_COUNT_INVALID/);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-03", intervals: synthetic("2026-03-29", 92).map((interval, index) => index === 88 ? { ...interval, hour: 24 } : interval), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PT15_PERIOD_HOUR_MISMATCH/);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-10", intervals: synthetic("2026-10-25", 100).map((interval, index) => index === 8 ? { ...interval, hour: 2 } : interval), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PT15_PERIOD_HOUR_MISMATCH/);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-05", intervals: synthetic("2026-05-04", 96).map((interval, index) => index === 4 ? { ...interval, hour: 3 } : interval), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PT15_PERIOD_HOUR_MISMATCH/);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-05", intervals: [...synthetic("2026-05-04", 96), { ...synthetic("2026-05-04", 96)[0], pun: 999 }], requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_DUPLICATE_INTERVAL_CONFLICT/);
console.log("GME_PT15_DST_92_96_100_AND_DUPLICATES=PASS");

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) { const existing = await this.get(input.tenantId, input.recordId); if (existing && input.expectedVersion === undefined) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS"); const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? input.now, updatedAt: input.now, payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }; this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next; }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}
const repositories = { marketArchiveRepository: new (class { constructor() { this.records = []; } async get(_tenant, id) { return this.records.find((record) => record.archiveId === id) ?? null; } async list(_tenant) { return this.records; } async save(record) { this.records.push(structuredClone(record)); } })(), marketRefreshState: new MemoryRepository(), marketRefreshRuns: new MemoryRepository(), marketRefreshLocks: new MemoryRepository() };
const dry = await runPunMarketRefresh({ tenantId: "tenant_a7", repositories, sourceReader: createOfficialPunSourceReader({ historicalFetcher: fetcher }), now: "2026-09-11T00:00:00.000Z", runId: "a7-dry-run", trigger: "MANUAL", dryRun: true });
assert.deepEqual(dry.targetMonths, ["2026-08", "2026-07", "2026-06", "2026-05"]);
assert.equal(dry.status, "SUCCESS");
assert.equal(dry.monthsChecked, 4);
assert.equal(dry.monthsComplete, 4);
assert.equal(dry.monthsFailed, 0);
assert.equal((await repositories.marketArchiveRepository.list("tenant_a7")).length, 0);
assert.equal((await repositories.marketRefreshRuns.list("tenant_a7")).length, 0);
console.log("GME_HISTORICAL_DRY_RUN_4_OF_4_NO_WRITE=PASS");

assert.equal(classifyGmePt15Band({ date: "2026-05-01", hour: 9 }), "F3");
assert.equal(classifyGmePt15Band({ date: "2026-05-04", hour: 9 }), "F1");
assert.equal(classifyGmePt15Band({ date: "2026-05-02", hour: 8 }), "F2");
assert.equal(classifyGmePt15Band({ date: "2026-05-03", hour: 12 }), "F3");
for (const [hour, band] of [[1, "F3"], [7, "F3"], [8, "F2"], [9, "F1"], [19, "F1"], [20, "F2"], [23, "F2"], [24, "F3"], [25, "F3"]]) assert.equal(classifyGmePt15Band({ date: "2026-05-04", hour }), band);
for (const [hour, band] of [[1, "F3"], [7, "F3"], [8, "F2"], [23, "F2"], [24, "F3"], [25, "F3"]]) assert.equal(classifyGmePt15Band({ date: "2026-05-02", hour }), band);
for (const hour of [1, 8, 9, 19, 20, 23, 24, 25]) assert.equal(classifyGmePt15Band({ date: "2026-05-01", hour }), "F3");
const precise = aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-05", intervals: synthetic("2026-05-04", 96).map((interval, index) => ({ ...interval, pun: index + 0.123456 })), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" });
assert.ok(Math.abs(precise.monthly.value - 47.623456) < 1e-12);
assert.throws(() => aggregateGmePt15Intervals({ tenantId: "tenant_a7", referenceMonth: "2026-05", intervals: synthetic("2026-05-04", 96).map((interval, index) => index === 0 ? { ...interval, pun: Number.NaN } : interval), requireCompleteMonth: false, retrievedAt: "2026-09-11T00:00:00.000Z" }), /GME_PUN_VALUE_INVALID/);
console.log("ARERA_BANDS_HOLIDAY_AND_NO_EARLY_ROUNDING=PASS");

const fetchBytes = (bytes) => async () => ({ status: 200, headers: { get: () => "application/zip" }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
assert.rejects(loadGmeHistoricalPunRecords({ tenantId: "tenant_a7", referenceMonths: ["2026-08"], retrievedAt: "2026-09-11T00:00:00.000Z", fetcher: fetchBytes(zipSync({ "../Anno 2026_08_15.xlsx": new Uint8Array([1]) })) }), /GME_ZIP_SLIP_BLOCKED/);
assert.rejects(loadGmeHistoricalPunRecords({ tenantId: "tenant_a7", referenceMonths: ["2026-08"], retrievedAt: "2026-09-11T00:00:00.000Z", fetcher: fetchBytes(new Uint8Array(MAX_OUTER_ZIP_BYTES + 1)) }), /GME_ZIP_SIZE_INVALID/);
const maliciousInner = zipSync({ "xl/workbook.xml": new TextEncoder().encode("<!DOCTYPE workbook [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><workbook/>") });
const maliciousOuter = zipSync({ "Anno 2026_08_15.xlsx": maliciousInner });
assert.rejects(loadGmeHistoricalPunRecords({ tenantId: "tenant_a7", referenceMonths: ["2026-08"], retrievedAt: "2026-09-11T00:00:00.000Z", fetcher: fetchBytes(maliciousOuter) }), /GME_XML_EXTERNAL_ENTITY_BLOCKED/);
console.log("ZIP_BOMB_ZIP_SLIP_AND_XML_XXE_GUARDS=PASS");
console.log("gme historical archive smoke: ok");
