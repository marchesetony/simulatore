import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { resolveTrustedElectricityFiscalContextFromSourceBill } from "../app/lib/calculation/source-bill-context.ts";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { approveDocumentVersion, ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";

const tenant = "tenant_fiscal-security";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 fiscal trust fixture"));
const audit = { async record() {} };
const found = (value, confidence = 0.99) => ({ value, status: "FOUND", confidence, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const fact = (code, value, status = "FOUND") => ({ code, value, status });

const fiscalFacts = [
  fact("SUPPLY_USE_CATEGORY_RAW", "Domestico"),
  fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Residente"),
  fact("VOLTAGE_CLASS_RAW", "BT"),
  fact("POWER_COMMITTED", "3 kW"),
  fact("POWER_AVAILABLE", "6 kW"),
  fact("EXCISE_TREATMENT_RAW", "TAXABLE"),
  fact("EXCISE_SPECIAL_USE_RAW", "ORDINARY"),
  fact("EXCISE_EVIDENCE_RAW", "ADM-EXC-APPROVED::Accisa applicata secondo la dichiarazione approvata"),
  fact("VAT_TREATMENT_RAW", "STANDARD"),
  fact("VAT_DECLARATION_REFERENCE", "VAT-DECL-APPROVED"),
  fact("VAT_EVIDENCE_RAW", "Trattamento standard esplicitamente dichiarato nel documento approvato"),
  fact("FISCAL_EVIDENCE_EFFECTIVE_FROM", "2026-01-01"),
];

function extraction() {
  return {
    schemaVersion: 1,
    vector: found("EE"), supplier: found("FORNITORE TEST"), customerName: found("CLIENTE TEST"), customerId: notFound(), customerType: found("RESIDENTIAL"), customerTaxIdentifier: notFound(),
    billingPeriod: found({ from: "2026-08-01", to: "2026-09-01" }), totalAmount: found(80), annualConsumption: found(1944), billedConsumption: found(175),
    pod: found("IT001E12345678"), pdr: notFound(), voltageLevel: found("LV"), powerKw: found(3), f1Consumption: found(100), f2Consumption: found(50), f3Consumption: found(25), smcConsumption: notFound(), conversionCoefficient: notFound(), pcs: notFound(), offerName: found("OFFERTA TEST"), offerCode: found("CODICE TEST"),
    extendedFacts: fiscalFacts, economicChargeLines: [], supplyProfile: buildBillSupplyProfile(fiscalFacts),
  };
}

const confirmAllFields = (document) => ({
  ...document,
  versions: document.versions.map((version) => ({
    ...version,
    fields: Object.fromEntries(Object.entries(version.fields).map(([key, value]) => [key, { ...value, confirmed: true }])),
  })),
});

function request(sourceBill, overrides = {}) {
  return parseSimulationRequest({
    schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-08-15", supplyPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" },
    customerCategory: "RESIDENTIAL", residency: "RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 25 }, sourceBill, ...overrides,
  }, tenant);
}

const root = await mkdtemp(path.join(tmpdir(), "fiscal-trust-security-"));
try {
  const repository = new LocalBillRepository(root);
  const storage = new LocalDocumentStorage(root);
  const document = await ingestBill({ tenantId: tenant, fileName: "source-bill.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 10_000_000, storage, repository, audit, structuredExtractor: { async extract() { return extraction(); } } });
  const confirmed = confirmAllFields(document);
  await repository.save(confirmed);
  const approved = approveDocumentVersion({ document: confirmed, tenantId: tenant, versionId: confirmed.currentVersionId, at: "2026-08-25T10:00:00.000Z" });
  await repository.save(approved);
  const sourceBill = { billId: approved.id, version: approved.currentApprovedVersionId };

  const trusted = await resolveTrustedElectricityFiscalContextFromSourceBill(repository, tenant, request(sourceBill));
  assert.equal(trusted?.exciseTaxTreatment, "TAXABLE");
  assert.equal(trusted?.vatTreatment, "STANDARD");
  assert.equal(trusted?.supplyContext.contractedPowerKw, 3);
  assert.equal(trusted?.exciseEvidence?.approvedBillBinding?.billId, approved.id);
  assert.equal(trusted?.exciseEvidence?.approvedBillBinding?.approvedVersionId, approved.currentApprovedVersionId);

  const malicious = await resolveTrustedElectricityFiscalContextFromSourceBill(repository, tenant, request(sourceBill, {
    exciseTaxTreatment: "EXEMPT", exciseSpecialUse: "ENERGY_INTENSIVE", vatTreatment: "QUALIFIED_BUSINESS_REDUCED", fiscalEvidence: { sourceKind: "CLIENT_INPUT" }, mixedUseStatus: "MIXED_USE", mixedUsePercentages: [100],
  }));
  assert.deepEqual(malicious, trusted);

  const genericTaxTreatmentChanged = await resolveTrustedElectricityFiscalContextFromSourceBill(repository, tenant, request(sourceBill, { taxTreatment: "INCLUDED" }));
  assert.deepEqual(genericTaxTreatmentChanged, trusted);

  await assert.rejects(() => resolveTrustedElectricityFiscalContextFromSourceBill(repository, tenant, request({ ...sourceBill, version: "wrong-version" })), /SOURCE_BILL_VERSION_MISMATCH/);
  await assert.rejects(() => resolveTrustedElectricityFiscalContextFromSourceBill({ async get() { return { ...approved, currentApprovedVersionId: null }; } }, tenant, request(sourceBill)), /SOURCE_BILL_NOT_APPROVED/);
  await assert.rejects(() => resolveTrustedElectricityFiscalContextFromSourceBill({ async get() { return { ...approved, tenantId: "tenant_other" }; } }, tenant, request(sourceBill)), /SOURCE_BILL_NOT_FOUND/);

  const source = await readFile(new URL("../app/lib/calculation/source-bill-context.ts", import.meta.url), "utf8");
  assert.match(source, /currentApprovedVersionId/);
  assert.match(source, /SOURCE_BILL_VERSION_MISMATCH/);
  assert.match(source, /APPROVED_SOURCE_BILL/);
  assert.doesNotMatch(source, /(?:exciseTaxTreatment|vatTreatment|fiscalEvidence)\s*:/);
  assert.doesNotMatch(source, /fetch\s*\(|https?:\/\//i);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("APPROVED_BILL_FISCAL_BINDING=PASS");
console.log("TENANT_AND_VERSION_GATES=PASS");
console.log("CLIENT_FISCAL_FIELDS_NO_EFFECT=PASS");
console.log("GENERIC_TAX_TREATMENT_NO_EFFECT=PASS");
console.log("NO_FISCAL_UPLOAD_OR_NETWORK=PASS");
