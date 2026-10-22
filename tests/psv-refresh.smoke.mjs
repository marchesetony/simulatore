import assert from "node:assert/strict";
import { ARERA_CMEM_PAGE, parseAreraCmemTable } from "../app/lib/market/arera-cmem-source.ts";
import { runPsvMarketRefresh } from "../app/lib/market-refresh/psv.ts";
import { runPunMarketRefresh } from "../app/lib/market-refresh/service.ts";

// Shape of ARERA's "Valore CMEM,m" table: year rows, then months newest first (values as published).
const rows = (year, months) => `<tr><td><strong>${year}</strong></td><td></td><td></td><td></td></tr>` + months.map(([month, mwh, gj, smc]) => `<tr><td>${month}</td><td>${mwh}</td><td>${gj}</td><td>${smc}</td></tr>`).join("");
const page = (extra = []) => `<html><body><p><strong>Componente CMEM,m</strong></p><table><tbody>
<tr><th>2026</th><th>Euro/MWh</th><th>Euro/GJ</th><th>Euro/Smc*</th></tr>
${[...extra, ["settembre", "78,8021", "21,889472", "0,843182"], ["agosto", "64,1540", "17,820556", "0,686448"], ["luglio", "56,6927", "15,747972", "0,606612"], ["giugno", "47,1842", "13,106722", "0,504871"], ["maggio", "46,8927", "13,025750", "0,501752"], ["aprile", "46,0117", "12,781028", "0,492325"], ["marzo", "52,1214", "14,478167", "0,557699"]].map(([month, mwh, gj, smc]) => `<tr><td>${month}</td><td>${mwh}</td><td>${gj}</td><td>${smc}</td></tr>`).join("")}
${rows(2025, [["dicembre", "30,6528", "8,514667", "0,327985"]])}
</tbody></table><ul><li>* per forniture di gas naturale con potere calorifico superiore di riferimento pari a 0,038520 GJ/Smc.</li></ul></body></html>`;

const parsed = parseAreraCmemTable(page());
assert.deepEqual(parsed[0], { month: "2026-09", eurPerMwh: 78.8021, eurPerSmc: 0.843182 });
assert.equal(parsed.find((row) => row.month === "2025-12").eurPerSmc, 0.327985);
assert.throws(() => parseAreraCmemTable("<p>pagina cambiata</p>"), /ARERA_CMEM_TABLE_NOT_FOUND/);
assert.throws(() => parseAreraCmemTable(page([["ottobre", "80,0000", "22,2", "0,500000"]])), /ARERA_CMEM_UNITS_INCONSISTENT/);

const repository = new (class { constructor() { this.records = []; } async get(_tenant, id) { return this.records.find((record) => record.archiveId === id) ?? null; } async list() { return this.records; } async save(record) { this.records = this.records.filter((item) => item.archiveId !== record.archiveId); this.records.push(structuredClone(record)); } })();
const repositories = { marketArchiveRepository: repository };
const tenantId = "tenant_psv-smoke";
const fetcherFor = (html, status = 200) => async (url) => { assert.equal(url, ARERA_CMEM_PAGE); return { status, text: async () => html }; };

// 1. On 19 October the six closed months April to September are taken and approved.
const first = await runPsvMarketRefresh({ tenantId, repositories, fetcher: fetcherFor(page()), now: "2026-10-19T04:15:00.000Z", runId: "psv_first" });
assert.equal(first.status, "SUCCESS", JSON.stringify(first));
assert.deepEqual(first.targetMonths, ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04"]);
assert.equal(first.monthsCreated, 6);
const september = repository.records.find((record) => record.month === "2026-09");
assert.equal(september.status, "APPROVED"); assert.equal(september.vector, "GAS"); assert.equal(september.index, "PSV");
assert.deepEqual(september.record.value, { value: 0.843182, currency: "EUR", unit: "EUR_PER_SMC" });
assert.equal(september.record.effectiveFrom, "2026-09-01"); assert.equal(september.record.effectiveTo, "2026-10-01");
assert.equal(september.record.source.authority, "ARERA");

// 2. The next night nothing changes.
const again = await runPsvMarketRefresh({ tenantId, repositories, fetcher: fetcherFor(page()), now: "2026-10-20T04:15:00.000Z", runId: "psv_again" });
assert.equal(again.monthsCreated, 0); assert.ok(again.months.every((item) => item.status === "UNCHANGED"));

// 3. Early November, October is not out yet: that is expected, not an error.
const early = await runPsvMarketRefresh({ tenantId, repositories, fetcher: fetcherFor(page()), now: "2026-11-02T04:15:00.000Z", runId: "psv_early" });
assert.equal(early.status, "SUCCESS"); assert.deepEqual(early.months.map((item) => item.status), ["NOT_PUBLISHED", "UNCHANGED", "UNCHANGED", "UNCHANGED", "UNCHANGED", "UNCHANGED"]);
const published = await runPsvMarketRefresh({ tenantId, repositories, fetcher: fetcherFor(page([["ottobre", "81,2000", "22,555556", "0,868840"]])), now: "2026-11-03T04:15:00.000Z", runId: "psv_published" });
assert.equal(published.months[0].status, "CREATED"); assert.equal(published.months[0].eurPerSmc, 0.86884);
const late = await runPsvMarketRefresh({ tenantId: "tenant_psv-late", repositories: { marketArchiveRepository: new repository.constructor() }, fetcher: fetcherFor(page()), now: "2026-11-15T04:15:00.000Z", runId: "psv_late" });
assert.equal(late.status, "PARTIAL_FAILURE"); assert.match(late.errors[0], /2026-10:PSV_MONTH_NOT_PUBLISHED/);

// 4. An ARERA correction becomes a new approved version; the old one is kept.
const corrected = await runPsvMarketRefresh({ tenantId, repositories, fetcher: fetcherFor(page().replace("78,8021", "78,9000").replace("21,889472", "21,916667").replace("0,843182", "0,844230")), now: "2026-10-21T04:15:00.000Z", runId: "psv_corrected" });
assert.equal(corrected.months.find((item) => item.month === "2026-09").status, "CORRECTED");
assert.deepEqual(repository.records.filter((record) => record.month === "2026-09" && record.vector === "GAS").map((record) => record.record.version).sort(), ["1", "2"]);

// 5. ARERA unreachable: nothing is touched.
const before = repository.records.length;
const offline = await runPsvMarketRefresh({ tenantId, repositories, fetcher: fetcherFor("", 503), now: "2026-10-22T04:15:00.000Z", runId: "psv_offline" });
assert.equal(offline.status, "FAILED"); assert.deepEqual(offline.errors, ["ARERA_HTTP_503"]); assert.equal(repository.records.length, before);

// 6. PSV months in the archive do not confuse the PUN refresh for the same months.
class MemoryRepository { constructor() { this.records = new Map(); } async get(t, id) { return this.records.get(id) ?? null; } async list() { return [...this.records.values()]; } async put(input) { const existing = this.records.get(input.recordId); const next = { ...input, version: (existing?.version ?? 0) + 1, payload: structuredClone(input.payload) }; this.records.set(input.recordId, next); return next; } async append(input) { return this.put(input); } }
const pun = (month) => ({ schemaVersion: 1, recordId: `gme-${month}`, version: "1", parentVersionId: null, tenantId, approval: { status: "NEEDS_REVIEW", reason: "TEST" }, recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month, publicationDate: null, effectiveFrom: `${month}-01`, effectiveTo: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10), source: { sourceId: "GME", name: "GME", url: "https://gme.mercatoelettrico.org/x", authority: "GME", sourceType: "OFFICIAL" }, f1: { value: 120, currency: "EUR", unit: "EUR_PER_MWH" }, f2: { value: 110, currency: "EUR", unit: "EUR_PER_MWH" }, f3: { value: 100, currency: "EUR", unit: "EUR_PER_MWH" }, monthly: { value: 112, currency: "EUR", unit: "EUR_PER_MWH" } });
const punResult = await runPunMarketRefresh({ tenantId, repositories: { marketArchiveRepository: repository, marketRefreshState: new MemoryRepository(), marketRefreshRuns: new MemoryRepository(), marketRefreshLocks: new MemoryRepository() }, sourceReader: { async load({ referenceMonth }) { return { gme: { record: pun(referenceMonth) } }; } }, now: "2026-10-23T04:15:00.000Z", runId: "pun_with_psv", trigger: "TEST" });
assert.equal(punResult.status, "SUCCESS", JSON.stringify(punResult)); assert.equal(punResult.monthsCreated, 6); assert.equal(punResult.monthsCorrected, 0);

console.log("psv refresh smoke passed");
