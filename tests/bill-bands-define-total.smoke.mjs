import assert from "node:assert/strict";
import { structuredBillContract, structuredBillContractIssue } from "../app/lib/ingestion/structured-bill.ts";

// Tony (30/10, "NON è POSSIBILE, CHE UNA VOLTA FUNZIONA E UN'ALTRA NO"): the same bill read twice stopped once with "I consumi
// F1, F2 e F3 letti non tornano con il consumo totale". The simulation runs on F1, F2 and F3: when all three are read, their
// sum is the period total, whatever total the reading picked elsewhere on the page.
const found = (value) => ({ value, status: "FOUND", confidence: 0.9, source: "DOCUMENT_AI" });
const missing = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const extraction = (billed) => ({
  schemaVersion: 1, vector: found("EE"), supplier: found("Fornitore"), customerName: missing(), customerId: missing(), customerType: found("RESIDENTIAL"), customerTaxIdentifier: missing(),
  billingPeriod: found({ from: "2026-09-01", to: "2026-09-30" }), totalAmount: found(155.72), annualConsumption: found(1632), billedConsumption: billed === null ? missing() : found(billed),
  pod: found("IT001E00000000"), pdr: missing(), voltageLevel: found("LV"), powerKw: found(6),
  f1Consumption: found(134.97), f2Consumption: found(106.03), f3Consumption: found(82.37), smcConsumption: missing(), conversionCoefficient: missing(), pcs: missing(), offerName: found("Offerta"), offerCode: missing(),
  extendedFacts: [], economicChargeLines: [],
});
for (const billed of [323.37, 323, 1632, null]) {
  const contract = structuredBillContract({ extraction: extraction(billed), tenantId: "tenant_qa-company", billId: "bill-qa", versionId: "bill-qa-v1" });
  assert.ok(contract, `contract with billed ${billed}: ${structuredBillContractIssue(extraction(billed))}`);
  assert.ok(Math.abs(contract.consumption.total.value - 323.37) < 1e-9);
}
console.log("BILL_BANDS_DEFINE_TOTAL=PASS");
