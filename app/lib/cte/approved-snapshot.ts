import type { CteContract } from "./types";
import type { CteCorrection, CteExtractionField, CteIngestionRecord } from "./ingestion";
import type { CteReviewField, CteReviewSource } from "./review";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { normalizeCteReview } from "./review.ts";

export const CTE_APPROVED_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface CteApprovedSnapshot {
  readonly schemaVersion: typeof CTE_APPROVED_SNAPSHOT_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly approvedAt: string;
  readonly approvedVersion: string;
  readonly vector: "EE" | "GAS";
  readonly documentType: "CTE" | "UNKNOWN";
  readonly documentSize: number;
  readonly currency: string | null;
  readonly fields: readonly CteExtractionField[];
  readonly reviewFields: readonly CteReviewField[];
  readonly notFoundFields: readonly CteReviewField[];
  readonly sources: readonly CteReviewSource[];
  readonly corrections: readonly CteCorrection[];
  readonly contract: CteContract;
}

export function createCteApprovedSnapshot(input: { readonly record: CteIngestionRecord; readonly tenantId: string; readonly approvedAt: string; readonly approvedVersion: string; readonly contract: CteContract }): CteApprovedSnapshot {
  const review = normalizeCteReview(input.record);
  if (input.record.vector !== "EE" && input.record.vector !== "GAS") throw new Error("CTE_VECTOR_MISMATCH");
  return structuredClone({
    schemaVersion: CTE_APPROVED_SNAPSHOT_SCHEMA_VERSION,
    tenantId: input.tenantId,
    approvedAt: input.approvedAt,
    approvedVersion: input.approvedVersion,
    vector: input.record.vector,
    documentType: input.record.documentType,
    documentSize: input.record.size,
    currency: review.currency,
    fields: input.record.fields,
    reviewFields: review.commercialFields,
    notFoundFields: review.notFoundFields,
    sources: review.sources,
    corrections: input.record.corrections,
    contract: input.contract,
  });
}

export function legacyCteApprovedSnapshot(input: { readonly record: CteIngestionRecord; readonly tenantId: string; readonly contract: CteContract }): CteApprovedSnapshot {
  const approval = input.contract.approval as unknown as Record<string, unknown>;
  return createCteApprovedSnapshot({ record: input.record, tenantId: input.tenantId, approvedAt: typeof approval.reviewedAt === "string" ? approval.reviewedAt : new Date(0).toISOString(), approvedVersion: input.contract.version, contract: input.contract });
}
