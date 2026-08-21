// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertLocalBillAccess, EmbeddedPdfTextExtractor, ingestBill, LocalBillRepository, LocalDocumentStorage, retryBill, type AuditSink, type BillRepository, type DocumentStoragePort, type TextExtractionPort, validateBillDocument, validatePdf } from "../foundation/real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { classifyBillText } from "./classifier.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { mapTextToEnergyBill } from "./mapping.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billErrorCode, billOcrError, BillIngestionError } from "./errors.ts";
import type { BillErrorCode } from "./errors.ts";
import type { EnergyBillIngestionResult, OcrProvider } from "./types.ts";
import type { BillClassification } from "./types.ts";
import type { BillExtractionProvider } from "./anthropic-bill-sdk";
import type { EnergyContractMapper, EnergyContractMapperInput } from "../foundation/real-bill";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveBillVectorFromEvidence } from "./vector-resolution.ts";

const unknownClassification: BillClassification = { vector: "UNKNOWN", evidence: [] };

function structuredProviderWithClassification(provider: BillExtractionProvider, onVector: (vector: "EE" | "GAS") => void): BillExtractionProvider {
  return { async extract(input) { const extraction = await provider.extract(input); const resolved = resolveBillVectorFromEvidence(extraction); if (resolved.vector !== "UNKNOWN") onVector(resolved.vector); return extraction; } };
}

function hybridExtractor(ocrProvider: OcrProvider | undefined, ocrProviderFactory: (() => OcrProvider) | undefined, onSource: (source: "embedded-text" | "ocr") => void): TextExtractionPort {
  const embedded = new EmbeddedPdfTextExtractor();
  return {
    async extract(bytes) {
      try {
        const result = await embedded.extract(bytes);
        onSource("embedded-text");
        return result;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "OCR_PROVIDER_REQUIRED") throw error;
        let provider = ocrProvider;
        if (!provider) {
          if (!ocrProviderFactory) throw new BillIngestionError("BILL_OCR_PROVIDER_NOT_CONFIGURED");
          try { provider = ocrProviderFactory(); } catch (providerError) { throw billOcrError(providerError); }
        }
        let result: Awaited<ReturnType<OcrProvider["extract"]>>;
        try { result = await provider.extract({ bytes, contentType: "application/pdf" }); } catch (providerError) { throw billOcrError(providerError); }
        if (!result || typeof result.text !== "string" || result.text.trim().length === 0 || !Number.isInteger(result.pages) || result.pages < 1) {
          throw new BillIngestionError("BILL_OCR_RESPONSE_INVALID");
        }
        onSource("ocr");
        return result;
      }
    },
  };
}

export async function ingestEnergyBill(input: {
  readonly tenantId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly documentsRoot?: string;
  readonly storage?: DocumentStoragePort;
  readonly repository?: BillRepository;
  readonly authenticated?: boolean;
  readonly ocrProvider?: OcrProvider;
  readonly ocrProviderFactory?: () => OcrProvider;
  readonly structuredProvider?: BillExtractionProvider;
  readonly structuredProviderFactory?: () => BillExtractionProvider;
  readonly localDev?: string;
  readonly audit?: AuditSink;
}): Promise<EnergyBillIngestionResult> {
  const tenantId = input.authenticated ? (/^tenant_[a-z0-9-]+$/.test(input.tenantId) ? input.tenantId : (() => { throw new Error("TENANT_ACCESS_DENIED"); })()) : assertLocalBillAccess(input.tenantId, input.localDev ?? process.env.FOUNDATION_LOCAL_DEV);
  const safeName = input.structuredProvider || input.structuredProviderFactory ? validateBillDocument(input.fileName, input.contentType, input.bytes, input.maxBytes) : validatePdf(input.fileName, input.contentType, input.bytes, input.maxBytes);
  let classification: BillClassification = unknownClassification;
  let mappingError: BillErrorCode | null = null;
  let extractionErrorCode: BillErrorCode | null = null;
  let extractionSource: "embedded-text" | "ocr" = "embedded-text";
  const structuredProvider = input.structuredProvider
    ? structuredProviderWithClassification(input.structuredProvider, (vector) => { classification = { vector, evidence: [] }; })
    : input.structuredProviderFactory
      ? structuredProviderWithClassification(input.structuredProviderFactory(), (vector) => { classification = { vector, evidence: [] }; })
      : undefined;
  const document = await ingestBill({
    tenantId,
    fileName: safeName,
    contentType: input.contentType,
    bytes: input.bytes,
    maxBytes: input.maxBytes,
    storage: input.storage ?? new LocalDocumentStorage(input.documentsRoot),
    ...(structuredProvider ? { structuredExtractor: structuredProvider } : { extractor: hybridExtractor(input.ocrProvider, input.ocrProviderFactory, (source) => { extractionSource = source; }) }),
    repository: input.repository ?? new LocalBillRepository(input.documentsRoot),
    audit: input.audit ?? { async record() {} },
    onExtractionError: (error) => { extractionErrorCode = billErrorCode(error); return extractionErrorCode; },
    ...(structuredProvider ? {} : { mapEnergyContract: ((mapperInput: EnergyContractMapperInput) => {
      try {
        classification = classifyBillText(mapperInput.text);
        const mapped = mapTextToEnergyBill({ ...mapperInput, billId: mapperInput.documentId, extractionSource });
        classification = mapped.classification;
        return mapped.contract;
      } catch (error) {
        mappingError = billErrorCode(error);
        throw error;
      }
    }) as EnergyContractMapper }),
  });
  const version = document.versions.find((candidate) => candidate.versionId === document.currentVersionId);
  const contract = version?.energyContract ?? null;
  const errorCode = version?.errorCode ?? extractionErrorCode ?? mappingError ?? (document.versions[0].status === "OCR_PROVIDER_REQUIRED" ? "BILL_OCR_PROVIDER_NOT_CONFIGURED" : document.versions[0].status === "FAILED" ? "BILL_MAPPING_FAILED" : null);
  return {
    status: document.versions[0].status,
    classification,
    document,
    contract,
    errorCode,
  };
}

export async function retryEnergyBill(input: {
  readonly tenantId: string;
  readonly document: import("../foundation/real-bill.ts").BillDocument;
  readonly storage: DocumentStoragePort;
  readonly repository: BillRepository;
  readonly authenticated?: boolean;
  readonly ocrProvider?: OcrProvider;
  readonly ocrProviderFactory?: () => OcrProvider;
  readonly structuredProvider?: BillExtractionProvider;
  readonly structuredProviderFactory?: () => BillExtractionProvider;
  readonly localDev?: string;
  readonly audit?: AuditSink;
}): Promise<EnergyBillIngestionResult> {
  const tenantId = input.authenticated ? (/^tenant_[a-z0-9-]+$/.test(input.tenantId) ? input.tenantId : (() => { throw new Error("TENANT_ACCESS_DENIED"); })()) : assertLocalBillAccess(input.tenantId, input.localDev ?? process.env.FOUNDATION_LOCAL_DEV);
  let classification: BillClassification = unknownClassification;
  let mappingError: BillErrorCode | null = null;
  let extractionErrorCode: BillErrorCode | null = null;
  let extractionSource: "embedded-text" | "ocr" = "embedded-text";
  const structuredProvider = input.structuredProvider
    ? structuredProviderWithClassification(input.structuredProvider, (vector) => { classification = { vector, evidence: [] }; })
    : input.structuredProviderFactory
      ? structuredProviderWithClassification(input.structuredProviderFactory(), (vector) => { classification = { vector, evidence: [] }; })
      : undefined;
  let provider = input.ocrProvider;
  if (!provider && !structuredProvider) {
    if (!input.ocrProviderFactory) throw new BillIngestionError("BILL_OCR_PROVIDER_NOT_CONFIGURED");
    try { provider = input.ocrProviderFactory(); } catch (error) { throw billOcrError(error); }
  }
  const document = await retryBill({
    document: input.document,
    tenantId,
    storage: input.storage,
    repository: input.repository,
    ...(structuredProvider ? { structuredExtractor: structuredProvider } : { extractor: hybridExtractor(provider, undefined, (source) => { extractionSource = source; }) }),
    audit: input.audit ?? { async record() {} },
    onExtractionError: (error) => { extractionErrorCode = billErrorCode(error); return extractionErrorCode; },
    ...(structuredProvider ? {} : { mapEnergyContract: ((mapperInput: EnergyContractMapperInput) => {
      try {
        classification = classifyBillText(mapperInput.text);
        const mapped = mapTextToEnergyBill({ ...mapperInput, billId: mapperInput.documentId, extractionSource });
        classification = mapped.classification;
        return mapped.contract;
      } catch (error) {
        mappingError = billErrorCode(error);
        throw error;
      }
    }) as EnergyContractMapper }),
  });
  const version = document.versions.find((candidate) => candidate.versionId === document.currentVersionId);
  const contract = version?.energyContract ?? null;
  const errorCode = version?.errorCode ?? extractionErrorCode ?? mappingError ?? (version?.status === "OCR_PROVIDER_REQUIRED" ? "BILL_OCR_PROVIDER_NOT_CONFIGURED" : version?.status === "FAILED" ? "BILL_MAPPING_FAILED" : null);
  return { status: version?.status ?? "FAILED", classification, document, contract, errorCode };
}

// @ts-expect-error Node's strip-only test runner requires the explicit extension.
export { classifyBillText } from "./classifier.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
export { mapTextToEnergyBill } from "./mapping.ts";
export type { OcrProvider, OcrInput, OcrTextResult, EnergyBillIngestionResult, BillClassification } from "./types";
