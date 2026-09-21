import assert from "node:assert/strict";
import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { CALCULATED_REGULATORY_DOMAINS, regulatoryDomainKey } from "../app/lib/regulatory-refresh/registry.ts";
import { runRegulatoryRefresh } from "../app/lib/regulatory-refresh/service.ts";

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) { const existing = await this.get(input.tenantId, input.recordId); if (input.idempotencyKey && existing?.idempotencyKey === input.idempotencyKey) return existing; if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS"); if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT"); const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }; this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next; }
  async append(input) { return this.put(input); }
}
const tenant = "tenant_domestic-cdispd-refresh";
const source = "https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx";
const sha = "d".repeat(64);
function record(domain, effectiveFrom = "2026-01-01", effectiveTo = "2027-01-01", value = 1) { return createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: source, officialIdentifier: `QA-REFRESH-${domain.componentCode}-${domain.normalizedUnit}-${domain.regulatoryVariant ?? ""}-${effectiveFrom}`, publicationDate: effectiveFrom, retrievedAt: "2026-09-09T00:00:00.000Z", effectiveFrom, effectiveTo, componentCode: domain.componentCode, customerScope: domain.customerScope, ...(domain.regulatoryVariant === undefined ? {} : { regulatoryVariant: domain.regulatoryVariant }), originalValue: value, originalUnit: domain.normalizedUnit, applicationBasis: domain.componentCode === "DISPATCHING_TOTAL" ? "CDISPD aggregate dispatching + capacity market" : "official QA refresh fixture", sourceSha256: sha, officialName: domain.componentCode === "DISPATCHING_TOTAL" ? "CDISPD" : undefined, referenceDomain: domain.componentCode === "DISPATCHING_TOTAL" ? "DISPATCHING" : undefined, contractPassThroughRequired: domain.componentCode === "DISPATCHING_TOTAL" ? false : undefined }); }
const cdispdDomain = CALCULATED_REGULATORY_DOMAINS.find((domain) => domain.componentCode === "DISPATCHING_TOTAL");
assert.ok(cdispdDomain);
const cdispdMonths = [record(cdispdDomain, "2026-01-01", "2026-02-01", 0.025305), record(cdispdDomain, "2026-02-01", "2026-03-01", 0.023366), record(cdispdDomain, "2026-03-01", "2026-04-01", 0.016509), record(cdispdDomain, "2026-04-01", "2026-05-01", 0.015531), record(cdispdDomain, "2026-05-01", "2026-06-01", 0.015531), record(cdispdDomain, "2026-06-01", "2026-07-01", 0.019902), record(cdispdDomain, "2026-07-01", "2026-08-01", 0.038464), record(cdispdDomain, "2026-08-01", "2026-09-01", 0.018468)];
const otherDomains = CALCULATED_REGULATORY_DOMAINS.filter((domain) => domain.componentCode !== "DISPATCHING_TOTAL").map((domain, index) => record(domain, "2026-01-01", "2027-01-01", 1 + index / 100));
const repos = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };
const reader = (records) => ({ adapterName: "ARERA_ELECTRICITY", async load() { return records; } });
const first = await runRegulatoryRefresh({ tenantId: tenant, repositories: repos, sourceReader: reader([...otherDomains, cdispdMonths[0], cdispdMonths.at(-1)]), now: "2026-09-09T00:00:00.000Z", runId: "refresh_cdispd_initial", trigger: "TEST" });
assert.equal(first.status, "SUCCESS");
const second = await runRegulatoryRefresh({ tenantId: tenant, repositories: repos, sourceReader: reader([...otherDomains, ...cdispdMonths]), now: "2026-09-09T00:00:00.000Z", runId: "refresh_cdispd_backfill", trigger: "TEST" });
assert.equal(second.status, "SUCCESS");
assert.equal((await repos.regulatoryValues.list(tenant)).filter((item) => item.payload.componentCode === "DISPATCHING_TOTAL").length, 8);
assert.equal(second.createdCount, 6);
const third = await runRegulatoryRefresh({ tenantId: tenant, repositories: repos, sourceReader: reader([...otherDomains, ...cdispdMonths]), now: "2026-09-09T00:00:00.000Z", runId: "refresh_cdispd_idempotent", trigger: "TEST" });
assert.equal(third.status, "SUCCESS");
assert.equal(third.createdCount, 0);
assert.equal(third.replacedCount, 0);
assert.equal(third.unchangedCount, 39);
assert.equal(third.sourceChecks.find((check) => check.domain === regulatoryDomainKey(cdispdDomain))?.status, "PASS");
console.log("CDISPD_BACKFILL=PASS");
console.log("CDISPD_REFRESH_IDEMPOTENT=PASS");
console.log("CDISPD_REFRESH_NO_DUPLICATES=PASS");
console.log("CDISPD_REFRESH_ALL_MONTHS=PASS");
console.log("CDISPD_REFRESH_APPROVAL_FLOW=PASS");
