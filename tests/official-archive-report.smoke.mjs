import assert from "node:assert/strict";
import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { CALCULATED_REGULATORY_DOMAINS } from "../app/lib/regulatory-refresh/registry.ts";
import { runRegulatoryRefresh } from "../app/lib/regulatory-refresh/service.ts";
import { officialArchiveReport } from "../app/lib/regulatory-refresh/archive-report.ts";

// Tony (27/10): "bisogna verificare i dati terna e arera e metterli in archivio con aggiornamenti mensili". The archive
// report lists every official value the calculator uses and the recent months it does not cover.
class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.idempotencyKey && existing?.idempotencyKey === input.idempotencyKey) return existing;
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: input.now, updatedAt: input.now, payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
    this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next;
  }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}
const tenant = "tenant_archive-smoke";
const now = "2026-10-27T10:00:00.000Z";
// Annual transport values from 1 January; ASOS/ARIM only from 1 October (the previous quarter was never archived).
const quarterly = new Set(["ASOS", "ARIM"]);
const records = CALCULATED_REGULATORY_DOMAINS.map((domain, index) => createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: "https://www.arera.it/qa/archive.xlsx", officialIdentifier: `QA-ARCHIVE-${domain.componentCode}-${domain.normalizedUnit}-${domain.regulatoryVariant ?? "LEGACY"}`, publicationDate: "2025-12-30", retrievedAt: now, effectiveFrom: quarterly.has(domain.componentCode) ? "2026-10-01" : "2025-10-01", effectiveTo: "2027-01-01", componentCode: domain.componentCode, customerScope: domain.customerScope, ...(domain.regulatoryVariant === undefined ? {} : { regulatoryVariant: domain.regulatoryVariant }), originalValue: 1 + index / 100, originalUnit: domain.normalizedUnit, applicationBasis: "QA fixture", sourceSha256: "c".repeat(64) }));
const repositories = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };
const empty = await officialArchiveReport(repositories, tenant, now);
assert.equal(empty.lastSuccessfulAt, null);
assert.equal(empty.stale, true);
assert.ok(empty.domains.every((domain) => domain.records.length === 0 && domain.missingMonths.length === 13), "empty archive: every month missing");

const run = await runRegulatoryRefresh({ tenantId: tenant, repositories, sourceReader: { adapterName: "ARERA_ELECTRICITY", async load() { return records; } }, now, runId: "refresh_archive_run", trigger: "TEST" });
assert.equal(run.status, "SUCCESS");
const report = await officialArchiveReport(repositories, tenant, now);
assert.equal(report.stale, false);
const fixed = report.domains.find((domain) => domain.componentCode === "NETWORK_FIXED" && domain.customerScope === "NON_DOMESTIC_BT_BTA6");
assert.deepEqual(fixed.missingMonths, []);
assert.equal(fixed.records[0].effectiveFrom.slice(0, 10), "2025-10-01");
const asos = report.domains.find((domain) => domain.componentCode === "ASOS" && domain.customerScope === "NON_DOMESTIC_BT_BTA6");
assert.ok(asos.missingMonths.includes("2026-09"), "settembre 2026 non coperto per ASOS");
assert.ok(!asos.missingMonths.includes("2026-10"));
const terna = report.domains.filter((domain) => domain.source === "TERNA");
assert.ok(terna.length > 0 && terna.every((domain) => domain.missingMonths.length === 13), "Terna capacity not yet archived");
console.log("OFFICIAL_ARCHIVE_REPORT=PASS");
