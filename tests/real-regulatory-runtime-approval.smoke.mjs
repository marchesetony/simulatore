import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { validateChecksum } from "../app/lib/foundation/regulatory-validation.ts";
import { buildBillRegulatoryAudit } from "../app/lib/foundation/bill-public-audit.ts";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { RegulatoryApprovalDomainService } from "../app/lib/regulatory-approval-domain.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenantId = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenantId });
const targetScope = "DOMESTIC_NON_RESIDENT_BT";
const billingDate = "2026-08-01";
const sourceRoot = "var/foundation-regulatory-data/tenant_qa-company/records.json";

const archive = JSON.parse(await readFile(sourceRoot, "utf8"));
const sourceValues = archive.regulatoryValues.filter((value) => value.tenantId === tenantId);
assert.ok(sourceValues.length > 0, "real tenant regulatory catalog is required");
assert.equal(sourceValues.some((value) => value.tenantId !== tenantId), false);
for (const value of sourceValues) {
  assert.equal(["OFFICIAL_ATTACHMENT", "OFFICIAL_WEB_PAGE", "OFFICIAL_PROVVEDIMENTO"].includes(value.sourceType), true);
  assert.match(value.sourceReference, /^https:\/\/(www\.arera\.it|dati\.terna\.it)\//);
  assert.ok(value.officialIdentifier.trim());
  assert.ok(value.effectiveFrom && (value.effectiveTo === null || value.effectiveTo > value.effectiveFrom));
  assert.ok(value.customerScope && value.normalizedUnit && Number.isFinite(value.normalizedValue));
  assert.equal(value.approvalStatus, "IMPORTED");
  assert.equal(value.reviewStatus, "NEEDS_REVIEW");
  validateChecksum(value);
}

const unique = (values) => [...new Map(values.map((value) => [`${value.id}|${value.checksum}`, value])).values()];
const source = (componentCode, customerScope, normalizedUnit, officialIdentifier) => {
  const matches = unique(sourceValues.filter((value) => value.componentCode === componentCode && value.customerScope === customerScope && value.normalizedUnit === normalizedUnit && value.officialIdentifier === officialIdentifier));
  assert.equal(matches.length, 1, `expected exactly one real source for ${componentCode}|${customerScope}|${normalizedUnit}`);
  const value = matches[0];
  assert.equal(value.effectiveFrom <= billingDate, true);
  assert.equal(value.effectiveTo === null || billingDate < value.effectiveTo, true);
  return value;
};

const projection = [
  { componentCode: "NETWORK_FIXED", normalizedUnit: "EUR/POD/YEAR", source: source("S1_TOTAL", "DOMESTIC_BT", "EUR/POD/YEAR", "575/2025/R/eel"), mode: "DOMESTIC_BT_TO_NON_RESIDENT" },
  { componentCode: "NETWORK_POWER", normalizedUnit: "EUR/KW/YEAR", source: source("S2_POWER", "DOMESTIC_BT", "EUR/KW/YEAR", "575/2025/R/eel"), mode: "DOMESTIC_BT_TO_NON_RESIDENT" },
  { componentCode: "NETWORK_ENERGY", normalizedUnit: "EUR/KWH", source: source("S3_ENERGY_TRANSMISSION", "DOMESTIC_BT", "EUR/KWH", "575/2025/R/eel"), mode: "DOMESTIC_BT_TO_NON_RESIDENT" },
  { componentCode: "ASOS", normalizedUnit: "EUR/KWH", source: source("ASOS", targetScope, "EUR/KWH", "227/2026/R/com"), mode: "EXACT_SCOPE" },
  { componentCode: "ARIM", normalizedUnit: "EUR/KWH", source: source("ARIM", targetScope, "EUR/KWH", "227/2026/R/com"), mode: "EXACT_SCOPE" },
  { componentCode: "UC3", normalizedUnit: "EUR/KWH", source: source("UC3", "DOMESTIC_BT", "EUR/KWH", "588/2025/R/com"), mode: "DOMESTIC_BT_TO_NON_RESIDENT" },
  { componentCode: "UC6", normalizedUnit: "EUR/KWH", source: source("UC6", "DOMESTIC_BT", "EUR/KWH", "588/2025/R/com"), mode: "DOMESTIC_BT_TO_NON_RESIDENT" },
  { componentCode: "UC6", normalizedUnit: "EUR/KW/YEAR", source: source("UC6", "DOMESTIC_BT", "EUR/KW/YEAR", "588/2025/R/com"), mode: "DOMESTIC_BT_TO_NON_RESIDENT" },
];

const runtime = new LocalFilesystemAdapter("var/phase6");
const regulatoryValues = runtime.collection("regulatory-values");
const approvalDomains = runtime.collection("regulatory-approval-domains");
const auditEvents = runtime.collection("audit-events");
const bridge = new ProductionRegulatoryPersistenceBridge(regulatoryValues, approvalDomains);
const approval = new RegulatoryApprovalDomainService({ regulatoryValues, approvalDomains, auditEvents });
const approved = [];

for (const item of projection) {
  const real = item.source;
  const projected = item.mode === "EXACT_SCOPE"
    ? real
    : createRegulatoryValue({
      tenantId,
      sourceType: real.sourceType,
      sourceReference: real.sourceReference,
      officialIdentifier: real.officialIdentifier,
      publicationDate: real.publicationDate,
      retrievedAt: real.retrievedAt,
      effectiveFrom: real.effectiveFrom,
      effectiveTo: real.effectiveTo,
      componentCode: item.componentCode,
      customerScope: targetScope,
      originalValue: real.originalValue,
      originalUnit: real.originalUnit,
      applicationBasis: `${real.applicationBasis}; proiezione scope ufficiale ${targetScope}`,
      sourceSha256: real.sourceSha256,
      conversionProvenance: [...real.conversionProvenance, `REAL_SCOPE_PROJECTION:${real.customerScope}->${targetScope}`],
      carriedForwardFrom: real.carriedForwardFrom,
      confirmationSource: real.confirmationSource,
      authority: real.authority,
      publishedBy: real.publishedBy === "TERNA" ? "TERNA" : "ARERA",
      calculatedBy: real.calculatedBy === "TERNA" ? "TERNA" : "ARERA",
      officialName: real.officialName,
      contractPassThroughRequired: real.contractPassThroughRequired,
      referenceDomain: real.referenceDomain,
    });
  assert.equal(projected.tenantId, tenantId);
  assert.equal(projected.customerScope, targetScope);
  assert.equal(projected.componentCode, item.componentCode);
  assert.equal(projected.normalizedUnit, item.normalizedUnit);
  assert.equal(projected.effectiveFrom <= billingDate, true);
  assert.equal(projected.effectiveTo === null || billingDate < projected.effectiveTo, true);
  validateChecksum(projected);
  await bridge.save(tenantId, projected);
  const result = await approval.approveRegulatoryValue({
    tenantId,
    targetRecordId: projected.id,
    principalId: "user_regulatory-qa",
    role: "ADMIN",
    correlationId: "real-regulatory-runtime-approval-p0",
    idempotencyKey: `real-regulatory-runtime-approval:${projected.id}`,
    evidenceReference: projected.sourceReference,
  });
  assert.equal(result.effective, true);
  approved.push(projected);
}

const visible = await bridge.list(tenantId, { effectiveAt: billingDate });
const visibleTarget = visible.filter((value) => value.customerScope === targetScope);
assert.equal(visibleTarget.length, projection.length);
assert.deepEqual(new Set(visibleTarget.map((value) => value.componentCode)), new Set(projection.map((value) => value.componentCode)));
assert.equal(visibleTarget.every((value) => value.approvalStatus === "IMPORTED" && value.reviewStatus === "NEEDS_REVIEW"), true, "source metadata remains immutable; approval is represented by the approval domain");

const failClosed = ["METERING_FIXED", "TRANSMISSION_ENERGY", "DISPATCHING", "CAPACITY_MARKET"];
for (const componentCode of failClosed) assert.equal(visibleTarget.some((value) => value.componentCode === componentCode), false);

const billArchive = JSON.parse(await readFile("var/foundation-documents/metadata.json", "utf8"));
const billSource = billArchive.documents.find((value) => value.fileName === "EE19173_2026_CANTONE_MARIA_ALFIA.pdf");
assert.ok(billSource && billSource.tenantId === tenantId);
const bill = await new LocalBillRepository("var/foundation-documents").get(tenantId, billSource.id);
assert.ok(bill);
assert.equal(bill.versions.find((version) => version.versionId === bill.currentVersionId)?.status, "REVIEW_REQUIRED");
const readback = await buildBillRegulatoryAudit(toPublicDocument(bill), visibleTarget);
assert.ok(readback?.regulatedPassThrough);
const comparableCodes = readback.regulatedPassThrough.items.filter((item) => item.comparable).map((item) => item.code);
assert.deepEqual(comparableCodes, ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "ASOS", "ARIM", "UC3", "UC6"]);
for (const componentCode of failClosed) assert.equal(readback.regulatedPassThrough.items.find((item) => item.code === componentCode)?.comparable ?? false, false);
console.log("REAL_BILL_REGULATORY_READBACK=PASS");

console.log("REAL_REGULATORY_SOURCE_VALIDATION=PASS");
console.log("REAL_REGULATORY_TIMELINE_VALIDATION=PASS");
console.log("REAL_REGULATORY_SEMANTIC_KEY_VALIDATION=PASS");
console.log("REAL_REGULATORY_TENANT_ISOLATION=PASS");
console.log("REAL_REGULATORY_APPROVAL_WORKFLOW=PASS");
console.log("TENANT_PROJECTION_READY=YES");
console.log(`APPROVED_RECORD_COUNT=${approved.length}`);
console.log(`RUNTIME_VISIBLE_RECORD_COUNT=${visibleTarget.length}`);
console.log("AUGUST_2026_DOMESTIC_NON_RES_READY=YES");
console.log("NETWORK_FIXED_READY=YES");
console.log("NETWORK_POWER_READY=YES");
console.log("NETWORK_ENERGY_READY=YES");
console.log("ASOS_READY=YES");
console.log("ARIM_READY=YES");
console.log("UC3_READY=YES");
console.log("UC6_READY=YES");
console.log("METERING_FIXED_STATUS=FAIL_CLOSED_NO_EXACT_AUTHORIZED_REFERENCE");
console.log("TRANSMISSION_ENERGY_STATUS=FAIL_CLOSED_NO_EXACT_AUTHORIZED_REFERENCE");
console.log("DISPATCHING_STATUS=FAIL_CLOSED_NO_EXACT_AUTHORIZED_REFERENCE");
console.log("CAPACITY_MARKET_STATUS=FAIL_CLOSED_NO_EXACT_AUTHORIZED_REFERENCE");
console.log("SYNTHETIC_DATA_USED_FOR_ACCEPTANCE=NO");
console.log("REAL_REGULATORY_RUNTIME_APPROVAL_SMOKE=PASS");
