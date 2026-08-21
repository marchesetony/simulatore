import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractBillFields, ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { classifyBillText } from "../app/lib/ingestion/classifier.ts";
import { mapTextToEnergyBill } from "../app/lib/ingestion/mapping.ts";
import { retryEnergyBill } from "../app/lib/ingestion/service.ts";

const realisticText = `La mia bolletta
Luce

Dati Cliente
NOME CLIENTE TEST
Customer ID: CUSTOMER-TEST
Customer Type: residential
Tax Code: TESTCODICE01

Dati di fatturazione
Fornitura di Energia elettrica
Periodo fatturato: 01/07/2026 - 31/07/2026
Consumo fatturato: 241,73 kWh

Dati della fornitura
Consumo annuo aggiornato:
1.944 kWh (dal 01/05/2026 al 31/07/2026)

Totale da pagare
108,34 €

POD IT001E12345678
Supply ID: SUPPLY-TEST
Meter ID: METER-TEST
Voltage Level: LV
Consumption Basis: measured

ELIOS LUCE E GAS S.R.L.`;

const fieldNames = ["supplier", "pod", "customerName", "billingPeriod", "annualConsumption", "billedConsumption", "totalAmount"];
const fields = extractBillFields(realisticText);
assert.equal(classifyBillText(realisticText).vector, "EE");
assert.deepEqual(fieldNames.filter((name) => fields[name].value === null), []);
assert.equal(fields.annualConsumption.value.startsWith("1944"), true);
assert.equal(fields.billedConsumption.value.startsWith("241.73"), true);
assert.equal(fields.totalAmount.value.startsWith("108.34"), true);

const mapped = mapTextToEnergyBill({ text: realisticText, pages: 1, tenantId: "tenant_required-fields", billId: "bill-required-fields", versionId: "version-1" });
assert.equal(mapped.contract.vector, "EE");
assert.deepEqual(mapped.contract.billingPeriod, { periodStart: "2026-07-01", periodEnd: "2026-07-31" });
assert.equal(mapped.contract.consumption.total.value, 241.73);
assert.equal(mapped.contract.currentSupplier, "ELIOS LUCE E GAS S.R.L.");
assert.equal(mapped.contract.supply.pod, "IT001E12345678");

const sameLinePeriod = realisticText.replace("Periodo fatturato: 01/07/2026 - 31/07/2026", "Periodo fatturato: 01/07/2026 - 31/07/2026");
assert.equal(mapTextToEnergyBill({ text: sameLinePeriod, pages: 1, tenantId: "tenant_required-fields", billId: "bill-period", versionId: "v1" }).contract.billingPeriod.periodStart, "2026-07-01");
assert.equal(extractBillFields(realisticText).totalAmount.value, "108.34 €");

const exactRealFormatText = `Fattura N*
EE00000/2026

Data emissione
05.08.2026

Codice cliente
E0000000

CLIENTE TEST PERSONA
VIA TEST 1

La mia bolletta
Luce

Periodo di riferimento
01.07.2026 - 31.07.2026

Dati Cliente
Codice Cliente E0000000
CLIENTE TEST PERSONA
VIA TEST 1 - 00000 CITTA TEST

Dati di fatturazione
Fornitura di Energia elettrica
MERCATO LIBERO

Periodo fatturato: 01/07/2026 - 31/07/2026
Consumo fatturato: 241,73 kWh

Dati della fornitura

Consumo annuo aggiornato:
1.944 kWh (dal 01/05/2026 al 31/07/2026)

Totale da pagare
108,34 €

POD IT001E12345678

Potenza impegnata: 3,0 kW

FORNITORE LUCE E GAS S.R.L. - VIA TEST 24 00000 CITTA`;
const exactFields = extractBillFields(exactRealFormatText);
assert.equal(classifyBillText(exactRealFormatText).vector, "EE");
assert.deepEqual(fieldNames.filter((name) => exactFields[name].value === null), []);
assert.equal(exactFields.customerName.value, "CLIENTE TEST PERSONA");
assert.equal(exactFields.supplier.value, "FORNITORE LUCE E GAS S.R.L.");
assert.equal(extractBillFields(exactRealFormatText.replace("FORNITORE LUCE", "[000000] FORNITORE LUCE")).supplier.value, "FORNITORE LUCE E GAS S.R.L.");

const numeric = mapTextToEnergyBill({ text: realisticText.replace("Consumo fatturato: 241,73 kWh", "F1: 1.944 kWh\nF2: 0 kWh\nF3: 0 kWh\nConsumo fatturato: 1.944 kWh"), pages: 1, tenantId: "tenant_required-fields", billId: "bill-numbers", versionId: "v1" });
assert.equal(numeric.contract.consumption.f1.value, 1944);
assert.equal(numeric.contract.consumption.total.value, 1944);

const root = await mkdtemp(path.join(os.tmpdir(), "bill-required-fields-"));
try {
  const repository = new LocalBillRepository(root);
  const storage = new LocalDocumentStorage(root);
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7 offline-required-fields", "latin1"));
  const seed = await ingestBill({ tenantId: "tenant_required-fields", fileName: "offline.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} }, extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } } });
  const result = await retryEnergyBill({ tenantId: "tenant_required-fields", document: seed, storage, repository, authenticated: true, audit: { async record() {} }, ocrProvider: { async extract() { return { text: realisticText, pages: 1 }; } } });
  assert.notEqual(result.status, "FAILED");
  assert.notEqual(result.errorCode, "BILL_EXTRACTION_REQUIRED_FIELD_MISSING");
  const current = result.document.versions.at(-1);
  assert.deepEqual(fieldNames.filter((name) => current.fields[name].value === null), []);
  assert.equal(current.energyContract.vector, "EE");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("bill required fields smoke: ok (realistic newline/Italian formats, mapping and fake post-OCR flow)");
