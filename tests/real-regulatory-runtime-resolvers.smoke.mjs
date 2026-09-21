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
const normalized = JSON.parse(await readFile(`var/cte-diagnostics/${tenantId}/${documentId}-attempt-5.normalized.json`, "utf8")).normalizedProviderPayload;
const pdf = await readFile("var/qa-bill-hierarchy/foundation-documents/tenant_qa-company/cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d.pdf");
assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
assert.equal(normalized.documentType, "CTE");
assert.equal(normalized.vector, "EE");

const contract = buildAuthoritativeCteContract({ ...normalized, ingestionId: documentId, documentId, tenantId });
const local = new LocalFilesystemAdapter("var/phase6");
const bridge = new ProductionRegulatoryPersistenceBridge(local.collection("regulatory-values"), local.collection("regulatory-approval-domains"));
const resolver = new ProductionCteRegulatoryRuntimeResolver(bridge);
const runtimeInput = { tenantId, effectiveAt: "2026-08-01", customerScope: "DOMESTIC_NON_RESIDENT_BT", voltageLevel: "LV" };
const visible = await bridge.list(tenantId, { effectiveAt: runtimeInput.effectiveAt });
assert.ok(visible.length > 0, "real tenant regulatory catalog must be readable");
assert.ok(visible.every((record) => record.tenantId === tenantId));
assert.ok(visible.every((record) => record.approvalStatus === "IMPORTED"));

const resolution = await resolveCteRegulatoryRuntime(contract, runtimeInput, resolver);
assert.equal(resolution.ready, false);
assert.equal(resolution.dispatching, null);
assert.equal(resolution.capacityMarket, null);
assert.equal(resolution.loss, null);
assert.deepEqual([...resolution.blockers].sort(), [
  "CAPACITY_MARKET_REGULATORY_VALUE_MISSING",
  "DISPATCHING_REGULATORY_VALUE_MISSING",
  "LOSS_REGULATORY_VALUE_MISSING",
].sort());

const noResolver = await resolveCteRegulatoryRuntime(contract, runtimeInput, undefined);
assert.equal(noResolver.ready, false);
assert.deepEqual([...noResolver.blockers].sort(), [
  "CAPACITY_MARKET_REGULATORY_RESOLVER_REQUIRED",
  "DISPATCHING_REGULATORY_RESOLVER_REQUIRED",
  "LOSS_REGULATORY_RESOLVER_REQUIRED",
].sort());

const otherTenant = await bridge.list("tenant_local-demo", { effectiveAt: runtimeInput.effectiveAt });
assert.ok(otherTenant.length > 0);
assert.ok(otherTenant.every((record) => record.tenantId === "tenant_local-demo"));
assert.equal((await bridge.list(tenantId, { componentCode: "DISPATCHING_TOTAL", effectiveAt: runtimeInput.effectiveAt })).length, 0);
assert.equal((await bridge.list(tenantId, { componentCode: "CAPACITY_MARKET_OFF_PEAK", effectiveAt: runtimeInput.effectiveAt })).length, 0);

console.log("REAL_CTE_DISPATCH_RUNTIME_FAIL_CLOSED=PASS");
console.log("REAL_CTE_CAPACITY_RUNTIME_FAIL_CLOSED=PASS");
console.log("REAL_CTE_LOSS_RUNTIME_FAIL_CLOSED=PASS");
console.log("REAL_CTE_EFFECTIVE_DATE=PASS");
console.log("REAL_CTE_TENANT_ISOLATION=PASS");
console.log("REAL_CTE_READINESS_RECOMPUTATION=PASS");
