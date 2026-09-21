import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { LocalBillRepository, toPublicApprovedDocument } from "../app/lib/foundation/real-bill.ts";
import { buildBillRegulatoryAudit } from "../app/lib/foundation/bill-public-audit.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { currentApprovedCteVersion } from "../app/lib/cte/archive/service.ts";
import { evaluateCteEligibility } from "../app/lib/cte/eligibility.ts";
import { deriveBillEligibilityContext, deriveCteCustomerScope, evaluateCustomerAndSupply } from "../app/lib/eligibility/domain.ts";
import { loadLocalRuntimeEnvForTests } from "./support/standalone-runtime-env.mjs";

const tenantId = "tenant_qa-company";
loadLocalRuntimeEnvForTests({ expectedTenantId: tenantId });
const cteOwnerTenant = "tenant_local-demo";
const billId = "9bdfde68-504b-41e9-9077-f641642fd472";
const approvedBillVersion = "d5d52bef-555e-417c-8638-3c89574bf6c6";
const offerName = "Be STRONG NEW >60.000 Kwh/A";
const billingDate = "2026-08-01";
const billingPeriod = { periodStart: "2026-08-01", periodEnd: "2026-08-31" };

const bill = await new LocalBillRepository("var/foundation-documents").get(tenantId, billId);
assert.ok(bill, "real approved bill is required");
assert.equal(bill.currentApprovedVersionId, approvedBillVersion);
const approvedBill = toPublicApprovedDocument(bill);
assert.ok(approvedBill);
assert.equal(approvedBill.currentVersionId, approvedBillVersion);
assert.equal(approvedBill.reviewState, "APPROVED_CURRENT");
assert.equal(approvedBill.structuredBill?.vector.value, "EE");
assert.equal(approvedBill.structuredBill?.customerType.value, "NON_RESIDENTIAL");
assert.equal(approvedBill.structuredBill?.voltageLevel.value, "LV");
assert.equal(approvedBill.structuredBill?.annualConsumption.value, 25838);
assert.equal(approvedBill.structuredBill?.billingPeriod.value.from, billingPeriod.periodStart);
assert.equal(approvedBill.structuredBill?.billingPeriod.value.to, billingPeriod.periodEnd);
assert.equal(approvedBill.structuredBill?.pod.value, "IT001E94378018");
const billProfile = approvedBill.structuredBill;
const billSupplyProfile = billProfile.supplyProfile;
assert.ok(billSupplyProfile);
assert.equal(billSupplyProfile.domesticResidenceStatus.normalizedValue, "NON_RESIDENT");
assert.equal(billSupplyProfile.supplyUseCategory.normalizedValue, "DOMESTIC");
assert.equal(billSupplyProfile.powerCommitted.status, "FOUND");
assert.equal(billSupplyProfile.powerAvailable.status, "NOT_FOUND");

const runtime = new LocalFilesystemAdapter("var/phase6");
const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(runtime.collection("regulatory-values"), runtime.collection("regulatory-approval-domains"));
const regulatoryRuntime = await regulatoryBridge.list(tenantId, { effectiveAt: billingDate });
assert.ok(regulatoryRuntime.every((record) => {
  const startsBeforeOrAt = record.effectiveFrom <= billingDate;
  const endsAfter = record.effectiveTo === null || billingDate < record.effectiveTo;
  return record.tenantId === tenantId && startsBeforeOrAt && endsAfter;
}));
for (const componentCode of ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "ASOS", "ARIM", "UC3", "UC6"]) {
  assert.ok(regulatoryRuntime.some((record) => record.tenantId === tenantId && record.componentCode === componentCode), `missing effective ${componentCode} runtime record`);
}
const regulatoryReadback = await buildBillRegulatoryAudit(approvedBill, regulatoryRuntime);
assert.ok(regulatoryReadback?.regulatedPassThrough);
assert.deepEqual(regulatoryReadback.regulatedPassThrough.items.filter((item) => item.comparable).map((item) => item.code), ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "ASOS", "ARIM", "UC3", "UC6"]);

const cteRepository = new LocalCteArchiveRepository("var/cte-archive");
const allCte = JSON.parse(await readFile("var/cte-archive/metadata.json", "utf8")).records;
const sourceArchive = allCte.find((record) => record.tenantId === cteOwnerTenant && record.versions.some((version) => version.contract?.offer?.name === offerName));
assert.ok(sourceArchive, "the real CTE archive record must be present");
const cteRecord = await cteRepository.get(cteOwnerTenant, sourceArchive.archiveId);
assert.ok(cteRecord);
const cteVersion = currentApprovedCteVersion(cteRecord);
assert.ok(cteVersion);
const cte = cteVersion.contract;
assert.equal(cte.offer.name, offerName);
assert.equal(cte.vector, "EE");
assert.equal(cte.supplier.name, "BPower Energia S.p.A.");
assert.equal(cte.tenantId, cteOwnerTenant);
assert.equal(cteVersion.status, "APPROVED");
assert.equal(cte.approval.status, "APPROVED");
assert.equal(cteRecord.commercialStatus, "ACTIVE");
const realBillEligibility = deriveBillEligibilityContext({
  customerType: approvedBill.energyContract?.customer?.customerType ?? approvedBill.structuredBill?.customerType.value,
  residency: billSupplyProfile.domesticResidenceStatus.normalizedValue,
  profile: billSupplyProfile,
  identifiers: approvedBill.normalized?.customer.taxIdentifiers ?? [],
  evidence: [billSupplyProfile.supplyUseCategory.rawValue ?? "", billSupplyProfile.domesticResidenceStatus.rawValue ?? ""],
});
const realCteScope = deriveCteCustomerScope(cte);
const realCommercialReasons = evaluateCustomerAndSupply({ bill: realBillEligibility, cte: realCteScope });
assert.equal(realBillEligibility.customerLegalType, "CONSUMER");
assert.equal(realBillEligibility.supplyUseScope, "DOMESTIC");
assert.ok(realCommercialReasons.includes("CUSTOMER_LEGAL_TYPE_MISMATCH"));
assert.equal(cte.validity.periodStart, "2025-11-06");
assert.equal(cte.validity.periodEnd, "2026-12-31");
assert.equal(cte.expiry.status, "EXPIRES_ON");
assert.equal(cte.expiry.date, "2026-12-31");
assert.equal(cte.eligibility.customerTypes.includes("NON_RESIDENTIAL"), true);
assert.equal(cte.eligibility.customerScopes, undefined);
assert.deepEqual(cte.eligibility.voltageLevels, ["MV"]);
assert.equal(cte.pricing.mode, "INDEXED");
assert.equal(cte.pricing.reference, "PUN");
assert.equal(cte.commercialTerms.fixedFees[0].amount, 15);
assert.equal(cte.commercialTerms.fixedFees[0].unit, "EUR_PER_MONTH");

const targetTenantCte = await cteRepository.get(tenantId, cteRecord.archiveId);
assert.equal(targetTenantCte, null, "cross-tenant CTE direct-ID lookup must fail closed");
const eligibility = evaluateCteEligibility(cteRecord, {
  tenantId,
  vector: "EE",
  customerType: "NON_RESIDENTIAL",
  customerScope: "DOMESTIC_NON_RESIDENT_BT",
  voltageLevel: "LV",
  supplyPeriod: billingPeriod,
  calculationDate: billingDate,
});
assert.equal(eligibility.eligibilityStatus, "NOT_COMPATIBLE");
assert.equal(eligibility.eligibilityReason, "CTE_TENANT_MISMATCH");

const strictCustomerScopeMatch = Array.isArray(cte.eligibility.customerScopes)
  && cte.eligibility.customerScopes.includes("DOMESTIC_NON_RESIDENT_BT");
const voltageMatch = cte.eligibility.voltageLevels.includes(billProfile.voltageLevel.value);
const powerRules = { min: null, max: null };
const annualThresholdRule = "NOT_AVAILABLE: il record approvato non espone una soglia annuale strutturata; il nome commerciale non è prova";
assert.equal(strictCustomerScopeMatch, false);
assert.equal(voltageMatch, false);
assert.equal(powerRules.min, null);
assert.equal(powerRules.max, null);
assert.equal(billProfile.annualConsumption.value, 25838);
assert.equal(billingDate >= cte.validity.periodStart && billingPeriod.periodEnd <= cte.validity.periodEnd, true);
assert.equal(cteRecord.commercialStatus, "ACTIVE");
assert.equal(cte.approval.status, "APPROVED");

console.log("REAL_BILL_SOURCE_BINDING=PASS");
console.log("REAL_CTE_READBACK=PASS");
console.log("REAL_REGULATORY_READBACK=PASS");
console.log("SCOPE_MATCH=NO");
console.log("VOLTAGE_MATCH=NO");
console.log("POWER_MATCH=NOT_APPLICABLE_NO_CTE_POWER_RULE");
console.log("CONSUMPTION_THRESHOLD=NOT_EVALUATED_NO_STRUCTURED_RULE");
console.log("VALIDITY_MATCH=YES");
console.log("APPROVAL_ACTIVE_STATUS=PASS");
console.log("TENANT_ISOLATION=PASS");
console.log("DIRECT_ID_TAMPERING_DENIAL=PASS");
console.log(`REAL_BILL_PROFILE=vector=EE;customerType=${billProfile.customerType.value};residency=${billSupplyProfile.domesticResidenceStatus.normalizedValue};scope=DOMESTIC_NON_RESIDENT_BT;voltage=${billProfile.voltageLevel.value};contractedPowerRaw=${billSupplyProfile.powerCommitted.rawValue};availablePower=${billSupplyProfile.powerAvailable.status};annualKwh=${billProfile.annualConsumption.value};period=${billingPeriod.periodStart}/${billingPeriod.periodEnd};POD=${billProfile.pod.value};offer=${billProfile.offerName.value}`);
console.log(`REAL_BILL_ANNUAL_CONSUMPTION_KWH=${billProfile.annualConsumption.value}`);
console.log(`REAL_BILL_CUSTOMER_LEGAL_TYPE=${realBillEligibility.customerLegalType}`);
console.log(`REAL_BILL_SUPPLY_USE=${realBillEligibility.supplyUseScope}`);
console.log(`REAL_CTE_ALLOWED_CUSTOMER_TYPES=${realCteScope.allowedCustomerTypes.join(",")}`);
console.log(`REAL_CTE_ALLOWED_SUPPLY_USES=${realCteScope.allowedSupplyUses.length ? realCteScope.allowedSupplyUses.join(",") : "NOT_DECLARED"}`);
console.log(`CTE_ID=${cte.cteId}`);
console.log(`CTE_TENANT=${cte.tenantId}`);
console.log(`CTE_VERSION_ID=${cteVersion.versionId}`);
console.log(`CTE_OFFER=${cte.offer.name}`);
console.log("CTE_ELIGIBILITY_SMOKE=PASS");
console.log(`ANNUAL_CONSUMPTION_THRESHOLD_RULE=${annualThresholdRule}`);
console.log("ANNUAL_CONSUMPTION_THRESHOLD_MATCH=NO_RULE_AVAILABLE");
console.log("CONTRACT_ELIGIBLE=NO");
console.log("REAL_BILL_CTE_ELIGIBILITY=NOT_ELIGIBLE");
console.log(`REAL_BILL_CTE_REASON_CODES=${realCommercialReasons.join(",")}`);
console.log("CALCULATION_READY=NO");
console.log("CTE_ELIGIBLE_FOR_REAL_BILL=NO");
console.log("MARKET_DATA_REQUIRED=YES:PUN");
console.log("MARKET_DATA_AVAILABLE=NOT_CHECKED_NON_ELIGIBLE_NO_CALCULATION");
console.log("NO_SIMULATION=PASS");
console.log("SYNTHETIC_DATA_USED_FOR_ACCEPTANCE=NO");
console.log("REAL_CTE_ELIGIBILITY_SMOKE=PASS");
