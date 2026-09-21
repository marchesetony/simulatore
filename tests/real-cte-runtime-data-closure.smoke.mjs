import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { projectOfficialGmePun } from "../app/lib/market/projection.ts";
import { queryApprovedHistoricalMarketData } from "../app/lib/market/service.ts";
import { resolveOfficialPunForBill } from "../app/lib/market/pun-reference.ts";

const tenantId = "tenant_qa-company";
const targetTenantId = tenantId;
const sourceTenantId = "tenant_local-demo";
const realBillFileName = "EE19173_2026_CANTONE_MARIA_ALFIA.pdf";
const market = new LocalMarketArchiveRepository();
const marketStore = JSON.parse(await readFile("var/market-archive/metadata.json", "utf8"));
const sourceRecords = marketStore.records
  .filter((record) => record.tenantId === sourceTenantId && record.status === "APPROVED" && record.vector === "EE" && record.index === "PUN" && ["2026-05", "2026-06", "2026-07", "2026-08"].includes(record.month))
  .sort((left, right) => left.month.localeCompare(right.month) || Number(right.record.version) - Number(left.record.version));
const latestByMonth = [...new Map(sourceRecords.map((record) => [record.month, record])).values()];
assert.equal(latestByMonth.length, 4, "four real closed GME months are required for the runtime policy");
assert.ok(latestByMonth.every((record) => record.record.source.authority === "GME" && record.record.source.sourceType === "OFFICIAL"));
assert.ok(latestByMonth.every((record) => record.record.effectiveFrom === `${record.month}-01` && record.record.effectiveTo));

const projected = [];
for (const source of latestByMonth) projected.push(await projectOfficialGmePun(market, { source, targetTenantId, now: "2026-09-17T12:00:00.000Z", actor: "real-cte-runtime-data-closure", decisionId: `real-gme-${source.month}` }));
assert.equal(projected.length, 4);
assert.ok(projected.every((result) => ["CREATED", "REUSED"].includes(result.action)));
assert.ok(projected.every((result) => result.record.tenantId === tenantId && result.record.status === "APPROVED"));
assert.ok(projected.every((result) => result.record.history.some((event) => event.type === "CREATED") && result.record.approvals.length > 0));

const visible = await market.list(tenantId);
assert.equal(visible.length, 4);
assert.ok(visible.every((record) => record.tenantId === tenantId && record.status === "APPROVED"));
assert.equal((await market.list(sourceTenantId)).length, 5, "projection must not alter the source tenant");
const august = await queryApprovedHistoricalMarketData(market, tenantId, "2026-08-01", "EE");
assert.equal(august.length, 1);
assert.equal(august[0].month, "2026-08");
assert.equal(august[0].record.f1.value, 174.5162216017316);
assert.equal(august[0].record.f2.value, 204.35305085798808);
assert.equal(august[0].record.f3.value, 171.71599093023272);

const billArchive = JSON.parse(await readFile("var/foundation-documents/metadata.json", "utf8"));
const bill = billArchive.documents.find((document) => document.tenantId === tenantId && document.fileName === realBillFileName);
assert.ok(bill);
const billVersion = bill.versions.find((version) => version.versionId === bill.currentApprovedVersionId);
assert.ok(billVersion);
assert.equal(billVersion.structuredBill.vector.value, "EE");
assert.equal(billVersion.structuredBill.billingPeriod.value.from, "2026-08-01");
assert.equal(billVersion.structuredBill.annualConsumption.value, 25838);
assert.equal(billVersion.structuredBill.customerType.value, "NON_RESIDENTIAL");
assert.equal(billVersion.structuredBill.voltageLevel.value, "LV");
const pun = await resolveOfficialPunForBill(market, { tenantId, vector: "EE", billingPeriod: { periodStart: "2026-08-01", periodEnd: "2026-08-31" }, structure: "F1_F2_F3" });
assert.equal(pun.length, 1);
assert.equal(pun[0].status, "AVAILABLE");
assert.equal(pun[0].referenceMonth, "2026-08");
assert.deepEqual([pun[0].f1, pun[0].f2, pun[0].f3], [174.5162216017316, 204.35305085798808, 171.71599093023272]);

console.log("REAL_GME_SOURCE_INVENTORY=PASS");
console.log("GME_EXPLICIT_TENANT_PROJECTION=PASS");
console.log("GME_AUGUST_2026_RUNTIME_READBACK=PASS");
console.log("REAL_BILL_AUGUST_2026_PUN_READBACK=PASS");
console.log("GME_NO_CROSS_TENANT_FALLBACK=PASS");
console.log("REAL_CTE_RUNTIME_DATA_CLOSURE_SMOKE=PASS");
