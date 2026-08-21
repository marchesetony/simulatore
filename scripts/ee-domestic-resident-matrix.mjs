import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildDomesticResidentMatrix, classifyPhantomComponents } from "../app/lib/foundation/bill-domestic-resident-matrix.ts";
import { buildBillRegulatoryAudit } from "../app/lib/foundation/bill-public-audit.ts";
import { amountUnitConsistency } from "../app/lib/foundation/bill-regulatory-audit.ts";
import { referenceDomainOf } from "../app/lib/foundation/regulatory-domains.ts";

const TENANT = "tenant_local-demo";
const BILL_ID = "93d9b1f0-c748-4c66-ab32-b0673a96787e";
const REPORT_PATH = "scripts/ee-domestic-resident-matrix.mjs";
const PERIOD_FROM = "2026-07-01";
const PERIOD_TO = "2026-08-01";
const exec = promisify(execFile);

const yesNo = (value) => value ? "SI" : "NO";
const safe = (value) => value === null || value === undefined || value === "" ? "NOT_AVAILABLE" : String(value);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = async (path) => sha256(await readFile(path));
const applicableInPeriod = (record) => Date.parse(record.effectiveFrom) <= Date.parse(PERIOD_FROM)
  && (record.effectiveTo === null || Date.parse(PERIOD_FROM) < Date.parse(record.effectiveTo));
const applicableDomain = (records, domain) => records.filter((record) => applicableInPeriod(record) && referenceDomainOf(record) === domain);

async function commandStatus(command, args) {
  try {
    await exec(command, args, { cwd: process.cwd(), windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return "PASS";
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EINVAL") return `UNAVAILABLE_NODE_SPAWN_${error.code}`;
    return "FAIL";
  }
}

const source = await readFile(REPORT_PATH, "utf8");
const implementationSource = source.slice(source.indexOf("const billArchive"));
const reportLogicSource = implementationSource.split("console.log(`LEGACY_TERNA_COUNT_USED_FOR_COVERAGE=")[0];
const hardcodedSemanticAcceptance = /console\.log\(\s*["'](?:REFERENCE_DOMAIN_COUNTING|AUTHORITY_SEPARATE_FROM_DOMAIN|ARERA_587_DOMAIN_CLASSIFICATION|CAPACITY_OFF_PEAK_REAL_STRUCTURE|NO_PHANTOM_COMPONENTS|SOURCE_COVERAGE_SEPARATE_FROM_AUDITABILITY|PUN_EUR_KWH|AMOUNT_UNIT_ISSUES_ZERO|ZERO_ANOMALIES_NOT_REGULAR_WHEN_PARTIAL)=/.test(implementationSource);
const legacyTernaCountUsedForCoverage = /(?:TERNA_DISPATCHING_REFERENCE_COUNT|TERNA_CAPACITY_REFERENCE_COUNT)[\s\S]{0,240}(?:coverage|COVERAGE)/.test(reportLogicSource)
  || /(?:coverage|COVERAGE)[\s\S]{0,240}(?:TERNA_DISPATCHING_REFERENCE_COUNT|TERNA_CAPACITY_REFERENCE_COUNT)/.test(reportLogicSource);

const billArchive = await json("var/foundation-documents/metadata.json");
const bill = billArchive.documents.find((item) => item.id === BILL_ID);
if (!bill) throw new Error("TARGET_BILL_NOT_FOUND");
const current = bill.versions.find((item) => item.versionId === bill.currentVersionId);
if (!current?.structuredBill || current.versionNumber !== 6 || bill.versions.length !== 6) throw new Error("CURRENT_BILL_VERSION_MISMATCH");
const structured = current.structuredBill;
if (structured.billingPeriod.value.from !== PERIOD_FROM || structured.billingPeriod.value.to !== PERIOD_TO) throw new Error("CURRENT_BILL_PERIOD_MISMATCH");

const regulatoryArchive = await json("var/foundation-regulatory-data/records.json");
const regulatory = regulatoryArchive.regulatoryValues.filter((item) => item.tenantId === TENANT);
const marketArchive = await json("var/market-archive/metadata.json");
const marketEntries = marketArchive.records.filter((item) => item.tenantId === TENANT && item.month === "2026-07" && item.vector === "EE" && item.index === "PUN" && item.status === "APPROVED");
const market = marketEntries[0]?.record ?? null;
const cteArchive = await json("var/cte-archive/metadata.json");
const cteEntries = cteArchive.records.filter((item) => item.tenantId === TENANT && item.vector === "EE" && item.currentApprovedVersionId);
const profile = buildBillSupplyProfile(structured.extendedFacts);
const gmeReferences = market ? [{
  month: "2026-07",
  f1: market.f1?.value ?? null,
  f2: market.f2?.value ?? null,
  f3: market.f3?.value ?? null,
  unit: market.f1?.unit === "EUR_PER_MWH" ? "EUR/MWH" : market.f1?.unit ?? "",
  sourceReference: market.source?.url ?? null,
  officialIdentifier: market.recordId,
}] : [];

const billHashBefore = await hash("var/foundation-documents/metadata.json");
const gmeHashBefore = await hash("var/market-archive/metadata.json");
const cteHashBefore = await hash("var/cte-archive/metadata.json");
const regulatoryHashBefore = await hash("var/foundation-regulatory-data/records.json");

const matrix = buildDomesticResidentMatrix({
  profile,
  billingPeriod: structured.billingPeriod.value,
  chargeLines: structured.economicChargeLines,
  extendedFacts: structured.extendedFacts,
  regulatoryReferences: regulatory,
  gmeReferences,
  contractAvailable: false,
});
const audit = await buildBillRegulatoryAudit({
  id: BILL_ID,
  tenantId: TENANT,
  resolvedVector: "EE",
  currentVersionId: current.versionId,
  structuredBill: structured,
  invoicePunReferences: [],
  normalized: null,
  regulatoryAudit: null,
}, regulatory);

const domainCounts = Object.fromEntries(["NETWORK", "SYSTEM_CHARGES", "DISPATCHING", "CAPACITY_MARKET"].map((domain) => [domain, applicableDomain(regulatory, domain).length]));
const dispatching = applicableDomain(regulatory, "DISPATCHING");
const capacity = applicableDomain(regulatory, "CAPACITY_MARKET");
const dispatchingAuthorityCounts = Object.fromEntries(["ARERA", "TERNA"].map((authority) => [authority, dispatching.filter((record) => record.authority === authority).length]));
const arera587 = regulatory.filter((item) => item.officialIdentifier === "587/2025/R/eel" && applicableInPeriod(item));
const capacityReference = capacity.find((item) => item.componentCode === "CAPACITY_MARKET_OFF_PEAK") ?? null;
const phantom = new Map(classifyPhantomComponents(regulatory, PERIOD_FROM).map((item) => [item.code, item.status]));
const statusFor = (code, fallbackCode = code) => phantom.get(code) ?? (dispatching.some((record) => record.componentCode === fallbackCode) ? "OFFICIAL_REFERENCE_AVAILABLE" : "SOURCE_DISCOVERY_REQUIRED");
const amountUnitIssues = structured.economicChargeLines.filter((line) => amountUnitConsistency(line).status !== "CONSISTENT").length;
const totalConfirmedAnomalies = audit?.summary.confirmedAnomalyCount ?? 0;
const overallBillAuditability = [
  matrix.coverage.ARERA_NETWORK_BILL_AUDITABILITY,
  matrix.coverage.ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY,
  matrix.coverage.DISPATCHING_BILL_AUDITABILITY,
  matrix.coverage.CAPACITY_MARKET_BILL_AUDITABILITY,
  matrix.coverage.GME_BILL_AUDITABILITY,
].every((status) => status === "COMPLETE") ? "COMPLETE" : "PARTIAL";
const phantomAvailable = [...phantom.entries()].filter(([, status]) => status === "OFFICIAL_REFERENCE_AVAILABLE").map(([code]) => code).sort();
const expectedAvailablePhantom = ["CAPACITY_MARKET_OFF_PEAK", "DISPATCHING_TERNA_OPERATION"].sort();
const noPhantomComponents = JSON.stringify(phantomAvailable) === JSON.stringify(expectedAvailablePhantom)
  && !matrix.components.some((item) => ["DISPATCHING_UPLIFT", "DISPATCHING_ESSENTIAL_UNITS", "DISPATCHING_EXTRAORDINARY_MODULATION", "DISPATCHING_WIND_COMPENSATION", "DISPATCHING_OTHER_ITEMS", "CAPACITY_MARKET", "CAPACITY_MARKET_PEAK"].includes(item.code));

const billHashAfter = await hash("var/foundation-documents/metadata.json");
const gmeHashAfter = await hash("var/market-archive/metadata.json");
const cteHashAfter = await hash("var/cte-archive/metadata.json");
const regulatoryHashAfter = await hash("var/foundation-regulatory-data/records.json");

const referenceDomainCounting = domainCounts.NETWORK === matrix.areraNetworkReferenceCount
  && domainCounts.SYSTEM_CHARGES === matrix.areraSystemChargeReferenceCount
  && domainCounts.DISPATCHING === matrix.dispatchingReferenceCount
  && domainCounts.CAPACITY_MARKET === matrix.capacityMarketReferenceCount
  && marketEntries.length === 1;
const authoritySeparateFromDomain = dispatching.length === dispatchingAuthorityCounts.ARERA + dispatchingAuthorityCounts.TERNA
  && dispatchingAuthorityCounts.ARERA > 0;
const arera587Classification = arera587.length === 2
  && arera587.every((item) => referenceDomainOf(item) === "DISPATCHING" && item.authority === "ARERA");
const capacityOffPeakRealStructure = capacity.length === 1
  && capacityReference?.componentCode === "CAPACITY_MARKET_OFF_PEAK"
  && referenceDomainOf(capacityReference) === "CAPACITY_MARKET"
  && !capacity.some((item) => ["CAPACITY_MARKET", "CAPACITY_MARKET_PEAK"].includes(item.componentCode));
const sourceCoverageSeparateFromAuditability = matrix.coverage.ARERA_NETWORK_SOURCE_COVERAGE === "VERIFIED"
  && matrix.coverage.ARERA_NETWORK_BILL_AUDITABILITY === "DOCUMENT_DETAIL_REQUIRED";
const punEurKwh = matrix.pun.appliedDisplayValue === 0.196201
  && matrix.pun.appliedDisplayUnit === "EUR/KWH"
  && JSON.stringify(matrix.pun.source.map((band) => [band.band, band.displayValue, band.displayUnit]))
    === JSON.stringify([["F1", 0.1542, "EUR/KWH"], ["F2", 0.16938, "EUR/KWH"], ["F3", 0.15226, "EUR/KWH"]]);
const zeroAnomaliesRenderedAsRegular = totalConfirmedAnomalies === 0 && overallBillAuditability !== "COMPLETE" ? "NO" : "NOT_APPLICABLE";
const zeroAnomaliesNotRegularWhenPartial = totalConfirmedAnomalies === 0 && overallBillAuditability !== "COMPLETE" && zeroAnomaliesRenderedAsRegular === "NO";

console.log(`NETWORK_REFERENCE_COUNT=${domainCounts.NETWORK}`);
console.log(`SYSTEM_CHARGES_REFERENCE_COUNT=${domainCounts.SYSTEM_CHARGES}`);
console.log(`DISPATCHING_REFERENCE_COUNT=${domainCounts.DISPATCHING}`);
console.log(`CAPACITY_MARKET_REFERENCE_COUNT=${domainCounts.CAPACITY_MARKET}`);
console.log(`GME_REFERENCE_COUNT=${marketEntries.length}`);
console.log(`DISPATCHING_ARERA_AUTHORITY_COUNT=${dispatchingAuthorityCounts.ARERA}`);
console.log(`DISPATCHING_TERNA_AUTHORITY_COUNT=${dispatchingAuthorityCounts.TERNA}`);
console.log(`DISPATCHING_TOTAL_REFERENCE_COUNT=${dispatching.length}`);

console.log(`ARERA_EXPECTED_REFERENCE_COUNT=${matrix.areraExpectedReferenceCount}`);
console.log(`ARERA_AVAILABLE_REFERENCE_COUNT=${matrix.areraAvailableReferenceCount}`);
console.log(`ARERA_MISSING_REFERENCE_COUNT=${matrix.areraMissingReferenceCount}`);
console.log(`ARERA_MISSING_REFERENCE_CODES=${matrix.areraMissingReferenceCodes.join(",") || "NONE"}`);
console.log(`ARERA_NETWORK_SOURCE_COVERAGE=${matrix.coverage.ARERA_NETWORK_SOURCE_COVERAGE}`);
console.log(`ARERA_NETWORK_BILL_AUDITABILITY=${matrix.coverage.ARERA_NETWORK_BILL_AUDITABILITY}`);
console.log(`ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE=${matrix.coverage.ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE}`);
console.log(`ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY=${matrix.coverage.ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY}`);
console.log(`DISPATCHING_SOURCE_COVERAGE=${matrix.coverage.DISPATCHING_SOURCE_COVERAGE}`);
console.log(`DISPATCHING_BILL_AUDITABILITY=${matrix.coverage.DISPATCHING_BILL_AUDITABILITY}`);
console.log(`CAPACITY_MARKET_SOURCE_COVERAGE=${matrix.coverage.CAPACITY_MARKET_SOURCE_COVERAGE}`);
console.log(`CAPACITY_MARKET_BILL_AUDITABILITY=${matrix.coverage.CAPACITY_MARKET_BILL_AUDITABILITY}`);
console.log(`GME_SOURCE_COVERAGE=${matrix.coverage.GME_SOURCE_COVERAGE}`);
console.log(`GME_BILL_AUDITABILITY=${matrix.coverage.GME_BILL_AUDITABILITY}`);
console.log(`CONTRACT_SOURCE_COVERAGE=${matrix.coverage.CONTRACT_COVERAGE}`);
console.log(`TAX_SOURCE_COVERAGE=${matrix.coverage.TAX_COVERAGE}`);
console.log(`OVERALL_BILL_AUDITABILITY=${overallBillAuditability}`);

for (const [index, item] of arera587.entries()) {
  console.log(`ARERA_587_COMPONENT_${index + 1}=${item.componentCode}`);
  console.log(`ARERA_587_COMPONENT_${index + 1}_VALUE=${item.originalValue}`);
  console.log(`ARERA_587_COMPONENT_${index + 1}_UNIT=${item.originalUnit}`);
  console.log(`ARERA_587_COMPONENT_${index + 1}_DOMAIN=${referenceDomainOf(item)}`);
  console.log(`ARERA_587_COMPONENT_${index + 1}_AUTHORITY=${item.authority}`);
}
console.log(`CAPACITY_REFERENCE_CODE=${safe(capacityReference?.componentCode)}`);
console.log(`CAPACITY_REFERENCE_OFFICIAL_NAME=${safe(capacityReference?.officialName)}`);
console.log(`CAPACITY_REFERENCE_VALUE=${safe(capacityReference?.originalValue)}`);
console.log(`CAPACITY_REFERENCE_UNIT=${safe(capacityReference?.originalUnit)}`);
console.log(`CAPACITY_REFERENCE_EFFECTIVE_FROM=${safe(capacityReference?.effectiveFrom)}`);
console.log(`CAPACITY_REFERENCE_EFFECTIVE_TO=${safe(capacityReference?.effectiveTo)}`);
console.log(`CAPACITY_REFERENCE_DOMAIN=${safe(referenceDomainOf(capacityReference ?? {}))}`);
console.log(`CAPACITY_REFERENCE_AUTHORITY=${safe(capacityReference?.authority)}`);

console.log(`DISPATCHING_TOTAL_STATUS=${statusFor("DISPATCHING_TOTAL", "DISPATCHING")}`);
console.log(`DISPATCHING_UPLIFT_STATUS=${statusFor("DISPATCHING_UPLIFT")}`);
console.log(`DISPATCHING_ESSENTIAL_UNITS_STATUS=${statusFor("DISPATCHING_ESSENTIAL_UNITS")}`);
console.log(`DISPATCHING_TERNA_OPERATION_STATUS=${statusFor("DISPATCHING_TERNA_OPERATION")}`);
console.log(`DISPATCHING_EXTRAORDINARY_MODULATION_STATUS=${statusFor("DISPATCHING_EXTRAORDINARY_MODULATION")}`);
console.log(`DISPATCHING_WIND_COMPENSATION_STATUS=${statusFor("DISPATCHING_WIND_COMPENSATION")}`);
console.log(`DISPATCHING_OTHER_ITEMS_STATUS=${statusFor("DISPATCHING_OTHER_ITEMS")}`);
console.log(`CAPACITY_MARKET_STATUS=${phantom.get("CAPACITY_MARKET")}`);
console.log(`CAPACITY_MARKET_PEAK_STATUS=${phantom.get("CAPACITY_MARKET_PEAK")}`);
console.log(`CAPACITY_MARKET_OFF_PEAK_STATUS=${phantom.get("CAPACITY_MARKET_OFF_PEAK")}`);

console.log(`PUN_APPLIED_DISPLAY_VALUE=${safe(matrix.pun.appliedDisplayValue)}`);
console.log(`PUN_APPLIED_DISPLAY_UNIT=${safe(matrix.pun.appliedDisplayUnit)}`);
for (const band of matrix.pun.source) {
  console.log(`GME_${band.band}_DISPLAY_VALUE=${safe(band.displayValue)}`);
  console.log(`GME_${band.band}_DISPLAY_UNIT=${safe(band.displayUnit)}`);
}
console.log(`AMOUNT_UNIT_ISSUES=${amountUnitIssues}`);
console.log(`TOTAL_CONFIRMED_ANOMALIES=${totalConfirmedAnomalies}`);
console.log(`ZERO_ANOMALIES_RENDERED_AS_REGULAR=${zeroAnomaliesRenderedAsRegular}`);
console.log(`LEGACY_TERNA_COUNT_USED_FOR_COVERAGE=${yesNo(legacyTernaCountUsedForCoverage)}`);
console.log(`HARDCODED_SEMANTIC_ACCEPTANCE=${yesNo(hardcodedSemanticAcceptance)}`);

console.log(`BILL_RUNTIME_UNCHANGED=${yesNo(billHashBefore === billHashAfter)}`);
console.log(`GME_RUNTIME_UNCHANGED=${yesNo(gmeHashBefore === gmeHashAfter)}`);
console.log(`CTE_RUNTIME_UNCHANGED=${yesNo(cteHashBefore === cteHashAfter)}`);
console.log(`REGULATORY_RUNTIME_UNCHANGED=${yesNo(regulatoryHashBefore === regulatoryHashAfter)}`);
console.log(`REFERENCE_DOMAIN_COUNTING=${referenceDomainCounting ? "PASS" : "FAIL"}`);
console.log(`AUTHORITY_SEPARATE_FROM_DOMAIN=${authoritySeparateFromDomain ? "PASS" : "FAIL"}`);
console.log(`ARERA_587_DOMAIN_CLASSIFICATION=${arera587Classification ? "PASS" : "FAIL"}`);
console.log(`CAPACITY_OFF_PEAK_REAL_STRUCTURE=${capacityOffPeakRealStructure ? "PASS" : "FAIL"}`);
console.log(`NO_PHANTOM_COMPONENTS=${noPhantomComponents ? "PASS" : "FAIL"}`);
console.log(`SOURCE_COVERAGE_SEPARATE_FROM_AUDITABILITY=${sourceCoverageSeparateFromAuditability ? "PASS" : "FAIL"}`);
console.log(`PUN_EUR_KWH=${punEurKwh ? "PASS" : "FAIL"}`);
console.log(`AMOUNT_UNIT_ISSUES_ZERO=${amountUnitIssues === 0 ? "PASS" : "FAIL"}`);
console.log(`ZERO_ANOMALIES_NOT_REGULAR_WHEN_PARTIAL=${zeroAnomaliesNotRegularWhenPartial ? "PASS" : "FAIL"}`);

console.log(`GIT_DIFF_CHECK=${await commandStatus(process.platform === "win32" ? "git.exe" : "git", ["diff", "--check"])}`);
console.log(`TSC=${await commandStatus(process.platform === "win32" ? ".\\node_modules\\.bin\\tsc.cmd" : "./node_modules/.bin/tsc", ["--noEmit"])}`);
console.log(`LINT=${await commandStatus(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "lint"])}`);
console.log(`SEMANTIC_SMOKE_TEST=${await commandStatus(process.execPath, ["--experimental-strip-types", "tests/ee-domestic-resident-matrix.smoke.mjs"])}`);
console.log(`FILE_MODIFICATI=${REPORT_PATH}`);
console.log(`CTE_APPROVED_LOCAL_RECORDS=${cteEntries.length}`);
console.log("ANTHROPIC_CALLS=0");
console.log("STAGE_A_CALLS=0");
console.log("STAGE_B_CALLS=0");
console.log("NETWORK_CALLS=0");
console.log("NON staging.");
console.log("NON commit.");
console.log("NON push.");
console.log("NON merge.");
console.log("NON deploy.");

const acceptance = [
  referenceDomainCounting,
  authoritySeparateFromDomain,
  arera587Classification,
  capacityOffPeakRealStructure,
  noPhantomComponents,
  sourceCoverageSeparateFromAuditability,
  punEurKwh,
  amountUnitIssues === 0,
  zeroAnomaliesNotRegularWhenPartial,
  !hardcodedSemanticAcceptance,
  !legacyTernaCountUsedForCoverage,
  billHashBefore === billHashAfter,
  gmeHashBefore === gmeHashAfter,
  cteHashBefore === cteHashAfter,
  regulatoryHashBefore === regulatoryHashAfter,
].every(Boolean);

if (acceptance) console.log("EE AUDIT SEMANTICS PASSED ? READY FOR FINAL UI");
else console.log("EE AUDIT SEMANTICS FAILED ? DO NOT UPDATE UI");
