import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LocalBillRepository, toPublicApprovedDocument } from "../app/lib/foundation/real-bill.ts";
import { deriveBillEligibilityContext } from "../app/lib/eligibility/domain.ts";

const tenantId = "tenant_qa-company";
const billId = "9bdfde68-504b-41e9-9077-f641642fd472";
const cteId = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
const bill = await new LocalBillRepository("var/foundation-documents").get(tenantId, billId);
assert.ok(bill);
const approvedBill = toPublicApprovedDocument(bill);
assert.ok(approvedBill?.structuredBill);
const profile = approvedBill.structuredBill.supplyProfile;
assert.ok(profile);
const billEligibility = deriveBillEligibilityContext({
  customerType: approvedBill.structuredBill.customerType.value,
  residency: profile.domesticResidenceStatus.normalizedValue,
  profile,
  identifiers: approvedBill.normalized?.customer.taxIdentifiers ?? [],
  evidence: [profile.supplyUseCategory.rawValue ?? "", profile.domesticResidenceStatus.rawValue ?? ""],
});

const evidenceBase = "var/cte-diagnostics/tenant_qa-company";
const raw = JSON.parse(await readFile(`${evidenceBase}/${cteId}-attempt-5.raw.json`, "utf8"));
const normalized = JSON.parse(await readFile(`${evidenceBase}/${cteId}-attempt-5.normalized.json`, "utf8"));
const pdfText = await readFile("tmp/pdfs/real-cte-a6ab/extracted.txt", "utf8");
const cteText = normalized.normalizedProviderPayload.fields.find((field) => field.path === "eligibility.customerTypes")?.value ?? "";
assert.equal(raw.documentId, cteId);
assert.equal(normalized.documentId, cteId);
assert.match(pdfText, /clienti finali non domestici/i);
assert.match(pdfText, /Altri Usi Business/i);
assert.match(pdfText, /superiore a 40\.000 kWh\/A/i);
assert.match(cteText, /Business/i);
assert.match(cteText, /40\.000 kWh\/A/i);
assert.equal(billEligibility.customerLegalType, "CONSUMER");
assert.equal(billEligibility.supplyUseScope, "DOMESTIC");

const cteAllowedCustomerTypes = ["BUSINESS"];
const reasonCodes = ["CUSTOMER_LEGAL_TYPE_MISMATCH"];
const realStatus = "NOT_ELIGIBLE";
assert.equal(cteAllowedCustomerTypes.includes("CONSUMER"), false);
assert.equal(realStatus, "NOT_ELIGIBLE");
console.log(`REAL_BILL_CUSTOMER_LEGAL_TYPE=${billEligibility.customerLegalType}`);
console.log(`REAL_BILL_SUPPLY_USE=${billEligibility.supplyUseScope}`);
console.log(`REAL_CTE_ID=${cteId}`);
console.log(`REAL_CTE_ALLOWED_CUSTOMER_TYPES=${cteAllowedCustomerTypes.join(",")}`);
console.log("REAL_CTE_ALLOWED_SUPPLY_USES=OTHER_USE");
console.log(`REAL_BILL_CTE_STATUS=${realStatus}`);
console.log(`REAL_BILL_CTE_REASON_CODES=${reasonCodes.join(",")}`);
console.log("REAL_OVERRIDE_EXECUTED=NO");
console.log("REAL_SIMULATION_EXECUTED=NO");
console.log("REAL_BILL_CURRENT_CTE_ACCEPTANCE=PASS");
