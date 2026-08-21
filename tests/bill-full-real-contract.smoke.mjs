import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractBillFields, ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { classifyBillText } from "../app/lib/ingestion/classifier.ts";
import { mapTextToEnergyBill } from "../app/lib/ingestion/mapping.ts";
import { ingestEnergyBill, retryEnergyBill } from "../app/lib/ingestion/service.ts";

const fixture = `Fattura N*
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

Offerta commerciale: OFFERTA TEST
Scadenza condizioni economiche: indeterminata

Totale da pagare
108,34 €

POD IT001E12345678

Potenza impegnata: 3,0 kW

Box dell'offerta

SPESA PER LA VENDITA DI ENERGIA ELETTRICA

Offerta commerciale: OFFERTA TEST
Data decorrenza condizioni economiche: 01/05/2026
Codice offerta: CODICEOFFERTATEST
Data scadenza condizioni economiche: 30/04/2027
Tipologia di offerta: a prezzo variabile
Data scadenza contratto: 30/04/2027
Tipologia di prezzo: a fasce
Presenza penali di recesso: no

Caratteristiche tecniche della fornitura

POD IT001E12345678
Tipologia cliente: domestico non residente
Tensione di alimentazione: 220,0 V

[000000] FORNITORE LUCE E GAS S.R.L. - VIA TEST 24 00000 CITTA - Partita IVA 00000000000`;

const input = { text: fixture, pages: 1, tenantId: "tenant_full-real", billId: "bill-full-real", versionId: "version-1" };
const mapped = mapTextToEnergyBill(input);
const fields = extractBillFields(fixture);
for (const field of ["supplier", "pod", "customerName", "billingPeriod", "annualConsumption", "billedConsumption", "totalAmount"]) assert.notEqual(fields[field].value, null);
assert.equal(classifyBillText(fixture).vector, "EE");
assert.equal(mapped.classification.vector, "EE");
assert.equal(mapped.contract.customerId, "E0000000");
assert.equal(mapped.contract.customer?.customerType, "NON_RESIDENTIAL");
assert.equal(mapped.contract.customer?.name.status, "KNOWN");
assert.equal(mapped.contract.currentSupplier, "FORNITORE LUCE E GAS S.R.L.");
assert.equal(mapped.contract.customer?.taxIdentifiers.length, 0);
assert.equal(mapped.contract.supply.pod, "IT001E12345678");
assert.equal(mapped.contract.supply.voltageLevel, "LV");
assert.equal(mapped.contract.supply.supplyId, undefined);
assert.equal(mapped.contract.supply.meterId, undefined);
assert.equal(mapped.contract.consumptionBasis, undefined);
assert.equal(mapped.contract.offer.offerName.value, "OFFERTA TEST");
assert.equal(mapped.contract.offer.offerCode.value, "CODICEOFFERTATEST");
assert.equal(mapped.contract.consumption.total.value, 241.73);

const sameLineCustomerId = fixture.replace("Codice cliente\nE0000000\n\n", "");
assert.equal(mapTextToEnergyBill({ ...input, text: sameLineCustomerId }).contract.customerId, "E0000000");
const nextLineCustomerId = sameLineCustomerId.replace("Codice Cliente E0000000\n", "Codice Cliente\nE0000000\n");
assert.equal(mapTextToEnergyBill({ ...input, text: nextLineCustomerId }).contract.customerId, "E0000000");

const withoutCustomerId = fixture.replace("Codice cliente\nE0000000\n\n", "").replace("Codice Cliente E0000000\n", "");
const withoutCustomerIdMapped = mapTextToEnergyBill({ ...input, text: withoutCustomerId });
assert.equal(withoutCustomerIdMapped.contract.customerId, undefined);
assert.equal(withoutCustomerIdMapped.contract.customer?.customerId, undefined);
assert.equal(withoutCustomerIdMapped.contract.supply.pod, "IT001E12345678");
assert.equal(withoutCustomerIdMapped.contract.valueProvenance?.find((item) => item.path === "customer.customerId")?.source, "UNAVAILABLE");
const ocrFormattingVariant = fixture
  .replace("Periodo fatturato: 01/07/2026 - 31/07/2026", "Periodo fatturato\n  01/07/2026  -  31/07/2026")
  .replace("Consumo fatturato: 241,73 kWh", "Consumo fatturato\n241,73   kWh")
  .replace("Tensione di alimentazione: 220,0 V", "Tensione di alimentazione\n220 V")
  .replace("Totale da pagare\n108,34 €", "Totale da pagare\n108,34\n€");
const ocrFormattingMapped = mapTextToEnergyBill({ ...input, text: ocrFormattingVariant });
assert.equal(ocrFormattingMapped.contract.vector, "EE");
assert.equal(ocrFormattingMapped.contract.supply.voltageLevel, "LV");
const bandFixture = `${fixture}

PUN F1=0,1542 €/kWh
PUN F2=0,16938 €/kWh
PUN F3=0,15226 €/kWh

RIEPILOGO CONSUMI
F1 Rilevata 3.455 Rilevata 3.625 1 170,11
F2 2.523 2.558 1 35,25
F3 3.356 3.392 1 36,37

CONSUMI FATTURATI
luglio 2026 Quarto-oraria F1 170,11 2,6
Quarto-oraria F2 35,25 2,6
Quarto-oraria F3 36,37 0,7
Quarto-oraria F0 241,73 3,0`;
const bandMapped = mapTextToEnergyBill({ ...input, text: bandFixture });
assert.equal(bandMapped.contract.consumption.f1.value, 170.11);
assert.equal(bandMapped.contract.consumption.f2.value, 35.25);
assert.equal(bandMapped.contract.consumption.f3.value, 36.37);
const punOnlyMapped = mapTextToEnergyBill({ ...input, text: `${fixture}\nPUN F1=0,1542 €/kWh\nPUN F2=0,16938 €/kWh\nPUN F3=0,15226 €/kWh` });
assert.equal(punOnlyMapped.contract.consumption.f1.status, "UNAVAILABLE");
assert.equal(punOnlyMapped.contract.consumption.f2.status, "UNAVAILABLE");
assert.equal(punOnlyMapped.contract.consumption.f3.status, "UNAVAILABLE");
const monorariaMapped = mapTextToEnergyBill({ ...input, text: `${fixture}\nCONSUMI FATTURATI\nQuarto-oraria F0 241,73 3,0` });
assert.equal(monorariaMapped.contract.consumption.f1.status, "UNAVAILABLE");
assert.equal(monorariaMapped.contract.consumption.f2.status, "UNAVAILABLE");
assert.equal(monorariaMapped.contract.consumption.f3.status, "UNAVAILABLE");
assert.throws(
  () => mapTextToEnergyBill({ ...input, text: fixture.replace("Tipologia cliente: domestico non residente", "Tipologia cliente: valore sconosciuto") }),
  (error) => error?.code === "EXTRACTION_VALUE_INVALID" && error?.field === "customerType",
);
assert.throws(
  () => mapTextToEnergyBill({ ...input, text: fixture.replace("Tensione di alimentazione: 220,0 V", "Tensione di alimentazione: valore sconosciuto") }),
  (error) => error?.code === "EXTRACTION_VALUE_INVALID" && error?.field === "voltageLevel",
);
assert.throws(
  () => mapTextToEnergyBill({ ...input, text: `${fixture}\nConsumption Basis: valore sconosciuto` }),
  (error) => error?.code === "EXTRACTION_VALUE_INVALID" && error?.field === "consumptionBasis",
);
assert.throws(
  () => mapTextToEnergyBill({ ...input, text: fixture.replace("Consumo fatturato: 241,73 kWh", "Consumo fatturato: valore sconosciuto") }),
  (error) => error?.code === "EXTRACTION_VALUE_INVALID" && error?.field === "billedConsumption",
);
assert.throws(
  () => mapTextToEnergyBill({ ...input, text: `${fixture}\nF1: valore sconosciuto` }),
  (error) => error?.code === "EXTRACTION_VALUE_INVALID" && error?.field === "f1",
);
assert.throws(() => mapTextToEnergyBill({ ...input, text: fixture.replaceAll("POD IT001E12345678", "POD INVALIDO") }), /POD_INVALID|EXTRACTION_REQUIRED_FIELD_MISSING/);
assert.throws(() => mapTextToEnergyBill({ ...input, text: fixture.replace("Periodo fatturato: 01/07/2026 - 31/07/2026", "Periodo fatturato: 31/07/2026 - 01/07/2026") }), /PERIOD_INVALID|EXTRACTION_VALUE_INVALID/);
assert.equal(classifyBillText(`${fixture}\nGAS\nPDR 12345678901234`).vector, "UNKNOWN");

const root = await mkdtemp(path.join(os.tmpdir(), "bill-full-real-contract-"));
try {
  const repository = new LocalBillRepository(root);
  const storage = new LocalDocumentStorage(root);
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7 offline-full-real-contract", "latin1"));
  const audit = { async record() {} };
  const fakeProvider = { async extract() { return { text: bandFixture, pages: 1 }; } };
  const invalidProvider = { async extract() { return { text: fixture.replace("Tipologia cliente: domestico non residente", "Tipologia cliente: valore sconosciuto"), pages: 1 }; } };
  const invalidResult = await ingestEnergyBill({ tenantId: "tenant_full-real", authenticated: true, fileName: "offline-invalid-field.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, ocrProvider: invalidProvider });
  assert.equal(invalidResult.status, "FAILED");
  assert.equal(invalidResult.errorCode, "BILL_EXTRACTION_VALUE_INVALID");
  assert.equal(invalidResult.document.versions.at(-1)?.errorField, "customerType");

  const direct = await ingestEnergyBill({ tenantId: "tenant_full-real", authenticated: true, fileName: "offline.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, ocrProvider: fakeProvider });
  assert.equal(direct.status, "EXTRACTED");
  assert.equal(direct.errorCode, null);
  assert.equal(direct.contract?.vector, "EE");
  assert.equal(direct.contract?.customerId, "E0000000");
  assert.equal(direct.contract?.supply.pod, "IT001E12345678");
  assert.equal(direct.contract?.consumption.f1.value, 170.11);
  assert.equal(direct.contract?.consumption.f2.value, 35.25);
  assert.equal(direct.contract?.consumption.f3.value, 36.37);

  const withoutIdProvider = { async extract() { return { text: withoutCustomerId, pages: 1 }; } };
  const withoutId = await ingestEnergyBill({ tenantId: "tenant_full-real", authenticated: true, fileName: "offline-without-customer-id.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, ocrProvider: withoutIdProvider });
  assert.equal(withoutId.status, "EXTRACTED");
  assert.equal(withoutId.errorCode, null);
  assert.equal(withoutId.contract?.customerId, undefined);
  assert.equal(withoutId.contract?.supply.pod, "IT001E12345678");

  const failed = await ingestBill({ tenantId: "tenant_full-real", fileName: "retry.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } } });
  const retried = await retryEnergyBill({ tenantId: "tenant_full-real", document: failed, authenticated: true, storage, repository, audit, ocrProvider: fakeProvider });
  assert.equal(retried.status, "EXTRACTED");
  assert.equal(retried.errorCode, null);
  assert.equal(retried.contract?.vector, "EE");
  assert.equal(retried.contract?.consumption.f1.value, 170.11);
  assert.equal(retried.contract?.consumption.f2.value, 35.25);
  assert.equal(retried.contract?.consumption.f3.value, 36.37);
  assert.equal(retried.document.versions.at(-1)?.status, "EXTRACTED");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("bill full real contract smoke: ok (real format, contract validation, fake provider ingest/retry and fail-closed cases)");
