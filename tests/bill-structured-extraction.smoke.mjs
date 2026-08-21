import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ingestEnergyBill, retryEnergyBill } from "../app/lib/ingestion/service.ts";
import { ANTHROPIC_BILL_STRUCTURED_TOOL, createAnthropicStructuredBillProvider, parseAnthropicStructuredBillResponse } from "../app/lib/ingestion/structured-bill.ts";
import { LocalBillRepository, LocalDocumentStorage, approveDocumentVersion, createManualCorrection } from "../app/lib/foundation/real-bill.ts";

const realisticFixture = [
  "Fattura N* EE00000/2026",
  "La mia bolletta Luce",
  "Periodo di riferimento 01.07.2026 - 31.07.2026",
  "PUN F1=0,1542 €/kWh PUN F2=0,16938 €/kWh PUN F3=0,15226 €/kWh",
  "RIEPILOGO CONSUMI",
  "F1 Rilevata 3.455 Rilevata 3.625 1 170,11",
  "F2 2.523 2.558 1 35,25",
  "F3 3.356 3.392 1 36,37",
  "CONSUMI FATTURATI Quarto-oraria F1 170,11 2,6 Quarto-oraria F2 35,25 2,6 Quarto-oraria F3 36,37 0,7",
  "Consumo annuo aggiornato: 1.944 kWh Consumo fatturato: 241,73 kWh Totale da pagare 108,34 €",
  "POD IT001E12345678 Potenza impegnata: 3,0 kW Tensione di alimentazione: 220,0 V",
  "Riferimenti generici al gas naturale nelle informative",
].join("\n");
const pdf = new Uint8Array(Buffer.from(`%PDF-1.7\n${realisticFixture}\n%%EOF`, "latin1"));
const found = (value, confidence = 0.99) => ({ value, status: "FOUND", confidence, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });

function eeExtraction(overrides = {}) {
  return {
    schemaVersion: 1,
    vector: found("EE"),
    supplier: found("FORNITORE TEST S.R.L."),
    customerName: found("CLIENTE TEST PERSONA"),
    customerId: notFound(),
    customerType: found("NON_RESIDENTIAL"),
    customerTaxIdentifier: notFound(),
    billingPeriod: found({ from: "2026-07-01", to: "2026-07-31" }),
    totalAmount: found(108.34),
    annualConsumption: found(1944),
    billedConsumption: found(241.73),
    pod: found("IT001E12345678"),
    pdr: notFound(),
    voltageLevel: found("LV"),
    powerKw: found(3),
    f1Consumption: found(170.11),
    f2Consumption: found(35.25),
    f3Consumption: found(36.37),
    smcConsumption: notFound(),
    conversionCoefficient: notFound(),
    pcs: notFound(),
    offerName: found("OFFERTA TEST"),
    offerCode: found("CODICEOFFERTATEST"),
    ...overrides,
  };
}

function gasExtraction(overrides = {}) {
  return {
    ...eeExtraction(),
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
    ...overrides,
  };
}

const wireField = (item) => ({ value: item.status === "NOT_FOUND" ? "NOT_FOUND" : typeof item.value === "object" ? `${item.value.from} - ${item.value.to}` : String(item.value), status: item.status });
const wireExtraction = (extraction) => Object.fromEntries(Object.entries(extraction).map(([key, value]) => [key, key === "schemaVersion" ? value : wireField(value)]));

async function sandbox(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  return { root, async close() { await rm(root, { recursive: true, force: true }); } };
}

async function ingest(extraction, root, fileName = "structured-fixture.pdf") {
  return ingestEnergyBill({
    tenantId: "tenant_alpha",
    fileName,
    contentType: "application/pdf",
    bytes: pdf,
    maxBytes: 1_000_000,
    documentsRoot: root,
    localDev: "true",
    structuredProvider: { async extract() { return extraction; } },
  });
}

const schemaExtraction = eeExtraction();
const schemaWireExtraction = wireExtraction(schemaExtraction);
const normalizedSchemaExtraction = structuredClone(schemaExtraction);
for (const value of Object.values(normalizedSchemaExtraction)) if (value && typeof value === "object" && value.status === "FOUND") value.confidence = 0.9;
const expectedSchemaExtraction = {
  ...normalizedSchemaExtraction,
  billingPeriod: { ...normalizedSchemaExtraction.billingPeriod, value: { ...normalizedSchemaExtraction.billingPeriod.value, raw: "2026-07-01 - 2026-07-31" } },
  extendedFacts: [],
  economicChargeLines: [],
};
const response = await new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_BILL_STRUCTURED_TOOL.name, input: schemaWireExtraction }] }), { status: 200, headers: { "content-type": "application/json" } }).json();
assert.deepEqual(parseAnthropicStructuredBillResponse(response), expectedSchemaExtraction);
assert.equal(ANTHROPIC_BILL_STRUCTURED_TOOL.input_schema.properties.f1Consumption.properties.status.enum.includes("FOUND"), true);
const unsupportedSchemaKeywords = new Set(["minimum", "maximum", "minLength", "maxLength", "pattern", "format", "default", "oneOf", "anyOf", "allOf"]);
const schemaKeywordHits = [];
function inspectSchema(value, path = "schema") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item, index) => inspectSchema(item, `${path}[${index}]`));
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedSchemaKeywords.has(key)) schemaKeywordHits.push(`${path}.${key}`);
    inspectSchema(child, `${path}.${key}`);
  }
}
inspectSchema(ANTHROPIC_BILL_STRUCTURED_TOOL.input_schema);
assert.deepEqual(schemaKeywordHits, []);

let requestBody;
const provider = createAnthropicStructuredBillProvider({ CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fake-key", ANTHROPIC_MODEL: "fake-model" }, async (_url, init) => {
  requestBody = JSON.parse(init.body);
  return new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_BILL_STRUCTURED_TOOL.name, input: schemaWireExtraction }] }), { status: 200 });
}, async () => {});
assert.deepEqual(await provider.extract({ bytes: pdf, contentType: "application/pdf" }), expectedSchemaExtraction);
assert.equal(requestBody.tool_choice.name, ANTHROPIC_BILL_STRUCTURED_TOOL.name);
assert.deepEqual(requestBody.thinking, { type: "disabled" });
assert.equal(requestBody.tool_choice.disable_parallel_tool_use, true);

for (const [status, expected, attempts] of [[400, "BILL_OCR_REQUEST_INVALID", 1], [401, "BILL_OCR_PROVIDER_AUTH_FAILED", 1], [429, "BILL_OCR_PROVIDER_RATE_LIMITED", 1], [500, "BILL_OCR_PROVIDER_UNAVAILABLE", 3], [529, "BILL_OCR_PROVIDER_UNAVAILABLE", 3]]) {
  let calls = 0;
  const httpProvider = createAnthropicStructuredBillProvider({ CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fake-key", ANTHROPIC_MODEL: "fake-model" }, async () => { calls += 1; return new Response("{}", { status }); }, async () => {});
  await assert.rejects(() => httpProvider.extract({ bytes: pdf, contentType: "application/pdf" }), new RegExp(expected));
  assert.equal(calls, attempts);
}
const networkProvider = createAnthropicStructuredBillProvider({ CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fake-key", ANTHROPIC_MODEL: "fake-model" }, async () => { throw new Error("network"); }, async () => {});
await assert.rejects(() => networkProvider.extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_NETWORK_ERROR/);
const timeoutProvider = createAnthropicStructuredBillProvider({ CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fake-key", ANTHROPIC_MODEL: "fake-model" }, async () => { throw new DOMException("aborted", "AbortError"); }, async () => {});
await assert.rejects(() => timeoutProvider.extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_PROVIDER_TIMEOUT/);

const eeBox = await sandbox("bill-structured-ee-");
try {
  const ee = await ingest(eeExtraction(), eeBox.root);
  assert.equal(ee.status, "REVIEW_REQUIRED");
  assert.equal(ee.errorCode, null);
  assert.equal(ee.classification.vector, "EE");
  assert.equal(ee.contract.vector, "EE");
  assert.equal(ee.document.versions.at(-1).structuredBill.customerId.status, "NOT_FOUND");
  assert.equal(ee.contract.consumption.f1.value, 170.11);
  assert.equal(ee.contract.consumption.f2.value, 35.25);
  assert.equal(ee.contract.consumption.f3.value, 36.37);

  let reviewed = ee.document;
  for (const [field, value] of Object.entries({ supplier: "FORNITORE HUMAN S.R.L.", pod: "IT001E12345679", customerName: "CLIENTE HUMAN", billingPeriod: "2026-07-02 - 2026-07-31", annualConsumption: "1945", billedConsumption: "242", totalAmount: "109" })) {
    reviewed = createManualCorrection({ document: reviewed, tenantId: "tenant_alpha", sourceVersionId: reviewed.currentVersionId, field, value, at: "2026-08-13T12:00:00.000Z" });
  }
  const approved = approveDocumentVersion({ document: reviewed, tenantId: "tenant_alpha", versionId: reviewed.currentVersionId, at: "2026-08-13T12:01:00.000Z" });
  assert.equal(approved.currentApprovedVersionId, approved.currentVersionId);
  assert.equal(approved.versions.at(-1).structuredBill.supplier.source, "HUMAN_CORRECTION");

  const noBands = await ingest(eeExtraction({ f1Consumption: notFound(), f2Consumption: notFound(), f3Consumption: notFound() }), eeBox.root, "no-bands.pdf");
  assert.equal(noBands.status, "REVIEW_REQUIRED");
  assert.equal(noBands.errorCode, null);
  assert.equal(noBands.contract.consumption.f1.status, "UNAVAILABLE");

  const noSupplier = await ingest(eeExtraction({ supplier: notFound() }), eeBox.root, "missing-supplier.pdf");
  assert.equal(noSupplier.status, "REVIEW_REQUIRED");
  assert.equal(noSupplier.errorCode, null);
  assert.equal(noSupplier.contract, null);

  const gas = await ingest(gasExtraction(), eeBox.root, "gas-fixture.pdf");
  assert.equal(gas.status, "REVIEW_REQUIRED");
  assert.equal(gas.errorCode, null);
  assert.equal(gas.classification.vector, "GAS");
  assert.equal(gas.contract.vector, "GAS");
  assert.equal(gas.contract.consumption.smc.value, 75.5);

  const informativeGas = await ingest(eeExtraction(), eeBox.root, "ee-with-gas-informative-text.pdf");
  assert.equal(informativeGas.classification.vector, "EE");
  assert.equal(informativeGas.contract.vector, "EE");

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const image = await ingestEnergyBill({
    tenantId: "tenant_alpha", fileName: "structured-fixture.png", contentType: "image/png", bytes: png, maxBytes: 1_000_000, documentsRoot: eeBox.root, localDev: "true",
    structuredProvider: { async extract(input) { assert.equal(input.contentType, "image/png"); return eeExtraction(); } },
  });
  assert.equal(image.status, "REVIEW_REQUIRED");
  assert.equal(image.errorCode, null);

  const failedDocument = await ingestEnergyBill({
    tenantId: "tenant_alpha", fileName: "bounded-failure.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 1_000_000, documentsRoot: eeBox.root, localDev: "true",
    structuredProvider: { async extract() { throw new Error("BILL_OCR_PROVIDER_UNAVAILABLE"); } },
  });
  assert.equal(failedDocument.status, "FAILED");
  assert.equal(failedDocument.errorCode, "BILL_OCR_PROVIDER_UNAVAILABLE");

  const retried = await retryEnergyBill({
    tenantId: "tenant_alpha", document: failedDocument.document, storage: new LocalDocumentStorage(eeBox.root), repository: new LocalBillRepository(eeBox.root), localDev: "true",
    structuredProvider: { async extract() { return eeExtraction(); } },
  });
  assert.equal(retried.status, "REVIEW_REQUIRED");
  assert.equal(retried.errorCode, null);
  assert.equal(retried.document.versions.length, 2);
  assert.equal(retried.contract.consumption.f1.value, 170.11);
} finally {
  await eeBox.close();
}

console.log("bill structured extraction smoke: ok");
