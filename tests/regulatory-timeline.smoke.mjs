import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { resolveRegulatoryTimeline } from "../app/lib/calculation/regulatory-timeline.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put() { throw new Error("PUT_NOT_USED"); }
  async append(input) {
    if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT");
    const now = input.now ?? "2026-08-25T00:00:00.000Z";
    const record = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: now, updatedAt: now, payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records.push(record);
    return record;
  }
}

const tenantA = "tenant_timeline-a";
const tenantB = "tenant_timeline-b";

function regulatoryRecord({
  tenantId = tenantA,
  id = "reg-1",
  componentCode = "NETWORK_ENERGY",
  customerScope = "DOMESTIC_RESIDENT_BT",
  effectiveFrom = "2026-07-01",
  effectiveTo = "2026-08-01",
  approvalStatus = "APPROVED",
  reviewStatus = "APPROVED",
  normalizedValue = 11,
} = {}) {
  const base = {
    tenantId,
    id,
    identityKey: `${tenantId}|${id}`,
    version: "1",
    parentVersionId: null,
    authority: "ARERA",
    sourceType: "OFFICIAL_ATTACHMENT",
    sourceReference: "https://official.example/timeline-fixture",
    officialIdentifier: `OFFICIAL-${id}`,
    publicationDate: "2026-06-01",
    retrievedAt: "2026-06-02T00:00:00Z",
    effectiveFrom,
    effectiveTo,
    vector: "EE",
    customerScope,
    componentCode,
    originalValue: normalizedValue,
    originalUnit: "TEST_UNIT",
    normalizedValue,
    normalizedUnit: "TEST_UNIT",
    applicationBasis: "timeline fixture only",
    sourceSha256: "a".repeat(64),
    conversionProvenance: ["deterministic-test-fixture"],
    approvalStatus,
    reviewStatus,
  };
  return { ...base, checksum: checksumFor(base) };
}

async function bridgeWith(records) {
  const bridge = new ProductionRegulatoryPersistenceBridge(new MemoryRepository());
  for (const record of records) await bridge.save(record.tenantId, record);
  return bridge;
}

function request(overrides = {}) {
  return {
    tenantId: tenantA,
    componentCode: "NETWORK_ENERGY",
    customerScope: "DOMESTIC_RESIDENT_BT",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-01",
    ...overrides,
  };
}

async function assertCode(action, code) {
  await assert.rejects(action, (error) => error?.code === code || error?.message === code, `expected ${code}`);
}

function directBridgeWith(records) {
  return { async list() { return records; } };
}

const singleBridge = await bridgeWith([regulatoryRecord({ effectiveFrom: "2026-06-01", effectiveTo: null })]);
let observedQuery;
const observedBridge = { async list(tenantId, query) { observedQuery = { tenantId, query }; return singleBridge.list(tenantId, query); } };
const single = await resolveRegulatoryTimeline(observedBridge, request());
assert.deepEqual(observedQuery, { tenantId: tenantA, query: { componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_RESIDENT_BT" } });
assert.equal(single.segments.length, 1);
assert.deepEqual(single.segments[0], {
  segmentStart: "2026-07-01T00:00:00.000Z",
  segmentEnd: "2026-09-01T00:00:00.000Z",
  regulatoryRecordId: "reg-1",
  regulatoryVersion: "1",
  authority: "ARERA",
  componentCode: "NETWORK_ENERGY",
  customerScope: "DOMESTIC_RESIDENT_BT",
  normalizedValue: 11,
  normalizedUnit: "TEST_UNIT",
  applicationBasis: "timeline fixture only",
  effectiveFrom: "2026-06-01",
  effectiveTo: null,
  officialIdentifier: "OFFICIAL-reg-1",
  checksum: regulatoryRecord({ effectiveFrom: "2026-06-01", effectiveTo: null }).checksum,
});

const originalTimezone = process.env.TZ;
try {
  process.env.TZ = "Pacific/Honolulu";
  const pacific = await resolveRegulatoryTimeline(singleBridge, request({ periodStart: "2026-08-01", periodEnd: "2026-08-02" }));
  process.env.TZ = "Europe/Rome";
  const rome = await resolveRegulatoryTimeline(singleBridge, request({ periodStart: "2026-08-01", periodEnd: "2026-08-02" }));
  assert.deepEqual(rome.segments, pacific.segments);
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}

const utcTimestamp = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "timestamp-z", effectiveFrom: "2026-08-01T00:00:00Z", effectiveTo: "2026-08-02T00:00:00Z" }),
]), request({ periodStart: "2026-08-01", periodEnd: "2026-08-02" }));
assert.equal(utcTimestamp.segments[0].segmentStart, "2026-08-01T00:00:00.000Z");
assert.equal(utcTimestamp.segments[0].segmentEnd, "2026-08-02T00:00:00.000Z");

const offsetTimestamp = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "timestamp-offset", effectiveFrom: "2026-08-01T02:00:00+02:00", effectiveTo: "2026-08-02T02:00:00+02:00" }),
]), request({ periodStart: "2026-08-01", periodEnd: "2026-08-02" }));
assert.equal(offsetTimestamp.segments[0].segmentStart, "2026-08-01T00:00:00.000Z");
assert.equal(offsetTimestamp.segments[0].segmentEnd, "2026-08-02T00:00:00.000Z");

await assertCode(() => resolveRegulatoryTimeline(directBridgeWith([
  regulatoryRecord({ id: "invalid-calendar-date", effectiveFrom: "2026-02-30", effectiveTo: "2026-03-01" }),
]), request({ periodStart: "2026-02-01", periodEnd: "2026-03-01" })), "REGULATORY_TIMELINE_DATE_INVALID");
await assertCode(() => resolveRegulatoryTimeline(directBridgeWith([
  regulatoryRecord({ id: "non-leap-year", effectiveFrom: "2026-02-29", effectiveTo: "2026-03-01" }),
]), request({ periodStart: "2026-02-01", periodEnd: "2026-03-01" })), "REGULATORY_TIMELINE_DATE_INVALID");
const leapYear = await resolveRegulatoryTimeline(directBridgeWith([
  regulatoryRecord({ id: "leap-year", effectiveFrom: "2028-02-29", effectiveTo: "2028-03-01" }),
]), request({ periodStart: "2028-02-29", periodEnd: "2028-03-01" }));
assert.equal(leapYear.segments[0].segmentStart, "2028-02-29T00:00:00.000Z");
await assertCode(() => resolveRegulatoryTimeline(directBridgeWith([
  regulatoryRecord({ id: "invalid-month", effectiveFrom: "2026-13-01", effectiveTo: "2026-14-01" }),
]), request({ periodStart: "2026-12-01", periodEnd: "2027-01-01" })), "REGULATORY_TIMELINE_DATE_INVALID");

await assertCode(() => resolveRegulatoryTimeline(singleBridge, request({ periodStart: "2026-02-30", periodEnd: "2026-03-01" })), "REGULATORY_TIMELINE_PERIOD_INVALID");
await assertCode(() => resolveRegulatoryTimeline(singleBridge, request({ periodStart: "2026-09-01", periodEnd: "2026-09-01" })), "REGULATORY_TIMELINE_PERIOD_INVALID");
await assertCode(() => resolveRegulatoryTimeline(singleBridge, request({ periodStart: "2026-10-01", periodEnd: "2026-09-01" })), "REGULATORY_TIMELINE_PERIOD_INVALID");

const consecutive = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "reg-july", effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01", normalizedValue: 11 }),
  regulatoryRecord({ id: "reg-august", effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01", normalizedValue: 22 }),
]), request());
assert.equal(consecutive.segments.length, 2);
assert.equal(consecutive.segments[0].segmentStart, "2026-07-01T00:00:00.000Z");
assert.equal(consecutive.segments[0].segmentEnd, "2026-08-01T00:00:00.000Z");
assert.equal(consecutive.segments[1].segmentStart, "2026-08-01T00:00:00.000Z");
assert.equal(consecutive.segments[1].segmentEnd, "2026-09-01T00:00:00.000Z");
assert.equal(consecutive.segments[0].normalizedValue, 11);
assert.equal(consecutive.segments[1].normalizedValue, 22);

const previousBoundary = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "reg-before", effectiveFrom: "2026-06-01", effectiveTo: "2026-07-01" }),
  regulatoryRecord({ id: "reg-period", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
]), request());
assert.deepEqual(previousBoundary.segments.map((segment) => segment.regulatoryRecordId), ["reg-period"]);

const nextBoundary = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "reg-period", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
  regulatoryRecord({ id: "reg-after", effectiveFrom: "2026-09-01", effectiveTo: "2026-10-01" }),
]), request());
assert.deepEqual(nextBoundary.segments.map((segment) => segment.regulatoryRecordId), ["reg-period"]);

const clipped = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "reg-clipped-first", effectiveFrom: "2026-06-01", effectiveTo: "2026-08-01" }),
  regulatoryRecord({ id: "reg-clipped-last", effectiveFrom: "2026-08-01", effectiveTo: "2026-10-01", normalizedValue: 22 }),
]), request());
assert.equal(clipped.segments[0].segmentStart, "2026-07-01T00:00:00.000Z");
assert.equal(clipped.segments[0].segmentEnd, "2026-08-01T00:00:00.000Z");
assert.equal(clipped.segments[1].segmentStart, "2026-08-01T00:00:00.000Z");
assert.equal(clipped.segments[1].segmentEnd, "2026-09-01T00:00:00.000Z");

for (const [records, code] of [
  [[regulatoryRecord({ id: "gap-start", effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01" })], "REGULATORY_TIMELINE_GAP"],
  [[regulatoryRecord({ id: "gap-final", effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01" })], "REGULATORY_TIMELINE_GAP"],
  [[regulatoryRecord({ id: "gap-central-a", effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01" }), regulatoryRecord({ id: "gap-central-b", effectiveFrom: "2026-09-01", effectiveTo: "2026-10-01" })], "REGULATORY_TIMELINE_GAP"],
]) {
  const gapBridge = await bridgeWith(records);
  await assertCode(() => resolveRegulatoryTimeline(gapBridge, request({ periodEnd: "2026-10-01" })), code);
}

const overlapRecords = [
  regulatoryRecord({ id: "overlap-a", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01", normalizedValue: 11 }),
  regulatoryRecord({ id: "overlap-b", effectiveFrom: "2026-08-01", effectiveTo: "2026-10-01", normalizedValue: 22 }),
];
const overlapBridge = await bridgeWith(overlapRecords);
await assertCode(() => resolveRegulatoryTimeline(overlapBridge, request()), "REGULATORY_TIMELINE_OVERLAP");
const sameValueOverlapRecords = overlapRecords.map((record) => {
  const withoutChecksum = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "checksum"));
  const sameValue = { ...withoutChecksum, normalizedValue: 11 };
  return { ...sameValue, checksum: checksumFor(sameValue) };
});
const sameValueOverlapBridge = await bridgeWith(sameValueOverlapRecords);
await assertCode(() => resolveRegulatoryTimeline(sameValueOverlapBridge, request()), "REGULATORY_TIMELINE_OVERLAP");

const filtered = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "wanted", componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_RESIDENT_BT", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
  regulatoryRecord({ id: "other-component", componentCode: "NETWORK_POWER", customerScope: "DOMESTIC_RESIDENT_BT", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
  regulatoryRecord({ id: "other-scope", componentCode: "NETWORK_ENERGY", customerScope: "DOMESTIC_BT", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
]), request());
assert.deepEqual(filtered.segments.map((segment) => segment.regulatoryRecordId), ["wanted"]);

await assertCode(async () => resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "all-only", customerScope: "ALL_ELECTRICITY", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
]), request()), "REGULATORY_TIMELINE_GAP");
const explicitAll = await resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "all-explicit", customerScope: "ALL_ELECTRICITY", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
]), request({ customerScope: "ALL_ELECTRICITY" }));
assert.equal(explicitAll.segments[0].customerScope, "ALL_ELECTRICITY");

await assertCode(async () => resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ tenantId: tenantB, id: "tenant-b-record", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
]), request()), "REGULATORY_TIMELINE_GAP");

await assertCode(async () => resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "imported", approvalStatus: "IMPORTED", reviewStatus: "NEEDS_REVIEW", effectiveFrom: "2026-07-01", effectiveTo: "2026-09-01" }),
]), request()), "REGULATORY_TIMELINE_GAP");

await assertCode(async () => resolveRegulatoryTimeline(await bridgeWith([
  regulatoryRecord({ id: "bad-date", effectiveFrom: "2026-07-01T00:00:00", effectiveTo: "2026-09-01" }),
]), request()), "REGULATORY_TIMELINE_DATE_INVALID");

await assertCode(() => resolveRegulatoryTimeline(directBridgeWith([
  regulatoryRecord({ id: "equal-interval", effectiveFrom: "2026-07-01", effectiveTo: "2026-07-01" }),
]), request()), "REGULATORY_TIMELINE_DATE_INVALID");
await assertCode(() => resolveRegulatoryTimeline(directBridgeWith([
  regulatoryRecord({ id: "reverse-interval", effectiveFrom: "2026-08-01", effectiveTo: "2026-07-01" }),
]), request()), "REGULATORY_TIMELINE_DATE_INVALID");

const source = await readFile(new URL("../app/lib/calculation/regulatory-timeline.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /(?:ARERA|TERNA|GME|PUN|ASOS|ARIM|UC3|UC6|CAPACITY_MARKET|DISPATCHING|EUR\/KWH|EUR\/KW|IVA|accise)/);
assert.doesNotMatch(source, /(?:fetch\s*\(|https?:\/\/|Anthropic|OCR|LocalRegulatoryRepository|var\/foundation-regulatory-data)/i);
assert.doesNotMatch(source, /(?:consumption|taxesAndDuties|regulatedCost|totalEstimatedCost|savingsVsBaseline|reduce\(|average|prorat|weighted)/i);
let networkCalled = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { networkCalled = true; throw new Error("NETWORK_FORBIDDEN"); };
try { await resolveRegulatoryTimeline(singleBridge, request()); } finally { globalThis.fetch = originalFetch; }
assert.equal(networkCalled, false);

console.log("REGULATORY_TIMELINE_TESTS=PASS");
console.log("GAP_FAIL_CLOSED=PASS");
console.log("OVERLAP_FAIL_CLOSED=PASS");
console.log("BOUNDARY_CLIPPING=PASS");
console.log("EXACT_SCOPE_ONLY=PASS");
console.log("NO_NETWORK=PASS");
console.log("NO_OCR=PASS");
console.log("NO_ECONOMIC_CALCULATION=PASS");
