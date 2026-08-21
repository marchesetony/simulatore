import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approveDocumentVersion, createManualCorrection, ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicApprovedDocument, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { mapTextToEnergyBill } from "../app/lib/ingestion/mapping.ts";
import { retryBill } from "../app/lib/foundation/real-bill.ts";
import { simulationDraftFromBill } from "../app/lib/ui/bill-simulation.ts";
import { hasPublicBillData, publicBillMissingLabels } from "../app/lib/ui/bill-display.ts";
import { ingestEnergyBill, retryEnergyBill } from "../app/lib/ingestion/service.ts";
import { billOcrPublicError } from "../app/lib/ingestion/errors.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "bill-operational-flow-"));
const tenant = "tenant_bill-operational";
const otherTenant = "tenant_other-bill";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill fixture"));
const eeText = "EE; POD: IT12345678901234; Voltage Level: LV; F1: 100; F2: 50; F3: 25; Customer ID: C-EE-1; Cliente: Cliente EE; Customer Type: business; VAT Number: IT12345678901; Supply ID: S-EE-1; Meter ID: M-EE-1; Billing Period: 2026-01-01 - 2026-02-01; Supplier: Fornitore EE; Offer Name: Offerta EE; Consumption Basis: measured; Consumo annuo: 2.000; Consumo fatturato: 175; Totale da pagare: 80";
const gasText = "GAS; PDR: 12345678901234; Smc: 200; correction coefficient: 1,05; Customer ID: C-GAS-1; Customer Type: residential; Tax Code: RSSMRA80A01H501U; Supply ID: S-GAS-1; Meter ID: M-GAS-1; Billing Period: 2026-01-01 - 2026-02-01; Supplier: Fornitore GAS; Offer Name: Offerta GAS; Consumption Basis: measured; Consumo annuo: 2.400; Consumo fatturato: 200; Totale da pagare: 70";
const audit = { async record() {} };
const map = (text) => (input) => mapTextToEnergyBill({ ...input, text, pages: 1, billId: input.documentId }).contract;
const confirm = (document) => ({ ...document, versions: document.versions.map((version) => ({ ...version, fields: Object.fromEntries(Object.entries(version.fields).map(([key, field]) => [key, { ...field, confirmed: true }])) })) });

try {
  const repository = new LocalBillRepository(root);
  const storage = new LocalDocumentStorage(root);
  const ee = await ingestBill({ tenantId: tenant, fileName: "ee.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 10_000_000, storage, repository, audit, extractor: { async extract() { return { text: eeText, pages: 1 }; } }, mapEnergyContract: map(eeText) });
  const gas = await ingestBill({ tenantId: tenant, fileName: "gas.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 10_000_000, storage, repository, audit, extractor: { async extract() { return { text: gasText, pages: 1 }; } }, mapEnergyContract: map(gasText) });
  assert.equal(ee.versions[0].energyContract.vector, "EE"); assert.equal(gas.versions[0].energyContract.vector, "GAS");
  const eePublic = toPublicDocument(ee); const gasPublic = toPublicDocument(gas);
  assert.equal(eePublic.normalized.supply.reference, "IT12345678901234"); assert.equal(eePublic.normalized.consumption.f1, 100); assert.equal(gasPublic.normalized.supply.reference, "12345678901234"); assert.equal(gasPublic.normalized.consumption.smc, 200); assert.equal(gasPublic.normalized.consumption.correctionCoefficient, 1.05);
  assert.equal("objectKey" in eePublic, false); assert.equal("versionId" in eePublic.normalized, false); assert.equal(eePublic.normalized.missing.includes("Totale bolletta"), false);
  const embeddedPdf = new Uint8Array(Buffer.from(`%PDF-1.7\n(${eeText}) Tj\n%%EOF`, "latin1")); const embeddedWithoutProvider = await ingestEnergyBill({ tenantId: tenant, localDev: "true", fileName: "embedded.pdf", contentType: "application/pdf", bytes: embeddedPdf, maxBytes: 10_000_000, documentsRoot: root, ocrProviderFactory: () => { throw new Error("BILL_OCR_PROVIDER_CONFIGURATION_INVALID"); } }); assert.equal(embeddedWithoutProvider.status, "EXTRACTED");

  const confirmed = confirm(ee); await repository.save(confirmed); const approved = approveDocumentVersion({ document: confirmed, tenantId: tenant, versionId: confirmed.currentVersionId, at: "2026-08-07T10:00:00.000Z" }); await repository.save(approved);
  const repeated = approveDocumentVersion({ document: approved, tenantId: tenant, versionId: approved.currentVersionId, at: "2027-01-01T00:00:00.000Z" }); assert.deepEqual(repeated, approved);
  const approvedSnapshot = toPublicApprovedDocument(approved); assert.equal(approvedSnapshot.reviewState, "APPROVED_CURRENT");
  const working = createManualCorrection({ document: approved, tenantId: tenant, sourceVersionId: approved.currentVersionId, field: "totalAmount", value: "999", at: "2026-08-07T11:00:00.000Z" }); await repository.save(working); assert.deepEqual(toPublicApprovedDocument(working).normalized, approvedSnapshot.normalized); assert.equal((await repository.list(tenant)).filter((item) => item.currentApprovedVersionId !== null).length, 1);
  const draft = simulationDraftFromBill(approvedSnapshot.normalized); assert.equal(draft.vector, "EE"); assert.equal(draft.supplyReference, "IT12345678901234"); assert.equal(draft.f1, "100"); assert.equal(draft.f2, "50"); assert.equal(draft.f3, "25"); assert.equal(draft.baseline, "");

  const failed = await ingestBill({ tenantId: tenant, fileName: "failed.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 10_000_000, storage, repository, audit, extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } } });
  assert.equal(failed.versions[0].status, "OCR_PROVIDER_REQUIRED"); const failedPublicBeforeRetry = toPublicDocument(failed); assert.equal(failedPublicBeforeRetry.normalized, null); assert.equal(hasPublicBillData(failedPublicBeforeRetry.normalized, failedPublicBeforeRetry.fields), false);
  const scannedWithoutProvider = await ingestEnergyBill({ tenantId: tenant, localDev: "true", fileName: "scanned-no-provider.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 10_000_000, documentsRoot: root, ocrProviderFactory: () => { throw new Error("ANTHROPIC_API_KEY_MISSING"); } }); assert.equal(scannedWithoutProvider.status, "FAILED"); assert.equal(scannedWithoutProvider.errorCode, "BILL_OCR_PROVIDER_CONFIGURATION_INVALID"); assert.equal(scannedWithoutProvider.document.versions[0].status, "FAILED");
  const failedVersionCount = failed.versions.length; await assert.rejects(() => retryEnergyBill({ tenantId: tenant, document: failed, storage, repository, authenticated: true }), /BILL_OCR_PROVIDER_NOT_CONFIGURED/); assert.equal((await repository.get(tenant, failed.id)).versions.length, failedVersionCount);
  let persistedFailure = failed;
  for (const code of ["BILL_OCR_REQUEST_INVALID", "BILL_OCR_BILLING_ERROR", "BILL_OCR_NETWORK_ERROR"]) {
    const failureResult = await retryEnergyBill({ document: persistedFailure, tenantId: tenant, storage, repository, authenticated: true, ocrProvider: { async extract() { throw new Error(code); } }, audit });
    const storedVersion = failureResult.document.versions.at(-1);
    assert.equal(failureResult.errorCode, code);
    assert.equal(storedVersion.errorCode, code);
    assert.deepEqual(billOcrPublicError(storedVersion.errorCode), { code, message: billOcrPublicError(code).message, status: billOcrPublicError(code).status });
    persistedFailure = failureResult.document;
  }
  const retried = await retryBill({ document: failed, tenantId: tenant, storage, repository, audit, extractor: { async extract() { return { text: gasText, pages: 1 }; } }, mapEnergyContract: map(gasText) }); assert.equal(retried.id, failed.id); assert.equal(retried.versions.length, 2); assert.equal(retried.versions.at(-1).energyContract.vector, "GAS");
  const failedPublic = toPublicDocument(retried); assert.equal(failedPublic.normalized.vector, "GAS");
  const partialFields = { ...eePublic.fields, totalAmount: { ...eePublic.fields.totalAmount, value: null } }; assert.equal(hasPublicBillData(eePublic.normalized, partialFields), true); assert.ok(publicBillMissingLabels(eePublic.normalized, partialFields).includes("Totale bolletta")); assert.equal(publicBillMissingLabels(eePublic.normalized, eePublic.fields).length, 0);

  const metadata = JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8")); const legacyWithoutErrorCode = structuredClone(metadata.documents.find((document) => document.id === failed.id)); for (const version of legacyWithoutErrorCode.versions) delete version.errorCode; await writeFile(path.join(root, "metadata.json"), JSON.stringify({ schemaVersion: 1, documents: [legacyWithoutErrorCode] }, null, 2)); const legacyRead = await new LocalBillRepository(root).get(tenant, failed.id); assert.ok(legacyRead); assert.equal(legacyRead.versions.some((version) => "errorCode" in version), false);

  const deleteCandidate = await ingestBill({ tenantId: tenant, fileName: "delete.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 10_000_000, storage, repository, audit, extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } } }); assert.ok(typeof repository.delete === "function"); await repository.delete(tenant, deleteCandidate.id); assert.equal(await repository.get(tenant, deleteCandidate.id), null); assert.equal(await repository.get(otherTenant, deleteCandidate.id), null);
  const detailRoute = await readFile(new URL("../app/api/bills/[id]/route.ts", import.meta.url), "utf8"); const retryRoute = await readFile(new URL("../app/api/bills/[id]/retry/route.ts", import.meta.url), "utf8"); const errorsSource = await readFile(new URL("../app/lib/ingestion/errors.ts", import.meta.url), "utf8"); const panel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8"); const shell = await readFile(new URL("../app/components/OperationalShell.tsx", import.meta.url), "utf8");
  assert.match(detailRoute, /export async function DELETE/); assert.match(detailRoute, /BILL_APPROVED_DELETE_FORBIDDEN/); assert.match(retryRoute, /retryEnergyBill/); assert.match(retryRoute, /createAnthropicBillSdkAdapter/); assert.doesNotMatch(retryRoute, /createAnthropicStructuredBillProvider/); assert.doesNotMatch(retryRoute, /catch \{ ocrProvider = undefined; \}/); assert.match(retryRoute, /billOcrPublicError/); for (const code of ["BILL_OCR_PROVIDER_NOT_CONFIGURED", "BILL_OCR_PROVIDER_CONFIGURATION_INVALID", "BILL_OCR_PROVIDER_AUTH_FAILED", "BILL_OCR_REQUEST_INVALID", "BILL_OCR_BILLING_ERROR", "BILL_OCR_NOT_FOUND", "BILL_OCR_REQUEST_TOO_LARGE", "BILL_OCR_PROVIDER_RATE_LIMITED", "BILL_OCR_PROVIDER_UNAVAILABLE", "BILL_OCR_NETWORK_ERROR", "BILL_OCR_PROVIDER_TIMEOUT", "BILL_OCR_OUTPUT_TRUNCATED", "BILL_OCR_PROVIDER_REFUSAL", "BILL_OCR_RESPONSE_INVALID", "BILL_OCR_PROVIDER_FAILED"]) assert.match(errorsSource, new RegExp(code)); assert.match(panel, /Documenti ricevuti/); assert.match(panel, /Archivio bollette approvate/); assert.match(panel, /Modifica dati/); assert.match(panel, /Approva bolletta/); assert.match(panel, /Usa nella simulazione/); assert.match(panel, /Lettura bolletta in corso/); assert.match(panel, /Lettura da riprovare/); assert.match(panel, /Lettura non riuscita/); assert.match(panel, /analystReview/); assert.match(panel, /CONSUMI/); assert.match(panel, /Consumo totale/); assert.match(panel, /Riprova lettura/); assert.match(panel, /onRetry=\{\(\) => void retry\(bill.id\)\}/); assert.doesNotMatch(panel, /objectKey|ANTHROPIC_API_KEY|Authorization/); assert.match(shell, /prefill=\{simulationPrefill\}/);
  console.log("bill operational flow smoke: ok (EE/GAS mapping, normalized public profile, versioned correction, idempotent approval, approved snapshot, retry, delete and simulation prefill)");
} finally { await rm(root, { recursive: true, force: true }); }
