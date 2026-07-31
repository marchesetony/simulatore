// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertLocalBillAccess, EmbeddedPdfTextExtractor, ingestBill, LocalBillRepository, LocalDocumentStorage, type AuditSink, type TextExtractionPort, validatePdf } from "../foundation/real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { classifyBillText } from "./classifier.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { mapTextToEnergyBill } from "./mapping.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ingestionErrorCode } from "./errors.ts";
import type { EnergyBillIngestionResult, OcrProvider } from "./types.ts";
import type { BillClassification } from "./types.ts";

const unknownClassification: BillClassification = { vector: "UNKNOWN", evidence: [] };

function hybridExtractor(ocrProvider: OcrProvider | undefined, onSource: (source: "embedded-text" | "ocr") => void): TextExtractionPort {
  const embedded = new EmbeddedPdfTextExtractor();
  return {
    async extract(bytes) {
      try {
        const result = await embedded.extract(bytes);
        onSource("embedded-text");
        return result;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "OCR_PROVIDER_REQUIRED" || !ocrProvider) throw error;
        const result = await ocrProvider.extract({ bytes, contentType: "application/pdf" });
        if (!result || typeof result.text !== "string" || result.text.trim().length === 0 || !Number.isInteger(result.pages) || result.pages < 1) {
          throw new Error("OCR_RESULT_INVALID");
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
  readonly ocrProvider?: OcrProvider;
  readonly localDev?: string;
  readonly audit?: AuditSink;
}): Promise<EnergyBillIngestionResult> {
  const tenantId = assertLocalBillAccess(input.tenantId, input.localDev ?? process.env.FOUNDATION_LOCAL_DEV);
  const safeName = validatePdf(input.fileName, input.contentType, input.bytes, input.maxBytes);
  let classification: BillClassification = unknownClassification;
  let mappingError: string | null = null;
  let extractionSource: "embedded-text" | "ocr" = "embedded-text";
  const document = await ingestBill({
    tenantId,
    fileName: safeName,
    contentType: input.contentType,
    bytes: input.bytes,
    maxBytes: input.maxBytes,
    storage: new LocalDocumentStorage(input.documentsRoot),
    extractor: hybridExtractor(input.ocrProvider, (source) => { extractionSource = source; }),
    repository: new LocalBillRepository(input.documentsRoot),
    audit: input.audit ?? { async record() {} },
    mapEnergyContract: (mapperInput) => {
      try {
        classification = classifyBillText(mapperInput.text);
        const mapped = mapTextToEnergyBill({ ...mapperInput, billId: mapperInput.documentId, extractionSource });
        classification = mapped.classification;
        return mapped.contract;
      } catch (error) {
        mappingError = ingestionErrorCode(error);
        throw error;
      }
    },
  });
  const version = document.versions.find((candidate) => candidate.versionId === document.currentVersionId);
  const contract = version?.energyContract ?? null;
  const errorCode = document.versions[0].status === "OCR_PROVIDER_REQUIRED"
    ? "OCR_PROVIDER_REQUIRED"
    : mappingError ?? (document.versions[0].status === "FAILED" ? "EXTRACTION_FAILED" : null);
  return {
    status: document.versions[0].status,
    classification,
    document,
    contract,
    errorCode,
  };
}

// @ts-expect-error Node's strip-only test runner requires the explicit extension.
export { classifyBillText } from "./classifier.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
export { mapTextToEnergyBill } from "./mapping.ts";
export type { OcrProvider, OcrInput, OcrTextResult, EnergyBillIngestionResult, BillClassification } from "./types";
