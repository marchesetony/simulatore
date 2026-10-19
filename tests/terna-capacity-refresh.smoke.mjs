import assert from "node:assert/strict";
import { extractTernaCapacityValues, ternaQuarterFor, ternaTitleMatchesQuarter, TERNA_CAPACITY_DATASOURCE, TERNA_DISPATCHING_DATASOURCE } from "../app/lib/foundation/terna-electricity-regulatory.ts";
import { runTernaCapacityRefresh } from "../app/lib/regulatory-refresh/terna.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.idempotencyKey && existing?.idempotencyKey === input.idempotencyKey) return existing;
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: input.now, updatedAt: input.now, payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next;
  }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}

// Quarters roll over the year boundary.
assert.deepEqual(ternaQuarterFor("2026-10-19"), { year: 2026, quarter: 4, effectiveFrom: "2026-10-01", effectiveTo: "2027-01-01" });
assert.deepEqual(ternaQuarterFor("2026-10-19", 1), { year: 2027, quarter: 1, effectiveFrom: "2027-01-01", effectiveTo: "2027-04-01" });
assert.equal(ternaTitleMatchesQuarter("Corrispettivo capacity 4Q2026", { year: 2026, quarter: 4 }), true);
assert.equal(ternaTitleMatchesQuarter("Corrispettivi 4° trimestre 2026", { year: 2026, quarter: 4 }), true);
assert.equal(ternaTitleMatchesQuarter("Corrispettivi IV trimestre 2026", { year: 2026, quarter: 4 }), true);
assert.equal(ternaTitleMatchesQuarter("Corrispettivi 3° trimestre 2026", { year: 2026, quarter: 4 }), false);
assert.equal(ternaTitleMatchesQuarter("Corrispettivi 14Q2026", { year: 2026, quarter: 4 }), false);

assert.deepEqual(extractTernaCapacityValues("Corrispettivo unitario ore diverse dalle ore di picco del sistema elettrico [€/MWh] 3,197"), { offPeak: 3.197, peak: null });
assert.deepEqual(extractTernaCapacityValues("ore di picco del sistema elettrico 21,400 €/MWh; ore diverse dalle ore di picco del sistema elettrico 3,197 €/MWh"), { offPeak: 3.197, peak: 21.4 });
assert.throws(() => extractTernaCapacityValues("Documento senza tabella"), /TERNA_CAPACITY_VALUE_NOT_FOUND/);
assert.throws(() => extractTernaCapacityValues("ore diverse dalle ore di picco 320,5"), /TERNA_CAPACITY_VALUE_IMPLAUSIBLE/);

/** A Terna site with the Q4 2026 capacity document published and Q1 2027 not yet. */
function ternaSite({ offPeak = "4,021", peak = "18,250", publishQ1 = false } = {}) {
  const pdf = (lines) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Length 10 >>\nstream\n${lines.map((line) => `(${line}) Tj`).join("\n")}\nendstream\nendobj\n%%EOF`);
  const routes = new Map([
    ["https://dati.terna.it/corrispettivi", `<html><script src="/bundle.js"></script><div data-ds="${TERNA_DISPATCHING_DATASOURCE}"></div><div data-ds="${TERNA_CAPACITY_DATASOURCE}"></div></html>`],
    ["https://dati.terna.it/bundle.js", `fetch("/api/sitecore/dati/corrispettivi/get")`],
    ["https://dati.terna.it/docs/cm-4q2026.pdf", pdf(["Corrispettivo unitario ore di picco del sistema elettrico", `${peak} €/MWh`, "Corrispettivo unitario ore diverse dalle ore di picco del sistema elettrico", `${offPeak} €/MWh`])],
    ["https://dati.terna.it/docs/cm-1q2027.pdf", pdf(["Corrispettivo unitario ore diverse dalle ore di picco del sistema elettrico", "3,900 €/MWh"])],
  ]);
  const calls = [];
  const fetcher = async (input) => {
    calls.push(input);
    const url = new URL(input);
    let body = routes.get(`${url.origin}${url.pathname}`);
    if (url.pathname === "/api/sitecore/dati/corrispettivi/get") {
      const year = url.searchParams.get("year");
      body = JSON.stringify({ Results: year === "2026" ? [{ Title: "Corrispettivo mercato capacità 3Q2026", Url: "/docs/cm-3q2026.pdf", PublicationDate: "20/06/2026" }, { Title: "Corrispettivo mercato capacità 4Q2026", Url: "/docs/cm-4q2026.pdf", PublicationDate: "22/09/2026" }] : publishQ1 ? [{ Title: "Corrispettivo mercato capacità 1Q2027", Url: "/docs/cm-1q2027.pdf", PublicationDate: "20/12/2026" }] : [] });
    }
    if (body === undefined) return { status: 404, headers: { get: () => null }, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return { status: 200, headers: { get: () => "application/octet-stream" }, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  return { fetcher, calls };
}

const { createTernaCapacitySourceReader } = await import("../app/lib/regulatory-refresh/terna.ts");
const tenantId = "tenant_terna-smoke";
const repositories = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };

// 1. The quarter in force is imported and approved; the next one is simply not out yet.
const site = ternaSite();
const first = await runTernaCapacityRefresh({ tenantId, repositories, sourceReader: createTernaCapacitySourceReader({ fetcher: site.fetcher }), now: "2026-10-19T03:15:00.000Z", runId: "terna_first", trigger: "TEST" });
assert.equal(first.status, "SUCCESS", JSON.stringify(first));
assert.deepEqual(first.quarters.map((item) => [item.quarter, item.status]), [["2026Q4", "IMPORTED"], ["2027Q1", "NOT_PUBLISHED"]]);
assert.deepEqual(first.quarters[0].values, { CAPACITY_MARKET_OFF_PEAK: 4.021, CAPACITY_MARKET_PEAK: 18.25 });
assert.equal(first.createdCount, 4, "peak and off-peak for resident and BTA6 customers");
const stored = (await repositories.regulatoryValues.list(tenantId)).map((record) => record.payload);
const offPeak = stored.find((record) => record.componentCode === "CAPACITY_MARKET_OFF_PEAK" && record.customerScope === "DOMESTIC_RESIDENT_BT");
assert.equal(offPeak.normalizedUnit, "EUR/KWH"); assert.equal(offPeak.normalizedValue, 0.004021);
assert.equal(offPeak.effectiveFrom, "2026-10-01"); assert.equal(offPeak.effectiveTo, "2027-01-01");
assert.equal(offPeak.referenceDomain, "CAPACITY_MARKET"); assert.equal(offPeak.authority, "TERNA");
assert.equal(offPeak.sourceReference, "https://dati.terna.it/docs/cm-4q2026.pdf");
const approvals = (await repositories.approvalDomains.list(tenantId)).flatMap((record) => record.payload.effectiveApprovals ?? []);
assert.ok(approvals.some((entry) => entry.targetRecordId === offPeak.id), "the imported value is approved for calculations");

// 2. Re-running the same night changes nothing.
const again = await runTernaCapacityRefresh({ tenantId, repositories, sourceReader: createTernaCapacitySourceReader({ fetcher: ternaSite().fetcher }), now: "2026-10-20T03:15:00.000Z", runId: "terna_again", trigger: "TEST" });
assert.equal(again.status, "SUCCESS"); assert.equal(again.createdCount, 0); assert.equal(again.unchangedCount, 4);

// 3. Once Terna publishes the next quarter it is taken too.
const next = await runTernaCapacityRefresh({ tenantId, repositories, sourceReader: createTernaCapacitySourceReader({ fetcher: ternaSite({ publishQ1: true }).fetcher }), now: "2026-12-21T03:15:00.000Z", runId: "terna_next", trigger: "TEST" });
assert.equal(next.status, "SUCCESS"); assert.deepEqual(next.quarters.map((item) => item.status), ["IMPORTED", "IMPORTED"]);
assert.ok((await repositories.regulatoryValues.list(tenantId)).some((record) => record.payload.effectiveFrom === "2027-01-01" && record.payload.normalizedValue === 0.0039));

// 4. A document that cannot be read fails loudly and leaves the approved value alone.
const broken = await runTernaCapacityRefresh({ tenantId, repositories, sourceReader: createTernaCapacitySourceReader({ fetcher: ternaSite({ offPeak: "n.d." }).fetcher }), now: "2026-10-21T03:15:00.000Z", runId: "terna_broken", trigger: "TEST" });
assert.equal(broken.status, "FAILED"); assert.match(broken.errors[0], /2026Q4:TERNA_CAPACITY_VALUE_NOT_FOUND/);
const offline = await runTernaCapacityRefresh({ tenantId, repositories, sourceReader: { async load() { throw new Error("TERNA_HTTP_503"); } }, now: "2026-10-21T03:15:00.000Z", runId: "terna_offline", trigger: "TEST" });
assert.equal(offline.status, "FAILED"); assert.deepEqual(offline.errors, ["TERNA_HTTP_503"]);
assert.ok((await repositories.approvalDomains.list(tenantId)).flatMap((record) => record.payload.effectiveApprovals ?? []).some((entry) => entry.targetRecordId === offPeak.id));

console.log("terna capacity refresh smoke passed");
