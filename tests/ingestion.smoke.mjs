import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifyBillText,
  ingestEnergyBill,
  mapTextToEnergyBill,
} from "../app/lib/ingestion/index.ts";
import {
  approveDocumentVersion,
  createManualCorrection,
  LocalBillRepository,
  toPublicDocument,
} from "../app/lib/foundation/real-bill.ts";

const eeText = [
  "EE bill; Customer ID: customer-ee-1; Customer Name: Cliente EE; Customer Type: NON_RESIDENTIAL; VAT Number: IT12345678901;",
  "Supply ID: supply-ee-1; Meter ID: meter-ee-1; POD: IT001E12345678; Voltage Level: LV;",
  "Billing Period: 2026-06-01 to 2026-07-01; Consumption Basis: MEASURED; Supplier: Supplier EE; Offer Name: EE Fixed; Offer Code: EE-001;",
  "F1: 100 kWh; F2: 50 kWh; F3: 25 kWh; Total kWh: 175 kWh",
].join(" ");

const gasText = [
  "GAS bill; Customer ID: customer-gas-1; Customer Name: Cliente GAS; Customer Type: RESIDENTIAL; Tax Code: RSSMRA80A01H501X;",
  "Supply ID: supply-gas-1; Meter ID: meter-gas-1; PDR: 12345678901234;",
  "Billing Period: 2026-06-01 to 2026-07-01; Consumption Basis: ESTIMATED; Supplier: Supplier GAS; Offer Name: GAS PSV; Offer Code: GAS-001;",
  "SMC: 75 Smc; Correction Coefficient: 1.02",
].join(" ");

function pdf(text) {
  return new Uint8Array(Buffer.from(`%PDF-1.7\n(${text}) Tj\n/Type /Page\n%%EOF`, "latin1"));
}

assert.equal(classifyBillText(eeText).vector, "EE");
assert.equal(classifyBillText(gasText).vector, "GAS");
assert.equal(classifyBillText("Supplier: only").vector, "UNKNOWN");
assert.equal(classifyBillText("EE bill; PDR: 12345678901234; GAS; POD: IT001E12345678").vector, "UNKNOWN");

const mappedEe = mapTextToEnergyBill({ text: eeText, pages: 1, tenantId: "tenant_alpha", billId: "bill-ee", versionId: "version-ee" });
assert.equal(mappedEe.contract.vector, "EE");
assert.equal(mappedEe.contract.consumption.total.value, 175);
assert.equal(mappedEe.contract.customer.customerType, "NON_RESIDENTIAL");
assert.equal(mappedEe.contract.valueProvenance.length >= 15, true);
assert.equal(mappedEe.contract.fieldProvenance.every((item) => item.sourceReference === "bill-document:bill-ee"), true);

const incompleteEe = mapTextToEnergyBill({
  text: eeText.replace("F2: 50 kWh; ", "").replace("Offer Code: EE-001; ", ""),
  pages: 1,
  tenantId: "tenant_alpha",
  billId: "bill-ee-incomplete",
  versionId: "version-ee-incomplete",
});
assert.deepEqual(incompleteEe.contract.consumption.f2, { unit: "KWH", status: "UNAVAILABLE", reason: "NOT_EXTRACTED" });
assert.deepEqual(incompleteEe.contract.offer.offerCode, { status: "UNAVAILABLE", reason: "NOT_PROVIDED" });
assert.equal(incompleteEe.contract.valueProvenance.find((item) => item.path === "consumption.f2").source, "UNAVAILABLE");

const mappedGas = mapTextToEnergyBill({ text: gasText, pages: 1, tenantId: "tenant_alpha", billId: "bill-gas", versionId: "version-gas" });
assert.equal(mappedGas.contract.vector, "GAS");
assert.equal(mappedGas.contract.consumption.smc.value, 75);
assert.equal(mappedGas.contract.consumption.correctionCoefficient.value, 1.02);

assert.throws(
  () => mapTextToEnergyBill({ text: "Supplier: unknown", pages: 1, tenantId: "tenant_alpha", billId: "bill-unknown", versionId: "version-unknown" }),
  /BILL_VECTOR_UNKNOWN/,
);
assert.throws(
  () => mapTextToEnergyBill({ text: eeText.replace("Total kWh: 175", "Total kWh: 176"), pages: 1, tenantId: "tenant_alpha", billId: "bill-malformed", versionId: "version-malformed" }),
  /CONSUMPTION_TOTAL_MISMATCH/,
);

const root = await mkdtemp(path.join(tmpdir(), "ingestion-phase2-"));
try {
  const digital = await ingestEnergyBill({
    tenantId: "tenant_alpha",
    localDev: "true",
    fileName: "ee.pdf",
    contentType: "application/pdf",
    bytes: pdf(eeText),
    maxBytes: 100_000,
    documentsRoot: root,
  });
  assert.equal(digital.status, "EXTRACTED");
  assert.equal(digital.contract.vector, "EE");
  assert.equal(digital.document.versions[0].energyContract.vector, "EE");
  assert.equal((await new LocalBillRepository(root).get("tenant_beta", digital.document.id)), null);

  const scanned = await ingestEnergyBill({
    tenantId: "tenant_alpha",
    localDev: "true",
    fileName: "scanned.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array(Buffer.from("%PDF-1.7\n/Type /Page\n%%EOF", "latin1")),
    maxBytes: 100_000,
    documentsRoot: root,
  });
  assert.equal(scanned.status, "OCR_PROVIDER_REQUIRED");
  assert.equal(scanned.errorCode, "OCR_PROVIDER_REQUIRED");
  assert.equal(scanned.contract, null);

  const scannedWithInjectedProvider = await ingestEnergyBill({
    tenantId: "tenant_alpha",
    localDev: "true",
    fileName: "scanned-gas.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array(Buffer.from("%PDF-1.7\n/Type /Page\n%%EOF", "latin1")),
    maxBytes: 100_000,
    documentsRoot: root,
    ocrProvider: { async extract() { return { text: gasText, pages: 1 }; } },
  });
  assert.equal(scannedWithInjectedProvider.status, "EXTRACTED");
  assert.equal(scannedWithInjectedProvider.contract.vector, "GAS");
  assert.equal(scannedWithInjectedProvider.contract.valueProvenance[0].locator.startsWith("ocr:"), true);

  const corrected = createManualCorrection({
    document: digital.document,
    tenantId: "tenant_alpha",
    sourceVersionId: digital.document.currentVersionId,
    field: "supplier",
    value: "Supplier EE Corrected",
    at: "2026-07-31T12:00:00.000Z",
  });
  assert.equal(corrected.versions.length, 2);
  assert.equal(corrected.versions[1].energyContract.vector, "EE");
  let reviewed = corrected;
  for (const [field, value] of Object.entries(toPublicDocument(corrected).fields)) {
    const current = reviewed.versions.at(-1).fields[field];
    if (current.confirmed) continue;
    reviewed = createManualCorrection({ document: reviewed, tenantId: "tenant_alpha", sourceVersionId: reviewed.currentVersionId, field, value: `${value.value ?? "verified"} verified`, at: "2026-07-31T12:00:01.000Z" });
  }
  const approved = approveDocumentVersion({ document: reviewed, tenantId: "tenant_alpha", versionId: reviewed.currentVersionId, at: "2026-07-31T12:01:00.000Z" });
  assert.equal(approved.currentApprovedVersionId, approved.currentVersionId);
  assert.equal(approved.provenance.some((event) => event.type === "APPROVAL"), true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("ingestion smoke tests passed");
