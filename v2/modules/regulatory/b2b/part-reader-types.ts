import type { ZipPreflightResult } from "./preflight-types";

export interface BoundedPartRequest {
  readonly archive: Uint8Array;
  readonly preflight: ZipPreflightResult;
  readonly partName: string;
  readonly maxBytes?: number;
}

export interface BoundedPartResult {
  readonly partName: string;
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly archiveSha256: string;
  readonly preflightVersion: string;
}
