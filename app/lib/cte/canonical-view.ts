import type { CteApprovedArchiveDetailModel, CteIngestionModel, CteReviewFieldModel, CteReviewSourceModel } from "../ui/models";

export type CteCanonicalMode = "review" | "approved";

export interface CteCanonicalViewModel {
  readonly mode: CteCanonicalMode;
  readonly status: string;
  readonly documentType: "CTE" | "UNKNOWN";
  readonly vector: "EE" | "GAS" | "UNKNOWN";
  readonly currency: string | null;
  readonly title: string;
  readonly detailName: string;
  readonly size: number | null;
  readonly reviewFields: readonly CteReviewFieldModel[];
  readonly notFoundFields: readonly CteReviewFieldModel[];
  readonly sources: readonly CteReviewSourceModel[];
  readonly errorCode: string | null;
  readonly unavailable: boolean;
  readonly processing: boolean;
  readonly retryable: boolean;
  readonly commercialStatus?: "ACTIVE" | "BLOCKED";
  readonly blockReason?: string | null;
}

export function canonicalCteReviewView(ingestion: CteIngestionModel): CteCanonicalViewModel {
  const approved = ingestion.status === "APPROVED";
  return {
    mode: approved ? "approved" : "review",
    status: ingestion.status,
    documentType: ingestion.documentType,
    vector: ingestion.vector,
    currency: ingestion.currency,
    title: "Revisione estrazione",
    detailName: ingestion.fileName,
    size: ingestion.size,
    reviewFields: ingestion.reviewFields,
    notFoundFields: ingestion.notFoundFields,
    sources: ingestion.sources,
    errorCode: ingestion.errorCode,
    unavailable: ingestion.status === "PROVIDER_NOT_CONFIGURED",
    processing: ingestion.status === "OCR_PROCESSING" || ingestion.status === "EXTRACTION_PROCESSING",
    retryable: ingestion.status === "FAILED" || ingestion.status === "PROVIDER_NOT_CONFIGURED",
  };
}

export function canonicalCteApprovedView(detail: CteApprovedArchiveDetailModel): CteCanonicalViewModel {
  const contract = detail.contract;
  return {
    mode: "approved",
    status: "APPROVED",
    documentType: contract.documentType ?? "CTE",
    vector: contract.vector,
    currency: contract.currency,
    title: "Revisione estrazione",
    detailName: contract.offer.name,
    size: contract.documentSize ?? null,
    reviewFields: contract.reviewFields ?? [],
    notFoundFields: contract.notFoundFields ?? [],
    sources: contract.sources ?? [],
    errorCode: null,
    unavailable: false,
    processing: false,
    retryable: false,
    commercialStatus: detail.commercialStatus,
    blockReason: detail.blockReason,
  };
}

export function canonicalCteData(model: CteCanonicalViewModel): Record<string, unknown> {
  return { documentType: model.documentType, vector: model.vector, currency: model.currency, reviewFields: model.reviewFields, notFoundFields: model.notFoundFields, sources: model.sources };
}
