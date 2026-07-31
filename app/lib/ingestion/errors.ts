export class BillIngestionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "BillIngestionError";
    this.code = code;
  }
}

export const ingestionErrorCode = (error: unknown): string => {
  if (error instanceof BillIngestionError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/.test(error.message)) return error.message;
  return "EXTRACTION_FAILED";
};
