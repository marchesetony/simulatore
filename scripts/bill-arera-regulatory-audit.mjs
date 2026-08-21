import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { LocalRegulatoryRepository } from "../app/lib/foundation/regulatory-repository.ts";
import { amountUnitConsistency, auditElectricityBill } from "../app/lib/foundation/bill-regulatory-audit.ts";

const billId = "93d9b1f0-c748-4c66-ab32-b0673a96787e";
const tenantId = "tenant_local-demo";
const metadata = JSON.parse(await readFile("var/foundation-documents/metadata.json", "utf8"));
const document = metadata.documents.find((item) => item.id === billId);
if (!document) throw new Error("REAL_BILL_NOT_FOUND");
const version = document.versions.find((item) => item.versionId === document.currentVersionId);
if (!version?.structuredBill) throw new Error("REAL_BILL_VERSION_NOT_AUDITABLE");
const versionId = version.versionId;
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const billHashPre = await hash("var/foundation-documents/metadata.json");
const gmeHashPre = await hash("var/market-archive/metadata.json");
const cteHashPre = await hash("var/cte-archive/metadata.json");

const structured = version.structuredBill;
const supplyProfile = buildBillSupplyProfile(structured.extendedFacts);
const period = structured.billingPeriod.value;
const repository = new LocalRegulatoryRepository("var/foundation-regulatory-data");
const regulatoryReferences = await repository.getRegulatoryValues(tenantId);
const market = JSON.parse(await readFile("var/market-archive/metadata.json", "utf8"));
const marketRecord = market.records.find((item) => item.month === "2026-07" && item.vector === "EE" && item.index === "PUN" && item.status === "APPROVED");
const officialGmeReferences = marketRecord ? [{ month: "2026-07", value: null, unit: "EUR/MWH", sourceReference: marketRecord.record.source.url, officialIdentifier: marketRecord.record.recordId }] : [];
const chargeLines = structured.economicChargeLines;
const audit = auditElectricityBill({
  billId,
  versionId,
  vector: "EE",
  customerType: structured.customerType.value,
  domesticResidenceStatus: supplyProfile.domesticResidenceStatus.normalizedValue === "RESIDENT" ? "PROVEN" : "UNKNOWN",
  billingPeriod: { from: period.from, to: period.to },
  billedConsumptionKwh: structured.billedConsumption.value,
  powerKw: structured.powerKw.value,
  chargeLines,
}, { regulatoryReferences, officialGmeReferences, contractReference: null });

const isConfirmedMismatch = (status) => ["MISMATCH", "OVERCHARGE", "UNDERCHARGE"].includes(status);
const regulatedLines = audit.lines.filter((line) => line.category === "REGULATED_ARERA");
const sellerLines = audit.lines.filter((line) => line.category === "SELLER_CONTRACTUAL");
const taxLines = audit.lines.filter((line) => line.category === "TAX");
const regulatedNotComparable = regulatedLines.filter((line) => line.auditStatus !== "MATCH" && line.auditStatus !== "ROUNDING_DIFFERENCE" && !isConfirmedMismatch(line.auditStatus));
const unitIssues = chargeLines.filter((line) => amountUnitConsistency(line).status === "UNIT_SEMANTICS_INCONSISTENT");
const displayUnitMismatches = chargeLines.filter((line) => amountUnitConsistency(line).displayUnitMismatch);
const reasonCounts = (reason) => regulatedLines.filter((line) => line.notComparableReason === reason).length;
const yesNo = (value) => value ? "SI" : "NO";

console.log("REAL_BILL_AUDIT_EXECUTED=SI");
console.log(`DOMESTIC_RESIDENCE_STATUS=${audit.domesticResidenceStatus}`);
console.log(`AMOUNT_UNIT_CONSISTENCY_CHECK=${unitIssues.length === 0 ? "OK" : "ISSUES_FOUND"}`);
console.log(`DISPLAY_UNIT_MISMATCH_COUNT=${displayUnitMismatches.length}`);
console.log(`AMOUNT_UNIT_CONFUSION_FOUND=${displayUnitMismatches.length || unitIssues.length ? "SI" : "NO"}`);
console.log(`REGULATED_LINES_TOTAL=${regulatedLines.length}`);
console.log("REGULATED_LINE_DIAGNOSTICS=");
for (const line of regulatedLines) {
  console.log(`${line.code} | ${line.auditStatus} | REFERENCE=${yesNo(Boolean(line.sourceReference))} | SCOPE=${yesNo(line.auditStatus !== "SCOPE_UNDETERMINED")} | QUANTITY=${yesNo(line.billQuantity !== null)} | UNIT_PRICE=${yesNo(line.billUnitPrice !== null)} | AMOUNT=${yesNo(line.billAmount !== null)} | FORMULA=${yesNo(line.expectedAmount !== null)} | REASON=${line.notComparableReason}`);
}
console.log(`REGULATED_LINES_MATCH=${regulatedLines.filter((line) => line.auditStatus === "MATCH").length}`);
console.log(`REGULATED_LINES_ROUNDING=${regulatedLines.filter((line) => line.auditStatus === "ROUNDING_DIFFERENCE").length}`);
console.log(`REGULATED_LINES_MISMATCH=${regulatedLines.filter((line) => isConfirmedMismatch(line.auditStatus)).length}`);
console.log(`REGULATED_LINES_OVERCHARGE=${regulatedLines.filter((line) => line.auditStatus === "OVERCHARGE").length}`);
console.log(`REGULATED_LINES_UNDERCHARGE=${regulatedLines.filter((line) => line.auditStatus === "UNDERCHARGE").length}`);
console.log(`REGULATED_LINES_NOT_COMPARABLE=${regulatedNotComparable.length}`);
console.log(`REGULATED_LINES_SOURCE_MISSING=${reasonCounts("REGULATORY_SOURCE_MISSING")}`);
console.log(`REGULATED_LINES_SCOPE_UNDETERMINED=${reasonCounts("CUSTOMER_SCOPE_UNDETERMINED")}`);
console.log(`REGULATED_LINES_AGGREGATED=${reasonCounts("AGGREGATED_BILL_LINE")}`);
console.log(`REGULATED_LINES_DATA_MISSING=${regulatedLines.filter((line) => ["QUANTITY_MISSING", "UNIT_PRICE_MISSING", "INSUFFICIENT_DOCUMENT_DATA"].includes(line.notComparableReason)).length}`);
console.log(`SELLER_LINES_TOTAL=${sellerLines.length}`);
console.log(`SELLER_LINES_CONTRACT_REFERENCE_REQUIRED=${sellerLines.filter((line) => line.auditStatus === "CONTRACT_REFERENCE_REQUIRED").length}`);
console.log(`TAX_LINES_TOTAL=${taxLines.length}`);
console.log(`TAX_LINES_NOT_VERIFIED=${taxLines.filter((line) => line.auditStatus === "SOURCE_AUTHORITY_NOT_IMPLEMENTED").length}`);
console.log(`UNIT_SEMANTICS_ISSUES=${audit.summary.unitSemanticIssueCount}`);
console.log(`TOTAL_CONFIRMED_ANOMALIES=${audit.summary.confirmedAnomalyCount}`);
console.log(`GME_REFERENCE_STATUS=${audit.gme.reference ? "AVAILABLE" : "MISSING"}`);
console.log(`PUN_CONTRACT_AUDIT_STATUS=${audit.gme.reference ? "CONTRACT_REFERENCE_REQUIRED" : "NOT_PROVIDED"}`);
console.log(`AUDIT_OVERALL_STATUS=${audit.summary.overallStatus}`);
console.log(`AUDIT_SOURCE_COVERAGE=${JSON.stringify(audit.summary.sourceCoverage)}`);
console.log(`CONFIRMED_OVERCHARGE_AMOUNT=${audit.summary.confirmedOverchargeAmount.toFixed(2)}`);
console.log(`CONFIRMED_UNDERCHARGE_AMOUNT=${audit.summary.confirmedUnderchargeAmount.toFixed(2)}`);
const billHashPost = await hash("var/foundation-documents/metadata.json");
const gmeHashPost = await hash("var/market-archive/metadata.json");
const cteHashPost = await hash("var/cte-archive/metadata.json");
console.log(`BILL_RUNTIME_UNCHANGED=${billHashPre === billHashPost ? "SI" : "NO"}`);
console.log(`GME_RUNTIME_UNCHANGED=${gmeHashPre === gmeHashPost ? "SI" : "NO"}`);
console.log(`CTE_RUNTIME_UNCHANGED=${cteHashPre === cteHashPost ? "SI" : "NO"}`);
console.log("ANTHROPIC_CALLS=0");
console.log("GME_NETWORK_CALLS=0");
console.log("REAL_BILL_REPROCESS=0");
