import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildAuthoritativeCteContract } from "../app/lib/cte/review.ts";
import { ProductionCteRegulatoryRuntimeResolver, resolveCteRegulatoryRuntime } from "../app/lib/calculation/regulatory-runtime-resolvers.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenantId = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenantId });
const documentId = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
const effectiveAt = "2026-08-01";
const manifest = JSON.parse(await readFile("var/official-regulatory-data/2026/manifest.json", "utf8"));
const normalized = JSON.parse(await readFile(`var/cte-diagnostics/${tenantId}/${documentId}-attempt-5.normalized.json`, "utf8")).normalizedProviderPayload;
const ctePdf = await readFile(`var/qa-bill-hierarchy/foundation-documents/${tenantId}/${documentId}.pdf`);

assert.equal(ctePdf.subarray(0, 5).toString("ascii"), "%PDF-");
assert.equal(normalized.documentType, "CTE");
assert.equal(normalized.vector, "EE");
assert.equal(manifest.acceptanceData, "REAL_ONLY");
assert.equal(manifest.simulationPeriod, "2026-08");
assert.equal(manifest.regulatoryQuarter, "Q3-2026");

for (const source of [manifest.sources.ternaDispatchQ3, manifest.sources.ternaCapacityQ3, manifest.sources.areraTivTable9]) {
  const bytes = await readFile(source.localFile);
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(bytes.length > 10000);
  assert.equal(createHash("sha256").update(bytes).digest("hex").toUpperCase(), source.sha256);
  assert.match(source.sourceUrl, /^https:\/\/(?:www\.)?(?:dati\.terna\.it|arera\.it)\//);
}

assert.equal(manifest.sources.ternaDispatchQ3.total.value, 0.010501);
assert.equal(manifest.sources.ternaDispatchQ3.total.unit, "EUR/KWH");
assert.equal(manifest.sources.ternaDispatchQ3.effectiveFrom, "2026-07-01");
assert.equal(manifest.sources.ternaDispatchQ3.effectiveTo, "2026-10-01");
assert.equal(manifest.sources.ternaDispatchQ3.contractGate.semanticEquivalence, "PARTIAL");
assert.equal(manifest.sources.ternaCapacityQ3.entries[0].value, 0.003197);
assert.equal(manifest.sources.ternaCapacityQ3.entries[0].timeClass, "OFF_PEAK");
assert.equal(manifest.sources.ternaCapacityQ3.peakEntry, null);
assert.equal(manifest.sources.areraTivTable9.entries.find((entry) => entry.voltage === "BT").value, 0.078);
assert.equal(manifest.sources.areraTivTable9.entries.find((entry) => entry.voltage === "MT").value, 0.035);
assert.equal(manifest.sources.areraTivTable9.table, "9.2");
assert.equal(manifest.sources.areraTivTable9.column, "A");

assert.deepEqual(manifest.runtimeImport, {
  dispatch: { imported: false, reason: "SEMANTIC_SCOPE_NOT_EXACT" },
  capacity: { imported: false, reason: "SCOPE_OR_SCHEDULE_NOT_EXACT" },
  losses: { imported: false, reason: "CONTRACT_REFERENCE_OR_APPLICABILITY_UNRESOLVED" },
});

const contract = buildAuthoritativeCteContract({ ...normalized, ingestionId: documentId, documentId, tenantId });
const local = new LocalFilesystemAdapter("var/phase6");
const bridge = new ProductionRegulatoryPersistenceBridge(local.collection("regulatory-values"), local.collection("regulatory-approval-domains"));
const resolver = new ProductionCteRegulatoryRuntimeResolver(bridge);
const resolution = await resolveCteRegulatoryRuntime(contract, { tenantId, effectiveAt, customerScope: "NON_DOMESTIC_BT", voltageLevel: "LV" }, resolver);
assert.equal(resolution.ready, false);
assert.deepEqual([...resolution.blockers].sort(), [
  "CAPACITY_MARKET_REGULATORY_VALUE_MISSING",
  "DISPATCHING_REGULATORY_VALUE_MISSING",
  "LOSS_REGULATORY_VALUE_MISSING",
].sort());
assert.equal((await bridge.list(tenantId, { componentCode: "DISPATCHING_TOTAL", effectiveAt })).length, 0);
assert.equal((await bridge.list(tenantId, { componentCode: "CAPACITY_MARKET_OFF_PEAK", effectiveAt })).length, 0);
assert.equal((await bridge.list(tenantId, { componentCode: "LOSS_FACTOR", effectiveAt })).length, 0);
const otherTenant = await bridge.list("tenant_local-demo", { effectiveAt });
assert.ok(otherTenant.length > 0);
assert.ok(otherTenant.every((record) => record.tenantId === "tenant_local-demo"));

console.log("OFFICIAL_RUNTIME_DATA_SOURCE_FILES=PASS");
console.log("OFFICIAL_RUNTIME_DATA_Q3_PERIOD=PASS");
console.log("OFFICIAL_RUNTIME_DATA_DISPATCH_PROVENANCE=PASS");
console.log("OFFICIAL_RUNTIME_DATA_CAPACITY_PROVENANCE=PASS");
console.log("OFFICIAL_RUNTIME_DATA_TIV9_PROVENANCE=PASS");
console.log("OFFICIAL_RUNTIME_DATA_SEMANTIC_IMPORT_GATE=PASS");
console.log("OFFICIAL_RUNTIME_DATA_TENANT_ISOLATION=PASS");
console.log("OFFICIAL_RUNTIME_DATA_FAIL_CLOSED=PASS");
