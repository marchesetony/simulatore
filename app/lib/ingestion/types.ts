import type { BillDocument, ExtractionStatus } from "../foundation/real-bill.ts";
import type { BillContract, EnergyVector } from "../energy/types.ts";

export type BillClassificationVector = EnergyVector | "UNKNOWN";

export interface BillClassification {
  readonly vector: BillClassificationVector;
  readonly evidence: readonly string[];
}

export interface OcrInput {
  readonly bytes: Uint8Array;
  readonly contentType: "application/pdf";
}

export interface OcrTextResult {
  readonly text: string;
  readonly pages: number;
}

/** Provider-neutral seam. Vendor configuration and credentials stay outside this module. */
export interface OcrProvider {
  extract(input: OcrInput): Promise<OcrTextResult>;
}

export interface EnergyBillIngestionResult {
  readonly status: ExtractionStatus;
  readonly classification: BillClassification;
  readonly document: BillDocument;
  readonly contract: BillContract | null;
  readonly errorCode: string | null;
}
