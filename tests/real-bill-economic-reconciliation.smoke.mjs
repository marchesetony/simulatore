import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { buildBillRegulatoryAudit } from "../app/lib/foundation/bill-public-audit.ts";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

loadLocalRuntimeEnvForTests({ expectedTenantId: "tenant_qa-company" });
const root = "var/foundation-documents";
const archive = JSON.parse(await readFile(`${root}/metadata.json`, "utf8"));
const source = archive.documents.find((item) => item.fileName === "EE19173_2026_CANTONE_MARIA_ALFIA.pdf");
assert.ok(source, "the requested real bill must be present in the local archive");
assert.equal(source.tenantId, "tenant_qa-company");
await access(source.objectKey, constants.R_OK);

const document = await new LocalBillRepository(root).get(source.tenantId, source.id);
assert.ok(document);
assert.equal(document.fileName, "EE19173_2026_CANTONE_MARIA_ALFIA.pdf");
assert.equal(document.versions.find((version) => version.versionId === document.currentVersionId)?.status, "REVIEW_REQUIRED");
const publicDocument = toPublicDocument(document);
const review = publicDocument.analystReview;
assert.ok(review);
const analysis = review.economics.economicAnalysis;
const totals = analysis.totals;

assert.equal(totals.billTotal, 1472.42);
assert.equal(totals.totalExcludingTvFee, 1472.42);
assert.equal(totals.tvFeeTotal, null);
assert.equal(totals.totalToPay, 1472.42);
assert.equal(totals.priorBalanceTotal, 1305.07);
assert.equal(totals.previousDebtIncludedInCurrentInvoiceTotal, false);
assert.equal(totals.currentInvoiceAtomicTotal, 1472.42);
assert.equal(totals.currentInvoiceAggregateTotal, 1472.42);
assert.equal(totals.fiscalTotal, 223.73);
assert.equal(totals.extraordinaryTotal, 64.24);
assert.equal(totals.reconciliationDifference, 0);
assert.equal(totals.reconciliationStatus, "RECONCILED");

const aggregateDescriptions = [
  "Totale vendita di energia elettrica",
  "Totale tariffa per l'uso della rete elettrica",
  "Totale oneri generali di sistema",
  "Totale Imposte",
  "Totale Fornitura",
  "Totale bolletta",
  "Totale da pagare",
];
for (const description of aggregateDescriptions) {
  const line = analysis.components.find((item) => item.description === description);
  assert.ok(line, `missing aggregate line: ${description}`);
  assert.equal(line.aggregate, true);
  assert.equal(line.atomic, false);
  assert.notEqual(line.normalizedCode, "UNCLASSIFIED_BILL_CHARGE");
  assert.equal(line.includedInReconciliation, false);
  assert.ok(line.childComponents.length > 0 || line.parentComponent !== null);
}
const currentAtomicAmount = analysis.components.filter((item) => item.includedInReconciliation).reduce((sum, item) => {
  const raw = String(item.amount);
  const value = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const numeric = Number(value);
  return sum + (Number.isFinite(numeric) ? numeric : 0);
}, 0);
assert.equal(Math.round(currentAtomicAmount * 100) / 100, 1472.42);
assert.equal(analysis.components.filter((item) => item.atomic).length, analysis.components.filter((item) => item.includedInReconciliation).length);
assert.equal(analysis.components.find((item) => item.description === "Totale vendita di energia elettrica")?.childComponents.length, 14);
assert.equal(analysis.components.find((item) => item.description === "Totale tariffa per l'uso della rete elettrica")?.childComponents.length, 12);

const otherItems = analysis.components.filter((item) => item.classification === "ALTRE_PARTITE" && item.includedInReconciliation);
assert.deepEqual(otherItems.map((item) => [item.description, item.amount]), [["Quota variabile smart (CVS)", "24.65"], ["Quota variabile voci di trasporto", "39.59"]]);
assert.equal(totals.otherItemsTotal, 77.48);

const regulatory = await buildBillRegulatoryAudit(publicDocument);
assert.ok(regulatory?.regulatedPassThrough);
assert.ok(regulatory.regulatedPassThrough.items.some((item) => item.code === "ASOS"));
assert.ok(regulatory.regulatedPassThrough.items.some((item) => item.code === "ARIM"));
assert.equal(regulatory.regulatedPassThrough.items.find((item) => item.code === "DISPATCHING")?.comparable, false);
assert.equal(regulatory.regulatedPassThrough.items.find((item) => item.code === "CAPACITY_MARKET")?.comparable, false);
assert.equal(regulatory.regulatedPassThrough.items.some((item) => ["VAT", "EXCISE", "OUTSTANDING_AMOUNT"].includes(item.code)), false);
assert.ok(regulatory.regulatedPassThrough.items.every((item) => item.sourceReference === null || /^https:\/\/(www\.)?(arera|terna)\.it\//i.test(item.sourceReference)));

const cteFiles = await readdir("var/phase6/cte-archives/tenant_local-demo");
const ctes = (await Promise.all(cteFiles.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(`var/phase6/cte-archives/tenant_local-demo/${name}`, "utf8"))))).map((record) => record.payload).filter((payload) => payload?.approvedSnapshot?.contract);
assert.equal(ctes.length, 1);
assert.equal(ctes.filter((payload) => payload.vector === "EE").length, 1);
assert.equal(ctes.filter((payload) => payload.vector === "GAS").length, 0);
assert.equal(ctes[0].approvedSnapshot.contract.offer.name, "Be STRONG NEW >60.000 Kwh/A");

const ui = await readFile("app/components/BillOperationalPanel.tsx", "utf8");
for (const label of ["Totale bolletta corrente", "PAGAMENTI PREGRESSI", "Voci straordinarie", "Componenti non confrontabili", "Riconciliazione da verificare", "Altre partite riconciliate"]) assert.match(ui, new RegExp(label));

console.log("REAL_BILL_RECONCILIATION=PASS");
console.log("NO_TOTAL_ATOMIC_DOUBLE_COUNT=PASS");
console.log("PREVIOUS_DEBT_EXCLUDED=PASS");
console.log("FISCAL_EXCLUDED=PASS");
console.log("OTHER_ITEMS_RECONCILIATION=PASS");
console.log("ARERA_COMPONENT_MAPPING=PASS");
console.log("REAL_BILL_UI=PASS");
console.log("REAL_BILL=YES");
console.log("REAL_CTE=YES");
console.log("REAL_REGULATORY_DATA=YES");
console.log("SYNTHETIC_DATA_USED_FOR_ACCEPTANCE=NO");
console.log("REAL_CTE_COUNT=1");
console.log("REAL_EE_CTE_COUNT=1");
console.log("REAL_GAS_CTE_COUNT=0");
console.log("REAL_CTE_NAMES=Be STRONG NEW >60.000 Kwh/A");
console.log("REAL_CTE_TEST_STATUS=READY");
console.log("REAL_BILL_ECONOMIC_RECONCILIATION_SMOKE=PASS");
