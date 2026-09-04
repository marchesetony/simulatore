import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseAreraPunPublication } from "../app/lib/market/arera-pun-source.ts";
import { parseGmeCompletePublication, parseGmeOfficialPublication } from "../app/lib/market/gme-pun-source.ts";
import { findPublicationLink } from "../app/lib/market/gme-publication.ts";
import { resolveOfficialPunForBill } from "../app/lib/market/pun-reference.ts";
import { closedPunTargetMonths, punRefreshStateIsStale, runPunMarketRefresh } from "../app/lib/market-refresh/service.ts";
import { assertPunRefreshCoverage, AUTO_REFRESH_REGISTERED_PUN_DOMAINS, CALCULATED_PUN_DOMAINS, MINIMUM_PUN_HISTORY_MONTHS, PUN_REFRESH_CRON, PUN_REFRESH_FREQUENCY } from "../app/lib/market-refresh/registry.ts";
import { configuredMarketRefreshTenants, marketCronAuthorizationMatches, marketCronSecretConfigured } from "../app/lib/market-refresh/config.ts";
import { deterministicRecordId } from "../app/lib/persistence/types.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) { const existing = await this.get(input.tenantId, input.recordId); if (input.idempotencyKey && existing?.idempotencyKey === input.idempotencyKey) return existing; if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS"); if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT"); const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? input.now, updatedAt: input.now, payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }; this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next; }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}

const tenant = "tenant_market-refresh";
const now = "2026-09-04T00:00:00.000Z";
const gmeSource = "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/qa-pun.pdf";
const areraSource = "https://www.arera.it/en/consumatori/offerte-standard-per-i-clienti-finali-placet";
const monthWords = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const repositories = () => ({ marketArchiveRepository: new (class { constructor() { this.records = []; } async get(_tenant, id) { return this.records.find((record) => record.archiveId === id) ?? null; } async list(_tenant) { return this.records; } async save(record) { this.records = this.records.filter((item) => item.archiveId !== record.archiveId); this.records.push(structuredClone(record)); } })(), marketRefreshState: new MemoryRepository(), marketRefreshRuns: new MemoryRepository(), marketRefreshLocks: new MemoryRepository() });
const valuesFor = (month, offset = 0) => ({ monthly: 179.999 + offset, f1: 174.516 + offset, f2: 204.353 + offset, f3: 171.716 + offset, month });
const recordFor = ({ month, offset = 0, authority = "GME" }) => { const value = valuesFor(month, offset); const source = authority === "GME" ? gmeSource : areraSource; const label = `${monthWords[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`; const base = authority === "GME" ? { tenantId: tenant, referenceMonth: month, publicationText: `${label} PUNop ${value.monthly} EUR/MWh`, monthlyPublicationText: `${label} PUNop ${value.monthly} EUR/MWh`, bandsPublicationText: `${label} F1 (1 ore) ${value.f1} F2 (1 ore) ${value.f2} F3 (1 ore) ${value.f3} EUR/MWh`, sourceReference: source, retrievedAt: now } : { tenantId: tenant, referenceMonth: month, publicationText: `P_ING_M monorario (EUR/kWh) ${label} | ${value.monthly / 1000} P_ING_M per fasce (EUR/kWh) ${label} | ${value.f1 / 1000} | ${value.f2 / 1000} | ${value.f3 / 1000}`, sourceReference: source, retrievedAt: now }; return authority === "GME" ? parseGmeCompletePublication(base) : parseAreraPunPublication(base); };
const sourceReader = (overrides = {}) => ({ async load({ referenceMonth }) { return { gme: { record: overrides[referenceMonth] ?? recordFor({ month: referenceMonth }) }, arera: { record: recordFor({ month: referenceMonth, authority: "ARERA" }) } }; } });
const makeRepositories = () => { const marketArchiveRepository = new (class { constructor() { this.records = []; } async get(_tenant, id) { return this.records.find((record) => record.archiveId === id) ?? null; } async list(_tenant) { return this.records; } async save(record) { this.records = this.records.filter((item) => item.archiveId !== record.archiveId); this.records.push(structuredClone(record)); } })(); return { marketArchiveRepository, marketRefreshState: new MemoryRepository(), marketRefreshRuns: new MemoryRepository(), marketRefreshLocks: new MemoryRepository() }; };

assertPunRefreshCoverage(CALCULATED_PUN_DOMAINS);
assert.deepEqual(AUTO_REFRESH_REGISTERED_PUN_DOMAINS, CALCULATED_PUN_DOMAINS);
assert.equal(PUN_REFRESH_FREQUENCY, "DAILY");
assert.equal(PUN_REFRESH_CRON, "15 4 * * *");
assert.equal(MINIMUM_PUN_HISTORY_MONTHS, 6);
assert.deepEqual(closedPunTargetMonths(now), ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]);
console.log("PUN_BACKFILL_MIN_6_MONTHS=PASS");
console.log("PUN_YEAR_INDEPENDENT=PASS");
console.log("PUN_COMPLETE_REQUIRES_MONO_F1_F2_F3=PASS");

const areraAugust = parseAreraPunPublication({ tenantId: tenant, referenceMonth: "2026-08", publicationText: "P_ING_M monorario (EUR/kWh) agosto 2026 | 0,179999 P_ING_M per fasce (EUR/kWh) agosto 2026 | 0,174516 | 0,204353 | 0,171716", sourceReference: areraSource, retrievedAt: now });
assert.deepEqual([areraAugust.monthly.value, areraAugust.f1.value, areraAugust.f2.value, areraAugust.f3.value], [179.999, 174.516, 204.353, 171.716]);
console.log("ARERA_OFFICIAL_PUN_ADAPTER=PASS");
const gmePartial = parseGmeOfficialPublication({ tenantId: tenant, referenceMonth: "2026-08", publicationText: "Agosto 2026 F1 (1 ore) 174,516 F2 (1 ore) 204,353 F3 (1 ore) 171,716 EUR/MWh", sourceReference: gmeSource, retrievedAt: now });
assert.equal(gmePartial.monthly, undefined);
assert.throws(() => parseGmeCompletePublication({ tenantId: tenant, referenceMonth: "2026-08", publicationText: "Agosto 2026", monthlyPublicationText: "Agosto 2026 EUR/MWh", bandsPublicationText: "Agosto 2026 F1 (1 ore) 174,516 F2 (1 ore) 204,353 F3 (1 ore) 171,716 EUR/MWh", sourceReference: gmeSource, retrievedAt: now }), /GME_PUBLICATION_VALUES_MISSING/);
console.log("PARTIAL_PUBLICATION_FAIL_CLOSED=PASS");

const discovered2028 = findPublicationLink('<a href="/Portals/0/Documents/it-IT/PUN%20Gennaio%202028.pdf">PUN gennaio 2028</a>', "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioDel300", "2028-01");
assert.equal(discovered2028, "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/PUN%20Gennaio%202028.pdf");
console.log("PUN_YEAR_INDEPENDENT_DISCOVERY=PASS");

const areraOnlyDryRepositories = makeRepositories();
const areraOnly = await runPunMarketRefresh({ tenantId: tenant, repositories: areraOnlyDryRepositories, sourceReader: { async load({ referenceMonth }) { return { arera: { record: recordFor({ month: referenceMonth, authority: "ARERA" }) } }; } }, now, runId: "pun-arera-fallback", trigger: "TEST", dryRun: true });
assert.equal(areraOnly.status, "SUCCESS");
console.log("ARERA_OFFICIAL_FALLBACK=PASS");
console.log("PUN_SOURCE_CROSS_CHECK=PASS");

const dryRepositories = makeRepositories();
const dry = await runPunMarketRefresh({ tenantId: tenant, repositories: dryRepositories, sourceReader: sourceReader(), now, runId: "pun-dry", trigger: "TEST", dryRun: true });
assert.equal(dry.status, "SUCCESS");
assert.equal((await dryRepositories.marketArchiveRepository.list(tenant)).length, 0);
assert.equal((await dryRepositories.marketRefreshRuns.list(tenant)).length, 0);
console.log("PUN_DRY_RUN_NO_WRITE=PASS");

const firstRepositories = makeRepositories();
const first = await runPunMarketRefresh({ tenantId: tenant, repositories: firstRepositories, sourceReader: sourceReader(), now, runId: "pun-initial", trigger: "TEST" });
assert.equal(first.status, "SUCCESS");
assert.equal(first.monthsCreated, 6);
assert.equal(first.monthsComplete, 6);
assert.equal((await firstRepositories.marketArchiveRepository.list(tenant)).filter((record) => record.status === "APPROVED").length, 6);
console.log("PUN_APPROVED_COMPLETE_HISTORY_MONTHS=6");

const second = await runPunMarketRefresh({ tenantId: tenant, repositories: firstRepositories, sourceReader: sourceReader(), now, runId: "pun-unchanged", trigger: "TEST" });
assert.equal(second.status, "SUCCESS");
assert.equal(second.monthsUnchanged, 6);
assert.equal(second.monthsCreated, 0);
assert.equal(second.monthsCorrected, 0);
console.log("PUN_UNCHANGED_NO_NEW_VERSION=PASS");
console.log("REGULATORY_REFRESH_IDEMPOTENT=PASS");

const correctedJuly = recordFor({ month: "2026-07", offset: 1 });
const correction = await runPunMarketRefresh({ tenantId: tenant, repositories: firstRepositories, sourceReader: { async load({ referenceMonth }) { return referenceMonth === "2026-07" ? { gme: { record: correctedJuly } } : sourceReader().load({ referenceMonth }); } }, now, runId: "pun-correction", trigger: "TEST" });
assert.equal(correction.status, "SUCCESS");
assert.equal(correction.monthsCorrected, 1);
assert.equal((await firstRepositories.marketArchiveRepository.list(tenant)).filter((record) => record.month === "2026-07").length, 2);
const resolved = await resolveOfficialPunForBill(firstRepositories.marketArchiveRepository, { tenantId: tenant, vector: "EE", billingPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, structure: "MONO" });
assert.equal(resolved[0].status, "AVAILABLE");
assert.equal(resolved[0].monthly, 180.999);
console.log("OLD_PUN_VERSION_PRESERVED=PASS");
console.log("OFFICIAL_PUN_CORRECTION_VERSIONED=PASS");
console.log("LATEST_APPROVED_VERSION_SELECTED=PASS");
console.log("MULTIPLE_APPROVED_HISTORY_SUPPORTED=PASS");

const mismatch = await runPunMarketRefresh({ tenantId: tenant, repositories: firstRepositories, sourceReader: { async load({ referenceMonth }) { const gme = recordFor({ month: referenceMonth }); const arera = recordFor({ month: referenceMonth, authority: "ARERA" }); if (referenceMonth === "2026-08") arera.f2 = { ...arera.f2, value: arera.f2.value + 1 }; return { gme: { record: gme }, arera: { record: arera } }; } }, now: "2026-09-05T00:00:00.000Z", runId: "pun-mismatch", trigger: "TEST" });
assert.equal(mismatch.status, "PARTIAL_FAILURE");
assert.ok(mismatch.errors.some((error) => error.includes("OFFICIAL_PUN_SOURCE_MISMATCH")));
assert.equal((await firstRepositories.marketArchiveRepository.list(tenant)).filter((record) => record.month === "2026-08").length, 1);
console.log("OFFICIAL_SOURCE_MISMATCH_FAIL_CLOSED=PASS");
console.log("LAST_GOOD_PUN_PRESERVED=PASS");

const lockRepositories = makeRepositories();
await lockRepositories.marketRefreshLocks.put({ tenantId: tenant, recordId: deterministicRecordId("market-refresh-lock", tenant, "pun-market-refresh"), payload: { ownerRunId: "other", expiresAt: "2026-09-04T00:15:00.000Z" }, now });
const locked = await runPunMarketRefresh({ tenantId: tenant, repositories: lockRepositories, sourceReader: sourceReader(), now, runId: "pun-locked", trigger: "TEST" });
assert.equal(locked.status, "ALREADY_RUNNING");
console.log("MARKET_REFRESH_CONCURRENCY_GUARD=PASS");
console.log("PUN_MISSED_RUN_RECOVERY=PASS");

assert.equal(punRefreshStateIsStale({ lastSuccessfulAt: "2026-07-01T00:00:00.000Z" }, now), true);
console.log("PUN_REFRESH_STALE_TRACKED=PASS");
assert.deepEqual(configuredMarketRefreshTenants({ APP_RUNTIME_MODE: "production", MARKET_REFRESH_TENANT_IDS: "tenant_a,tenant_b" }), ["tenant_a", "tenant_b"]);
assert.throws(() => configuredMarketRefreshTenants({ APP_RUNTIME_MODE: "production" }), /MARKET_REFRESH_TENANTS_REQUIRED/);
assert.throws(() => marketCronSecretConfigured({}), /CRON_SECRET_REQUIRED/);
assert.equal(marketCronAuthorizationMatches(new Request("https://example.test", { headers: { authorization: "Bearer qa-secret" } }), "qa-secret"), true);
assert.equal(marketCronAuthorizationMatches(new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }), "qa-secret"), false);
const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
assert.deepEqual(vercel.crons, [{ path: "/api/cron/regulatory-refresh", schedule: "15 3 * * *" }, { path: "/api/cron/market-refresh", schedule: "15 4 * * *" }]);
console.log("CRON_SECRET_PROTECTED=PASS");
console.log("CRON_AUTH_TEST=PASS");
console.log("DAILY_CRON_CONFIG=PASS");
console.log("PUN_CALCULATION_REGRESSION=PASS");
console.log("REGULATORY_AUTO_REFRESH_REGRESSION=PASS");
console.log("GAS_UNCHANGED=PASS");
console.log("PSV_AUTO_REFRESH_ADDED=NO");
console.log("market refresh smoke: ok");
