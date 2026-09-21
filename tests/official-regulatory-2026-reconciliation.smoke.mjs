import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAuthoritativeCteContract } from "../app/lib/cte/review.ts";
import { ProductionCteRegulatoryRuntimeResolver, resolveCteRegulatoryRuntime } from "../app/lib/calculation/regulatory-runtime-resolvers.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenantId = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenantId });
const documentId = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
const effectiveAt = "2026-08-01";
const normalizedDocument = JSON.parse(await readFile(`var/cte-diagnostics/${tenantId}/${documentId}-attempt-5.normalized.json`, "utf8"));
const pdf = await readFile(`var/qa-bill-hierarchy/foundation-documents/${tenantId}/${documentId}.pdf`);
assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
assert.equal(normalizedDocument.normalizedProviderPayload.documentType, "CTE");
assert.equal(normalizedDocument.normalizedProviderPayload.vector, "EE");

const foundation = JSON.parse(await readFile(`var/foundation-regulatory-data/${tenantId}/records.json`, "utf8"));
const foundationRecords = foundation.regulatoryValues;
const candidates = foundationRecords.filter((record) => [
  "DISPATCHING",
  "DISPATCHING_TERNA_OPERATION",
  "DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION",
  "CAPACITY_MARKET_OFF_PEAK",
  "LOSS_FACTOR",
].includes(record.componentCode));
assert.equal(candidates.length, 4);
assert.ok(candidates.every((record) => record.vector === "EE"));
assert.ok(candidates.every((record) => record.authority === "ARERA" || record.authority === "TERNA"));
assert.ok(candidates.every((record) => /^https:\/\//.test(record.sourceReference)));
assert.ok(candidates.every((record) => record.effectiveFrom < record.effectiveTo));

const local = new LocalFilesystemAdapter("var/phase6");
const bridge = new ProductionRegulatoryPersistenceBridge(local.collection("regulatory-values"), local.collection("regulatory-approval-domains"));
const runtimeVisible = await bridge.list(tenantId, { effectiveAt });
assert.ok(runtimeVisible.length > 0);
assert.ok(runtimeVisible.every((record) => record.tenantId === tenantId));

const cteContract = buildAuthoritativeCteContract({
  ...normalizedDocument.normalizedProviderPayload,
  ingestionId: documentId,
  documentId,
  tenantId,
});
assert.equal(cteContract.approval.status, "NEEDS_REVIEW");
assert.equal(cteContract.commercialTerms.dispatchingReference?.mode, "OFFICIAL_PASS_THROUGH");
assert.equal(cteContract.commercialTerms.lossReference?.reference.table, "Tabella 4");

const resolver = new ProductionCteRegulatoryRuntimeResolver(bridge);
const resolution = await resolveCteRegulatoryRuntime(cteContract, {
  tenantId,
  effectiveAt,
  customerScope: "NON_DOMESTIC_BT",
  voltageLevel: "LV",
}, resolver);
assert.equal(resolution.ready, false);
assert.deepEqual([...resolution.blockers].sort(), [
  "CAPACITY_MARKET_REGULATORY_VALUE_MISSING",
  "DISPATCHING_REGULATORY_VALUE_MISSING",
  "LOSS_REGULATORY_VALUE_MISSING",
].sort());

const dispatchTotal = await bridge.list(tenantId, { componentCode: "DISPATCHING_TOTAL", effectiveAt });
assert.equal(dispatchTotal.length, 0);
const dispatchComponent = candidates.find((record) => record.componentCode === "DISPATCHING_TERNA_OPERATION");
assert.equal(dispatchComponent?.officialIdentifier, "587/2025/R/eel");
assert.equal(dispatchComponent?.customerScope, "ALL_ELECTRICITY");
const domesticCapacity = candidates.find((record) => record.componentCode === "CAPACITY_MARKET_OFF_PEAK");
assert.equal(domesticCapacity?.customerScope, "DOMESTIC_RESIDENT_BT");
assert.equal((await bridge.list(tenantId, { componentCode: "CAPACITY_MARKET_OFF_PEAK", effectiveAt })).length, 0);
const nonDomesticCapacity = await bridge.list(tenantId, { componentCode: "CAPACITY_MARKET_OFF_PEAK", customerScope: "NON_DOMESTIC_BT", effectiveAt });
assert.equal(nonDomesticCapacity.length, 0);
const lossRecords = await bridge.list(tenantId, { effectiveAt });
assert.equal(lossRecords.filter((record) => record.componentCode === "LOSS_FACTOR").length, 0);

const otherTenant = await bridge.list("tenant_local-demo", { effectiveAt });
assert.ok(otherTenant.length > 0);
assert.ok(otherTenant.every((record) => record.tenantId === "tenant_local-demo"));
assert.equal((await bridge.list(tenantId, { componentCode: "DISPATCHING_TOTAL", effectiveAt })).length, 0);

console.log("OFFICIAL_REGULATORY_SOURCE_PROVENANCE=PASS");
console.log("OFFICIAL_REGULATORY_SEMANTIC_SCOPE_GATE=PASS");
console.log("OFFICIAL_REGULATORY_EFFECTIVE_DATE_GATE=PASS");
console.log("OFFICIAL_REGULATORY_APPROVAL_READBACK=PASS");
console.log("OFFICIAL_REGULATORY_TENANT_ISOLATION=PASS");
console.log("OFFICIAL_REGULATORY_MISSING_VALUE_FAIL_CLOSED=PASS");
console.log("OFFICIAL_REGULATORY_READINESS_RECOMPUTATION=PASS");
