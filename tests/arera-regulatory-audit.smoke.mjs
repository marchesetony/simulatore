import assert from "node:assert/strict";
import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { LocalRegulatoryRepository } from "../app/lib/foundation/regulatory-repository.ts";
import { ARERA_227_IDENTIFIER, ARERA_227_PAGE, ARERA_575_IDENTIFIER, ARERA_575_PAGE, AreraElectricityRegulatorySourceAdapter, backupRegulatoryArchive, discoverAreraAttachments, isAllowedAreraUrl, normalizeRegulatoryUnit, parseArera227StructuredAttachment, parseArera575DomesticInfrastructure, resolveAreraEffectiveValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { amountUnitConsistency, auditElectricityBill, customerScopeForBill } from "../app/lib/foundation/bill-regulatory-audit.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(isAllowedAreraUrl("https://www.arera.it/official"), true);
assert.equal(isAllowedAreraUrl("https://example.com/arera"), false);
assert.equal(isAllowedAreraUrl("https://arera.it/official"), true);
console.log("ARERA_SOURCE_ALLOWLIST=OK");

const infrastructure = parseArera575DomesticInfrastructure({ html: "<table><tr><th>Anno</th><th>s1</th><th>mis</th><th>s2</th><th>s3</th></tr><tr><td>2026</td><td>2.304,00</td><td>1.954,48</td><td>2.352,00</td><td>1,190</td></tr></table>", retrievedAt: "2026-08-17T10:00:00Z" });
assert.equal(infrastructure.records.length, 4);
assert.equal(infrastructure.records[0].originalValue, 2304);
assert.equal(infrastructure.records[0].normalizedValue, 23.04);
assert.ok(Math.abs(infrastructure.records[3].normalizedValue - 0.0119) < 1e-12);
assert.equal(infrastructure.records.every((record) => record.officialIdentifier === ARERA_575_IDENTIFIER), true);
console.log("ARERA_575_DOMESTIC_INFRASTRUCTURE_PARSE=OK");

const attachments = discoverAreraAttachments("<a href=\"https://www.arera.it/fileadmin/allegati/docs/26/227-table.xlsx\">Relazione tecnica</a><a href=\"https://example.com/nope.csv\">mirror</a>");
assert.equal(attachments.length, 1);
assert.equal(attachments[0].extension, "XLSX");
console.log("ARERA_ATTACHMENT_DISCOVERY_ALLOWLIST=OK");
assert.throws(() => parseArera227StructuredAttachment({ body: "binary", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceReference: "https://www.arera.it/fileadmin/allegati/docs/26/227-table.xlsx", publicationDate: "2026-06-25", retrievedAt: "2026-08-17T10:00:00Z" }), /ARERA_227_STRUCTURED_PARSE_BLOCKED/);
console.log("ARERA_227_XLSX_FAIL_CLOSED=OK");

const structured = parseArera227StructuredAttachment({ body: "componentCode,originalValue,originalUnit,customerScope,effectiveFrom,effectiveTo,applicationBasis\nASOS,1.23,CENT_EUR/KWH,DOMESTIC_BT,2026-07-01,,official test row\nARIM,0.45,CENT_EUR/KWH,DOMESTIC_BT,2026-01-01,,confirmed from 588/2025/R/com", contentType: "text/csv", sourceReference: "https://www.arera.it/fileadmin/allegati/docs/26/227-table.csv", publicationDate: "2026-06-25", retrievedAt: "2026-08-17T10:00:00Z" });
assert.equal(structured.length, 2);
assert.equal(structured[0].officialIdentifier, ARERA_227_IDENTIFIER);
assert.equal(structured[1].effectiveFrom, "2026-01-01");
console.log("ARERA_227_STRUCTURED_CSV_PARSE=OK");

assert.deepEqual(normalizeRegulatoryUnit(2304, "CENT_EUR/POD/YEAR"), { value: 23.04, unit: "EUR/POD/YEAR", provenance: ["CENT_EUR_TO_EUR_DIVIDE_100"] });
assert.deepEqual(normalizeRegulatoryUnit(12, "EUR/KW/YEAR", "EUR/KW/MONTH"), { value: 1, unit: "EUR/KW/MONTH", provenance: ["YEAR_TO_MONTH_DIVIDE_12"] });
assert.deepEqual(normalizeRegulatoryUnit(1.2, "EUR/MWH"), { value: 0.0012, unit: "EUR/KWH", provenance: ["MWH_TO_KWH_DIVIDE_1000"] });
const podMonthly = normalizeRegulatoryUnit(120, "CENT_EUR/POD/YEAR", "EUR/POD/MONTH");
assert.ok(Math.abs(podMonthly.value - 0.1) < 1e-12);
assert.deepEqual(podMonthly.provenance, ["CENT_EUR_TO_EUR_DIVIDE_100", "YEAR_TO_MONTH_DIVIDE_12"]);
console.log("REGULATORY_UNIT_CONVERSION=OK");

assert.equal(amountUnitConsistency({ code: "TEST", description: "", quantity: "397", unit: "EUR/KWH", unitPrice: "0,283451", amount: "112,53" }).status, "CONSISTENT");
assert.equal(amountUnitConsistency({ code: "TEST", description: "", quantity: "", unit: "EUR/KWH", unitPrice: "", amount: "112,53" }).status, "UNIT_SEMANTICS_INCONSISTENT");
console.log("AMOUNT_VS_UNIT_PRICE_SEPARATION=OK");

assert.equal(customerScopeForBill({ customerType: "RESIDENTIAL", domesticResidenceStatus: "UNKNOWN" }), "UNKNOWN");
assert.equal(customerScopeForBill({ customerType: "RESIDENTIAL", domesticResidenceStatus: "PROVEN" }), "DOMESTIC_RESIDENT_BT");
console.log("CUSTOMER_SCOPE_RESIDENCE_UNKNOWN=OK");

const testRoot = await mkdtemp(join(tmpdir(), "arera-regulatory-"));
const repository = new LocalRegulatoryRepository(testRoot);
const imported = infrastructure.records[3];
const backup = await backupRegulatoryArchive(testRoot);
assert.equal(backup.readable, true);
assert.equal(backup.restoreCheck, true);
console.log("ARERA_BACKUP_READABLE_AND_RESTORE=OK");
assert.equal(await repository.saveRegulatoryValue(imported), "CREATED");
const withChecksum = (value) => { const copy = { ...value }; delete copy.checksum; return { ...copy, checksum: checksumFor(copy) }; };
assert.equal(await repository.saveRegulatoryValue(withChecksum({ ...imported, retrievedAt: "2026-08-17T12:00:00Z" })), "REUSED");
assert.equal(await repository.saveRegulatoryValue(withChecksum({ ...imported, normalizedValue: 99, originalValue: 999 })), "CONFLICT");
console.log("ARERA_IDEMPOTENCE_AND_CONFLICT=OK");

const sourceHtml575 = "<table><tr><th>Anno</th><th>s1</th><th>mis</th><th>s2</th><th>s3</th></tr><tr><td>2026</td><td>2.304,00</td><td>1.954,48</td><td>2.352,00</td><td>1,190</td></tr></table>";
const sourceHtml227 = "<a href=\"https://www.arera.it/fileadmin/allegati/docs/26/227-table.csv\">Tabella ufficiale</a>";
const sourceCsv227 = "componentCode,originalValue,originalUnit,customerScope,effectiveFrom,effectiveTo,applicationBasis\nASOS,1.23,CENT_EUR/KWH,DOMESTIC_BT,2026-07-01,,official ASOS\nARIM,0.45,CENT_EUR/KWH,DOMESTIC_BT,2026-01-01,,confirmed from 588/2025/R/com\nUC3,0.11,CENT_EUR/KWH,DOMESTIC_BT,2026-01-01,,official UC3\nUC6,0.22,CENT_EUR/KWH,DOMESTIC_BT,2026-01-01,,official UC6";
const fakeFetcher = async (url) => {
  if (url === ARERA_575_PAGE) return new Response(sourceHtml575, { status: 200, headers: { "content-type": "text/html" } });
  if (url === ARERA_227_PAGE) return new Response(sourceHtml227, { status: 200, headers: { "content-type": "text/html" } });
  if (url.endsWith("227-table.csv")) return new Response(sourceCsv227, { status: 200, headers: { "content-type": "text/csv" } });
  throw new Error(`UNEXPECTED_SOURCE:${url}`);
};
const adapter = new AreraElectricityRegulatorySourceAdapter(repository, { fetcher: fakeFetcher, regulatoryRoot: testRoot });
const importedSource = await adapter.importOfficial({ retrievedAt: "2026-08-17T10:00:00Z" });
assert.equal(importedSource.structuredParse, "PARSED");
assert.equal(importedSource.systemChargeRecords.length, 4);
assert.equal(importedSource.backup?.readable, true);
assert.equal(importedSource.backup?.restoreCheck, true);
assert.equal(importedSource.actions.filter((action) => action === "CREATED").length, 7);
const reusedSource = await adapter.importOfficial({ retrievedAt: "2026-08-17T12:00:00Z" });
assert.equal(reusedSource.actions.every((action) => action === "REUSED"), true);
console.log("ARERA_IMPORTER_FETCH_VERSIONING_IDEMPOTENCE=OK");

const effective = resolveAreraEffectiveValue([...structured], "2026-07-15", "ASOS", "DOMESTIC_BT");
assert.equal(effective?.componentCode, "ASOS");
console.log("EFFECTIVE_DATE_RESOLUTION=OK");

const bill = { billId: "bill-test", versionId: "v4", vector: "EE", customerType: "RESIDENTIAL", domesticResidenceStatus: "UNKNOWN", billingPeriod: { from: "2026-07-01", to: "2026-08-01" }, chargeLines: [
  { code: "COMMERCIALIZATION", description: "seller", quantity: "397", unit: "EUR/KWH", unitPrice: "0,28", amount: "111,16" },
  { code: "ASOS", description: "asos", quantity: "397", unit: "EUR/KWH", unitPrice: "0,0123", amount: "4,88" },
  { code: "EXCISE", description: "tax", quantity: "397", unit: "EUR/KWH", unitPrice: "0,0227", amount: "9,01" },
  { code: "OTHER_CHARGE", description: "other", quantity: "", unit: "EUR", unitPrice: "", amount: "2,00" },
] };
const auditUnknown = auditElectricityBill(bill, { regulatoryReferences: structured });
assert.equal(auditUnknown.lines[0].auditStatus, "CONTRACT_REFERENCE_REQUIRED");
assert.equal(auditUnknown.lines[1].auditStatus, "SCOPE_UNDETERMINED");
assert.equal(auditUnknown.lines[2].auditStatus, "SOURCE_AUTHORITY_NOT_IMPLEMENTED");
assert.equal(auditUnknown.summary.confirmedAnomalyCount, 0);
assert.equal(auditUnknown.summary.overallStatus, "INCOMPLETE");
console.log("SELLER_CTE_GME_TAX_SEPARATION=OK");
console.log("NO_FALSE_ANOMALY=OK");
console.log("AUDIT_SUMMARY_DTO=OK");

const exactReference = structured.find((record) => record.componentCode === "ASOS");
const exactBill = { billId: "bill-exact", versionId: "v1", vector: "EE", customerType: "RESIDENTIAL", domesticResidenceStatus: "PROVEN", billingPeriod: { from: "2026-07-01", to: "2026-08-01" }, chargeLines: [{ code: "ASOS", description: "asos", quantity: "100", unit: "EUR/KWH", unitPrice: "0,0123", amount: "1,23" }] };
const exactAudit = auditElectricityBill(exactBill, { regulatoryReferences: exactReference ? [{ ...exactReference, normalizedValue: 0.0123, checksum: checksumFor({ ...exactReference, normalizedValue: 0.0123 }) }] : [] });
assert.equal(exactAudit.lines[0].auditStatus, "MATCH");
const mismatchAudit = auditElectricityBill({ ...exactBill, chargeLines: [{ ...exactBill.chargeLines[0], unitPrice: "0,015", amount: "1,50" }] }, { regulatoryReferences: exactReference ? [{ ...exactReference, normalizedValue: 0.0123, checksum: checksumFor({ ...exactReference, normalizedValue: 0.0123 }) }] : [] });
assert.equal(mismatchAudit.lines[0].auditStatus, "OVERCHARGE");
assert.equal(mismatchAudit.summary.confirmedAnomalyCount, 1);
console.log("REGULATED_EXACT_MATCH_AND_MISMATCH=OK");

await rm(testRoot, { recursive: true, force: true });
console.log("arera regulatory audit smoke: ok");
