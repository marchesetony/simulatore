import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { resolveTrustedElectricityContextFromSourceBill } from "../app/lib/calculation/source-bill-context.ts";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { approveDocumentVersion, createManualCorrection, ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";

const tenantA = "tenant_source-bill-a";
const tenantB = "tenant_source-bill-b";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 source bill fixture"));
const audit = { async record() {} };
const found = (value, confidence = 0.99) => ({ value, status: "FOUND", confidence, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const fact = (code, value, status = "FOUND") => ({ code, value, status });

function facts({ committed = "3 kW", available = "6 kW", maximumDrawn = null, billingBasis = null, residence = "Residente", voltage = "BT", supplyUse = "Domestico" } = {}) {
  return [
    fact("SUPPLY_USE_CATEGORY_RAW", supplyUse),
    fact("DOMESTIC_RESIDENCE_STATUS_RAW", residence),
    fact("VOLTAGE_CLASS_RAW", voltage),
    ...(committed === null ? [] : [fact("POWER_COMMITTED", committed)]),
    ...(available === null ? [] : [fact("POWER_AVAILABLE", available)]),
    ...(maximumDrawn === null ? [] : [fact("POWER_MAXIMUM_DRAWN", maximumDrawn)]),
    ...(billingBasis === null ? [] : [fact("POWER_BILLING_BASIS_RAW", billingBasis)]),
  ];
}

function eeExtraction(overrides = {}, profileFacts = facts()) {
  return {
    schemaVersion: 1,
    vector: found("EE"),
    supplier: found("FORNITORE TEST S.R.L."),
    customerName: found("CLIENTE TEST PERSONA"),
    customerId: notFound(),
    customerType: found("RESIDENTIAL"),
    customerTaxIdentifier: notFound(),
    billingPeriod: found({ from: "2026-08-01", to: "2026-09-01" }),
    totalAmount: found(80),
    annualConsumption: found(1944),
    billedConsumption: found(175),
    pod: found("IT001E12345678"),
    pdr: notFound(),
    voltageLevel: found("LV"),
    powerKw: found(3),
    f1Consumption: found(100),
    f2Consumption: found(50),
    f3Consumption: found(25),
    smcConsumption: notFound(),
    conversionCoefficient: notFound(),
    pcs: notFound(),
    offerName: found("OFFERTA TEST"),
    offerCode: found("CODICEOFFERTATEST"),
    extendedFacts: profileFacts,
    economicChargeLines: [],
    supplyProfile: buildBillSupplyProfile(profileFacts),
    ...overrides,
  };
}

function gasExtraction() {
  return {
    ...eeExtraction({}, []),
    vector: found("GAS"),
    pod: notFound(),
    pdr: found("12345678901234"),
    voltageLevel: notFound(),
    powerKw: notFound(),
    f1Consumption: notFound(),
    f2Consumption: notFound(),
    f3Consumption: notFound(),
    smcConsumption: found(75.5),
    conversionCoefficient: found(1.02),
    supplyProfile: undefined,
    extendedFacts: [],
  };
}

const confirmAllFields = (document) => ({
  ...document,
  versions: document.versions.map((version) => ({
    ...version,
    fields: Object.fromEntries(Object.entries(version.fields).map(([key, value]) => [key, { ...value, confirmed: true }])),
  })),
});

async function seed({ repository, storage, tenantId, extraction, approve = true }) {
  const document = await ingestBill({
    tenantId,
    fileName: "source-bill.pdf",
    contentType: "application/pdf",
    bytes: pdf,
    maxBytes: 10_000_000,
    storage,
    repository,
    audit,
    structuredExtractor: { async extract() { return extraction; } },
  });
  if (!approve) return document;
  const confirmed = confirmAllFields(document);
  await repository.save(confirmed);
  const approved = approveDocumentVersion({ document: confirmed, tenantId, versionId: confirmed.currentVersionId, at: "2026-08-25T10:00:00.000Z" });
  await repository.save(approved);
  return approved;
}

function request(tenantId, sourceBill, overrides = {}) {
  return parseSimulationRequest({
    schemaVersion: 1,
    tenantId,
    vector: "EE",
    calculationDate: "2026-08-15",
    supplyPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" },
    customerCategory: "RESIDENTIAL",
    residency: "RESIDENT",
    voltageLevel: "LV",
    currency: "EUR",
    taxTreatment: "EXCLUDED",
    consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 25 },
    sourceBill,
    ...overrides,
  }, tenantId);
}

function assertSyncCode(action, code) {
  assert.throws(action, (error) => error?.code === code || error?.message === code, `expected ${code}`);
}

async function assertAsyncCode(action, code) {
  await assert.rejects(action, (error) => error?.code === code || error?.message === code, `expected ${code}`);
}

const root = await mkdtemp(path.join(tmpdir(), "source-bill-trust-"));
try {
  const repository = new LocalBillRepository(root);
  const storage = new LocalDocumentStorage(root);
  const approved = await seed({ repository, storage, tenantId: tenantA, extraction: eeExtraction() });
  const sourceBill = { billId: approved.id, version: approved.currentApprovedVersionId };
  const trusted = await resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, sourceBill));
  assert.equal(trusted?.contractedPowerKw, 3);
  assert.equal(trusted?.availablePowerKw, 6);
  assert.equal(trusted?.regulatoryCustomerScope, "DOMESTIC_RESIDENT_BT");

  const bta6Extraction = eeExtraction({}, facts({ supplyUse: "Altri usi", committed: "17 kW", available: "18,7 kW", billingBasis: "Potenza contrattualmente impegnata" }));
  const bta6Approved = await seed({ repository, storage, tenantId: tenantA, extraction: bta6Extraction });
  const bta6SourceBill = { billId: bta6Approved.id, version: bta6Approved.currentApprovedVersionId };
  const bta6Trusted = await resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, bta6SourceBill, { customerCategory: "NON_RESIDENTIAL", residency: undefined }));
  assert.equal(bta6Trusted?.regulatoryCustomerScope, "NON_DOMESTIC_BT_BTA6");
  assert.equal(bta6Trusted?.availablePowerKw, 18.7);
  assert.equal(bta6Trusted?.contractedPowerKw, 17);
  assert.equal(bta6Trusted?.regulatoryPowerBasisKind, "CONTRACTUAL_COMMITTED");
  assert.equal(bta6Trusted?.regulatoryPowerBasisKw, 17);
  assertSyncCode(() => request(tenantA, bta6SourceBill, { regulatoryCustomerScope: "NON_DOMESTIC_BT_BTA6" }), "TRUSTED_OUTCOME_FORBIDDEN");

  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, { ...sourceBill, version: "version-number-1" })), "SOURCE_BILL_VERSION_MISMATCH");
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, { billId: "missing-bill", version: "missing-version" })), "SOURCE_BILL_NOT_FOUND");
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantB, request(tenantB, sourceBill)), "SOURCE_BILL_NOT_FOUND");

  const working = createManualCorrection({ document: approved, tenantId: tenantA, sourceVersionId: approved.currentVersionId, field: "totalAmount", value: "999", at: "2026-08-25T11:00:00.000Z" });
  await repository.save(working);
  assert.equal((await resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, sourceBill)))?.contractedPowerKw, 3);
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, { billId: approved.id, version: working.currentVersionId })), "SOURCE_BILL_VERSION_MISMATCH");

  const unapproved = await seed({ repository, storage, tenantId: tenantA, extraction: eeExtraction(), approve: false });
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, { billId: unapproved.id, version: unapproved.currentVersionId })), "SOURCE_BILL_NOT_APPROVED");

  const noStructured = { ...approved, versions: approved.versions.map((version) => ({ ...version, structuredBill: undefined })) };
  const noStructuredRepository = { async get(tenantId, billId) { return tenantId === tenantA && billId === approved.id ? noStructured : repository.get(tenantId, billId); } };
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(noStructuredRepository, tenantA, request(tenantA, sourceBill)), "SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE");

  const gas = await seed({ repository, storage, tenantId: tenantA, extraction: gasExtraction() });
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, { billId: gas.id, version: gas.currentApprovedVersionId })), "SOURCE_BILL_VECTOR_MISMATCH");

  const missingPower = await seed({ repository, storage, tenantId: tenantA, extraction: eeExtraction({}, facts({ committed: null })) });
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, { billId: missingPower.id, version: missingPower.currentApprovedVersionId })), "CONTRACTED_POWER_REQUIRED");
  const missingBta6AvailablePower = await seed({ repository, storage, tenantId: tenantA, extraction: eeExtraction({}, facts({ supplyUse: "Altri usi", committed: "25 kW", available: null })) });
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, { billId: missingBta6AvailablePower.id, version: missingBta6AvailablePower.currentApprovedVersionId }, { customerCategory: "NON_RESIDENTIAL", residency: undefined })), "AVAILABLE_POWER_REQUIRED_FOR_BT_TARIFF_CLASS");

  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, sourceBill, { voltageLevel: "MV" })), "SOURCE_BILL_VOLTAGE_MISMATCH");
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, sourceBill, { customerCategory: "NON_RESIDENTIAL", residency: undefined })), "SOURCE_BILL_CUSTOMER_CATEGORY_MISMATCH");
  await assertAsyncCode(() => resolveTrustedElectricityContextFromSourceBill(repository, tenantA, request(tenantA, sourceBill, { residency: "NON_RESIDENT" })), "SOURCE_BILL_RESIDENCY_MISMATCH");

  const legacy = request(tenantA, undefined);
  assert.equal(await resolveTrustedElectricityContextFromSourceBill({ async get() { throw new Error("LEGACY_SOURCE_BILL_LOOKUP_FORBIDDEN"); } }, tenantA, legacy), null);
  assertSyncCode(() => request(tenantA, sourceBill, { regulatoryCustomerScope: "DOMESTIC_RESIDENT_BT" }), "TRUSTED_OUTCOME_FORBIDDEN");
  assertSyncCode(() => request(tenantA, sourceBill, { contractedPowerKw: 99 }), "TRUSTED_OUTCOME_FORBIDDEN");

  const gasRequest = parseSimulationRequest({ schemaVersion: 1, tenantId: tenantA, vector: "GAS", calculationDate: "2026-08-15", supplyPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" }, customerCategory: "NON_RESIDENTIAL", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: false } } }, tenantA);
  assert.equal(await resolveTrustedElectricityContextFromSourceBill({ async get() { throw new Error("GAS_SOURCE_BILL_LOOKUP_FORBIDDEN"); } }, tenantA, gasRequest), null);

  const source = await readFile(new URL("../app/lib/calculation/source-bill-context.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:ARERA|TERNA|GME|PUN|ASOS|ARIM|UC3|UC6|CAPACITY_MARKET|DISPATCHING|EUR\/KWH|EUR\/KW)/);
  assert.doesNotMatch(source, /(?:fetch\s*\(|https?:\/\/|Anthropic|OCR)/i);
  assert.match(source, /billRepository\.get\(tenantId, request\.sourceBill\.billId\)/);

  console.log("SOURCE_BILL_TESTS=PASS");
  console.log("TENANT_ISOLATION=PASS");
  console.log("APPROVED_VERSION_BINDING=PASS");
  console.log("CLIENT_SERVER_RECONCILIATION=PASS");
  console.log("NO_OCR=PASS");
  console.log("NO_NETWORK=PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
