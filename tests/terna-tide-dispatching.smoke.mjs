import assert from "node:assert/strict";
import { extractTernaTideTotal } from "../app/lib/foundation/terna-electricity-regulatory.ts";
import { mergeTernaTideQuarters, ternaTideForPeriod } from "../app/lib/foundation/terna-tide-dispatching.ts";
import { runTernaDispatchingRefresh } from "../app/lib/regulatory-refresh/terna.ts";
import { officialArchiveReport } from "../app/lib/regulatory-refresh/archive-report.ts";
import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";

// Tony (28/10): "il valore terna lo abbiamo ... controlla". BPower bills 0,010501 €/kWh of dispatching for September 2026,
// Terna's TIDE total for the 3° trimestre 2026 (1,0501 c€/kWh), on the kWh grossed up for losses.
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

// The total is the sum of the elements Terna prints, so the largest seven-decimal value.
assert.equal(extractTernaTideTotal("Uplift 0,3326000 ATT MSDMB 0,0761000 Unità essenziali 0,3042000 Modulazione 0,1301000 Corrispettivo di dispacciamento 1,0501000 c€/kWh"), 1.0501);
assert.throws(() => extractTernaTideTotal("Documento senza tabella"), /TERNA_TIDE_VALUE_NOT_FOUND/);

// With nothing stored, the September 2026 bill gets the checked Q3 value; Q4 has none until Terna publishes it.
assert.ok(Math.abs(ternaTideForPeriod("2026-09-01", "2026-10-01").eurPerKwh - 0.010501) < 1e-12);
assert.equal(ternaTideForPeriod("2026-10-01", "2026-11-01"), null);

const tenantId = "tenant_tide-smoke";
const repositories = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };
const q4 = createRegulatoryValue({ tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: "https://dati.terna.it/docs/tide-4q2026.pdf", officialIdentifier: "TERNA_TIDE_2026Q4", publicationDate: "2026-09-15", retrievedAt: "2026-10-28T03:15:00.000Z", effectiveFrom: "2026-10-01", effectiveTo: "2027-01-01", componentCode: "DISPATCHING_TOTAL", customerScope: "NON_DOMESTIC_BT", regulatoryVariant: "TIDE", originalValue: 0.9876, originalUnit: "CENT_EUR/KWH", authority: "TERNA", publishedBy: "TERNA", calculatedBy: "TERNA", applicationBasis: "test", sourceSha256: "c".repeat(64), contractPassThroughRequired: true });
const reader = { async load({ quarters }) { return quarters.map((quarter) => quarter.quarter === 4 ? { quarter, records: [q4], url: q4.sourceReference } : { quarter, error: "TERNA_TIDE_DOCUMENT_NOT_PUBLISHED" }); } };
const run = await runTernaDispatchingRefresh({ tenantId, repositories, tideSourceReader: reader, now: "2026-10-28T03:15:00.000Z", runId: "tide_first", trigger: "TEST" });
assert.equal(run.status, "SUCCESS", run.errors.join(","));
assert.equal(run.createdCount, 1);
const stored = (await repositories.regulatoryValues.list(tenantId)).map((record) => record.payload);
const merged = mergeTernaTideQuarters(stored);
assert.ok(Math.abs(ternaTideForPeriod("2026-10-01", "2026-11-01", merged).eurPerKwh - 0.009876) < 1e-12);
assert.ok(Math.abs(ternaTideForPeriod("2026-09-01", "2026-10-01", merged).eurPerKwh - 0.010501) < 1e-12);
const missing = await runTernaDispatchingRefresh({ tenantId, repositories, tideSourceReader: { async load({ quarters }) { return quarters.map((quarter) => ({ quarter, error: "TERNA_TIDE_DOCUMENT_NOT_PUBLISHED" })); } }, now: "2027-01-05T03:15:00.000Z", runId: "tide_missing", trigger: "TEST" });
assert.equal(missing.status, "FAILED"); assert.deepEqual(missing.errors, ["2027Q1:TERNA_TIDE_DOCUMENT_NOT_PUBLISHED"]);

const report = await officialArchiveReport(repositories, tenantId, "2026-10-28T08:00:00.000Z");
const tide = report.domains.find((domain) => domain.key === "DISPATCHING_TOTAL|NON_DOMESTIC_BT|EUR/KWH|TIDE");
assert.deepEqual(tide.missingMonths, []);
assert.equal(tide.records[0].retrievedAt, "2026-10-28T03:15:00.000Z");
console.log("terna tide dispatching smoke: ok");
