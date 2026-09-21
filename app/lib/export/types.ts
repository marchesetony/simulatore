import type { ProposalCanonicalSnapshot, ProposalExportFormat } from "../proposal/types";

export interface ProposalExportDocument {
  readonly format: ProposalExportFormat;
  readonly contentType: string;
  readonly filename: string;
  readonly body: string | Uint8Array;
}

export type ProposalExportInput = ProposalCanonicalSnapshot;
