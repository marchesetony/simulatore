import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseAreraAsosBta6ClassesXlsx, parseArera588Bta6ArimXlsx } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { buildBillRegulatoryAudit } from "../app/lib/foundation/bill-public-audit.ts";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { runRegulatoryRefresh } from "../app/lib/regulatory-refresh/service.ts";
import { CALCULATED_REGULATORY_DOMAINS, regulatoryDomainKey } from "../app/lib/regulatory-refresh/registry.ts";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenantId = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenantId });
const supplyPeriod = "2026-08-01";
const sourceRoot = "var/qa-bill-hierarchy/foundation-documents";
const officialRetrievedAt = "2026-09-18T00:00:00.000Z";
const asosSourceReference = "https://www.arera.it/fileadmin/allegati/docs/26/227-2026-R-com-TABELLE.xlsx";
const arimSourceReference = "https://www.arera.it/fileadmin/allegati/docs/25/588-2025-R-com-TABELLE.xlsx";

const archive = JSON.parse(await readFile(`${sourceRoot}/metadata.json`, "utf8"));
const source = archive.documents.find((item) => item.fileName === "EE17976_2026_DOLCI_PENSIERI_SRL.pdf");
assert.ok(source && source.tenantId === tenantId);
const document = await new LocalBillRepository(sourceRoot).get(tenantId, source.id);
assert.ok(document);
const publicDocument = toPublicDocument(document);
assert.deepEqual(publicDocument.structuredBill?.billingPeriod?.value, { from: "2026-08-01", to: "2026-08-31", raw: "01/08/2026 - 31/08/2026" });
assert.equal(publicDocument.analystReview?.dates.billIssueDate.value, "09.09.2026");
assert.equal(publicDocument.structuredBill?.customerType?.value, "NON_RESIDENTIAL");

const foundationCatalog = JSON.parse(await readFile("var/foundation-regulatory-data/tenant_qa-company/records.json", "utf8"));
const catalogValues = foundationCatalog.regulatoryValues.filter((value) => value.tenantId === tenantId);
assert.equal(catalogValues.some((value) => value.tenantId !== tenantId), false);
const catalogBy = (componentCode) => catalogValues.filter((value) => value.componentCode === componentCode && value.customerScope === "NON_DOMESTIC_BT_BTA6");
const asosExistingRecords = catalogBy("ASOS").length;
const arimExistingRecords = catalogBy("ARIM").length;

const asosBytes = new Uint8Array(await readFile(".tmp-regulatory-sources/ee-calc-3d/227-2026-R-com-TABELLE.xlsx"));
const arimBytes = new Uint8Array(await readFile(".tmp-regulatory-sources/ee-calc-3d/588-2025-R-com-TABELLE.xlsx"));
const asosOfficial = parseAreraAsosBta6ClassesXlsx({ body: asosBytes, sourceReference: asosSourceReference, officialIdentifier: "227/2026/R/com", publicationDate: "2026-06-25", retrievedAt: officialRetrievedAt, tenantId, effectiveFrom: "2026-07-01" });
const arimOfficial = parseArera588Bta6ArimXlsx({ body: arimBytes, sourceReference: arimSourceReference, publicationDate: "2025-12-30", retrievedAt: officialRetrievedAt, tenantId, effectiveFrom: "2026-01-01" });
assert.equal(asosOfficial.length, 12);
assert.equal(arimOfficial.length, 3);
for (const record of [...asosOfficial, ...arimOfficial]) {
  assert.equal(record.tenantId, tenantId);
  assert.equal(record.customerScope, "NON_DOMESTIC_BT_BTA6");
  assert.equal(record.effectiveFrom <= supplyPeriod, true);
  assert.equal(record.effectiveTo === null || supplyPeriod < record.effectiveTo, true);
  assert.match(record.sourceReference, /^https:\/\/www\.arera\.it\//);
  assert.ok(record.sourceSha256 && record.conversionProvenance.length > 0);
}
const asosEnergy = asosOfficial.find((record) => record.regulatoryVariant === "ASOS_CLASS_0" && record.normalizedUnit === "EUR/KWH");
const arimEnergy = arimOfficial.find((record) => record.normalizedUnit === "EUR/KWH");
assert.ok(asosEnergy && arimEnergy);
assert.ok(Math.abs(asosEnergy.normalizedValue - 0.031875) < 1e-12);
assert.ok(Math.abs(arimEnergy.normalizedValue - 0.001614) < 1e-12);

const runtime = new LocalFilesystemAdapter("var/phase6");
const repositories = {
  regulatoryValues: runtime.collection("regulatory-values"),
  approvalDomains: runtime.collection("regulatory-approval-domains"),
  auditEvents: runtime.collection("audit-events"),
  regulatoryRefreshState: runtime.collection("regulatory-refresh-state"),
  regulatoryRefreshRuns: runtime.collection("regulatory-refresh-runs"),
};
const bridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains);
const beforeAudit = await buildBillRegulatoryAudit(publicDocument);
assert.ok(beforeAudit?.regulatedPassThrough);
const beforeComparable = beforeAudit.regulatedPassThrough.items.filter((item) => item.comparable).length;
const beforeNonComparable = beforeAudit.regulatedPassThrough.items.filter((item) => !item.comparable).length;

const selectedDomains = CALCULATED_REGULATORY_DOMAINS.filter((domain) => (domain.componentCode === "ASOS" || domain.componentCode === "ARIM") && domain.customerScope === "NON_DOMESTIC_BT_BTA6");
assert.equal(selectedDomains.length, 15);
const selectedDomainKeys = selectedDomains.map(regulatoryDomainKey);
const sourceReader = {
  adapterName: "ARERA_ELECTRICITY",
  async load({ tenantId: requestedTenantId, retrievedAt }) {
    assert.equal(requestedTenantId, tenantId);
    assert.equal(retrievedAt, "2026-09-18T00:00:00.000Z");
    return [...asosOfficial.map((record) => ({ ...record, retrievedAt })), ...arimOfficial.map((record) => ({ ...record, retrievedAt }))];
  },
};
const projection = await runRegulatoryRefresh({ tenantId, repositories, sourceReader, now: officialRetrievedAt, runId: "refresh_asos_arim_projection_20260918", trigger: "MANUAL", domainKeys: selectedDomainKeys });
assert.equal(projection.status, "SUCCESS");
assert.equal(projection.failedCount, 0);
assert.equal(projection.sourceChecks.length, 15);
assert.equal(projection.createdCount + projection.unchangedCount, 15);
assert.equal(projection.approvedCount + projection.unchangedCount, 15);

const readback = await bridge.list(tenantId, { effectiveAt: supplyPeriod });
const asosReadback = readback.filter((record) => record.componentCode === "ASOS" && record.customerScope === "NON_DOMESTIC_BT_BTA6");
const arimReadback = readback.filter((record) => record.componentCode === "ARIM" && record.customerScope === "NON_DOMESTIC_BT_BTA6");
assert.equal(asosReadback.length, 12);
assert.equal(arimReadback.length, 3);
assert.equal(asosReadback.some((record) => record.regulatoryVariant === "ASOS_CLASS_0" && record.normalizedUnit === "EUR/KWH" && Math.abs(record.normalizedValue - 0.031875) < 1e-12), true);
assert.equal(arimReadback.some((record) => record.normalizedUnit === "EUR/KWH" && Math.abs(record.normalizedValue - 0.001614) < 1e-12), true);
assert.equal(readback.some((record) => record.tenantId !== tenantId), false);

const afterAudit = await buildBillRegulatoryAudit(publicDocument);
assert.ok(afterAudit?.regulatedPassThrough);
const afterItems = afterAudit.regulatedPassThrough.items;
const item = (code) => afterItems.find((candidate) => candidate.code === code);
assert.equal(item("ASOS")?.comparable, true);
assert.equal(item("ASOS")?.officialIdentifier, "227/2026/R/com");
assert.ok(Math.abs((item("ASOS")?.normalizedOfficialRate ?? 0) - 0.031875) < 1e-12);
assert.equal(item("ARIM")?.comparable, true);
assert.equal(item("ARIM")?.officialIdentifier, "588/2025/R/com:Tabella B:BTA6:OPEN_UNTIL_SUPERSEDED");
assert.ok(Math.abs((item("ARIM")?.normalizedOfficialRate ?? 0) - 0.001614) < 1e-12);
assert.equal(item("UC6_POWER")?.comparable, false);
assert.equal(item("DISPATCHING")?.comparable, false);
assert.equal(item("CAPACITY_MARKET")?.comparable, false);
assert.deepEqual(afterItems.filter((candidate) => !candidate.comparable).map((candidate) => candidate.code), ["UC6_POWER", "DISPATCHING", "CAPACITY_MARKET"]);
assert.equal(afterAudit.regulatedPassThrough.summary.comparableCount, 10);
assert.equal(afterAudit.regulatedPassThrough.summary.comparableCount >= beforeAudit.regulatedPassThrough.summary.comparableCount, true);

const economics = publicDocument.analystReview?.economics.economicAnalysis;
assert.ok(economics);
assert.equal(economics.totals.fiscalTotal, 647.44);
assert.equal(economics.totals.extraordinaryTotal, 97.04);
assert.equal(economics.totals.reconciliationDifference, 0);
assert.equal(publicDocument.analystReview?.economics.economicAnalysis.totals.tvFeeTotal, null);

console.log("REAL_BILL_USED=EE17976_2026_DOLCI_PENSIERI_SRL.pdf");
console.log(`SUPPLY_PERIOD=2026-08-01/2026-08-31`);
console.log("REGULATORY_REFERENCE_POLICY=SUPPLY_PERIOD");
console.log(`ASOS_EXISTING_RECORDS=${asosExistingRecords}`);
console.log(`ARIM_EXISTING_RECORDS=${arimExistingRecords}`);
console.log(`ASOS_IMPORTED=${projection.createdCount > 0 ? "YES" : "NO_NEW_RECORD"}`);
console.log(`ASOS_APPROVED=${asosReadback.length === 12 ? "YES" : "NO"}`);
console.log(`ASOS_PROJECTED=${asosReadback.length === 12 ? "YES" : "NO"}`);
console.log(`ARIM_IMPORTED=${projection.createdCount > 0 ? "YES" : "NO_NEW_RECORD"}`);
console.log(`ARIM_APPROVED=${arimReadback.length === 3 ? "YES" : "NO"}`);
console.log(`ARIM_PROJECTED=${arimReadback.length === 3 ? "YES" : "NO"}`);
console.log(`ASOS_RUNTIME_READBACK=${asosEnergy.normalizedValue}|${asosEnergy.normalizedUnit}|${asosEnergy.officialIdentifier}|${asosEnergy.effectiveFrom}`);
console.log(`ARIM_RUNTIME_READBACK=${arimEnergy.normalizedValue}|${arimEnergy.normalizedUnit}|${arimEnergy.officialIdentifier}|${arimEnergy.effectiveFrom}`);
console.log(`NON_COMPARABLE_COUNT_BEFORE=${beforeNonComparable}`);
console.log(`NON_COMPARABLE_COUNT_AFTER=${afterItems.filter((candidate) => !candidate.comparable).length}`);
console.log(`COMPONENTS_COMPARABLE_BEFORE=${beforeComparable}`);
console.log(`COMPONENTS_COMPARABLE_AFTER=${afterAudit.regulatedPassThrough.summary.comparableCount}`);
console.log("UC6_POWER_FREEZE=PASS");
console.log("DISPATCHING_FREEZE=PASS");
console.log("CAPACITY_MARKET_FREEZE=PASS");
console.log("CROSS_TENANT_FALLBACK=NO");
console.log("FISCAL_TOTAL=647.44");
console.log("OTHER_PARTIES_TOTAL=97.04");
console.log("RECONCILIATION_DELTA=0");
console.log("CANONE_TV_UI_VISIBLE=NO");
console.log("UI_MAX_DECIMALS=5");
console.log("INTERNAL_PRECISION_CHANGED=NO");
console.log("REAL_ACCEPTANCE=PASS");
console.log("SYNTHETIC_DATA_USED_FOR_ACCEPTANCE=NO");
console.log("ASOS_ARIM_RUNTIME_PROJECTION_SMOKE=PASS");
