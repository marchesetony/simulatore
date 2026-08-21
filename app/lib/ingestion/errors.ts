export type BillExtractionField =
  | "customerType"
  | "billingPeriod"
  | "consumptionBasis"
  | "voltageLevel"
  | "supplier"
  | "pod"
  | "pdr"
  | "f1"
  | "f2"
  | "f3"
  | "billedConsumption"
  | "smc"
  | "correctionCoefficient";

const billExtractionFields = new Set<BillExtractionField>([
  "customerType", "billingPeriod", "consumptionBasis", "voltageLevel", "supplier", "pod", "pdr",
  "f1", "f2", "f3", "billedConsumption", "smc", "correctionCoefficient",
]);

export class BillIngestionError extends Error {
  readonly code: string;
  readonly field?: BillExtractionField;

  constructor(code: string, field?: BillExtractionField) {
    super(code);
    this.name = "BillIngestionError";
    this.code = code;
    this.field = field;
  }
}

export type BillOcrErrorCode =
  | "BILL_OCR_PROVIDER_NOT_CONFIGURED"
  | "BILL_OCR_PROVIDER_CONFIGURATION_INVALID"
  | "BILL_OCR_PROVIDER_AUTH_FAILED"
  | "BILL_OCR_REQUEST_INVALID"
  | "BILL_OCR_BILLING_ERROR"
  | "BILL_OCR_NOT_FOUND"
  | "BILL_OCR_REQUEST_TOO_LARGE"
  | "BILL_OCR_PROVIDER_RATE_LIMITED"
  | "BILL_OCR_PROVIDER_UNAVAILABLE"
  | "BILL_OCR_NETWORK_ERROR"
  | "BILL_OCR_PROVIDER_TIMEOUT"
  | "BILL_OCR_OUTPUT_TRUNCATED"
  | "BILL_OCR_PROVIDER_REFUSAL"
  | "BILL_OCR_RESPONSE_INVALID"
  | "BILL_OCR_PROVIDER_FAILED";

export type BillPostOcrErrorCode =
  | "BILL_VECTOR_UNKNOWN"
  | "BILL_EXTRACTION_REQUIRED_FIELD_MISSING"
  | "BILL_EXTRACTION_VALUE_INVALID"
  | "BILL_CONTRACT_VALIDATION_FAILED"
  | "BILL_METADATA_INVALID"
  | "BILL_MAPPING_FAILED"
  | "BILL_RETRY_FAILED";

export type BillErrorCode = BillOcrErrorCode | BillPostOcrErrorCode;

const billOcrCodes = new Set<BillOcrErrorCode>([
  "BILL_OCR_PROVIDER_NOT_CONFIGURED",
  "BILL_OCR_PROVIDER_CONFIGURATION_INVALID",
  "BILL_OCR_PROVIDER_AUTH_FAILED",
  "BILL_OCR_REQUEST_INVALID",
  "BILL_OCR_BILLING_ERROR",
  "BILL_OCR_NOT_FOUND",
  "BILL_OCR_REQUEST_TOO_LARGE",
  "BILL_OCR_PROVIDER_RATE_LIMITED",
  "BILL_OCR_PROVIDER_UNAVAILABLE",
  "BILL_OCR_NETWORK_ERROR",
  "BILL_OCR_PROVIDER_TIMEOUT",
  "BILL_OCR_OUTPUT_TRUNCATED",
  "BILL_OCR_PROVIDER_REFUSAL",
  "BILL_OCR_RESPONSE_INVALID",
  "BILL_OCR_PROVIDER_FAILED",
]);

const billPostOcrCodes = new Set<BillPostOcrErrorCode>([
  "BILL_VECTOR_UNKNOWN",
  "BILL_EXTRACTION_REQUIRED_FIELD_MISSING",
  "BILL_EXTRACTION_VALUE_INVALID",
  "BILL_CONTRACT_VALIDATION_FAILED",
  "BILL_METADATA_INVALID",
  "BILL_MAPPING_FAILED",
  "BILL_RETRY_FAILED",
]);

const providerErrorMap: Readonly<Record<string, BillOcrErrorCode>> = {
  OCR_PROVIDER_REQUIRED: "BILL_OCR_PROVIDER_NOT_CONFIGURED",
  CTE_OCR_PROVIDER_NOT_CONFIGURED: "BILL_OCR_PROVIDER_NOT_CONFIGURED",
  ANTHROPIC_API_KEY_MISSING: "BILL_OCR_PROVIDER_CONFIGURATION_INVALID",
  ANTHROPIC_MODEL_MISSING: "BILL_OCR_PROVIDER_CONFIGURATION_INVALID",
  ANTHROPIC_BASE_URL_INVALID: "BILL_OCR_PROVIDER_CONFIGURATION_INVALID",
  ANTHROPIC_CTE_MAX_TOKENS_INVALID: "BILL_OCR_PROVIDER_CONFIGURATION_INVALID",
  ANTHROPIC_BILL_MAX_TOKENS_INVALID: "BILL_OCR_PROVIDER_CONFIGURATION_INVALID",
  CTE_OCR_PROVIDER_AUTH_FAILED: "BILL_OCR_PROVIDER_AUTH_FAILED",
  CTE_OCR_PROVIDER_RATE_LIMITED: "BILL_OCR_PROVIDER_RATE_LIMITED",
  CTE_OCR_PROVIDER_TIMEOUT: "BILL_OCR_PROVIDER_TIMEOUT",
  CTE_OCR_OUTPUT_TRUNCATED: "BILL_OCR_OUTPUT_TRUNCATED",
  CTE_OCR_RESPONSE_INVALID: "BILL_OCR_RESPONSE_INVALID",
  CTE_OCR_TOOL_CALL_MISSING: "BILL_OCR_RESPONSE_INVALID",
  CTE_OCR_TOOL_CALL_MULTIPLE: "BILL_OCR_RESPONSE_INVALID",
  CTE_OCR_TOOL_NAME_MISMATCH: "BILL_OCR_RESPONSE_INVALID",
  CTE_OCR_TOOL_INPUT_MALFORMED: "BILL_OCR_RESPONSE_INVALID",
  CTE_OCR_PROVIDER_RESPONSE_UNKNOWN: "BILL_OCR_RESPONSE_INVALID",
  OCR_RESULT_INVALID: "BILL_OCR_RESPONSE_INVALID",
  CTE_OCR_PROVIDER_FAILED: "BILL_OCR_PROVIDER_FAILED",
};

export function isBillOcrErrorCode(value: unknown): value is BillOcrErrorCode {
  return typeof value === "string" && billOcrCodes.has(value as BillOcrErrorCode);
}

export function isBillErrorCode(value: unknown): value is BillErrorCode {
  return isBillOcrErrorCode(value) || typeof value === "string" && billPostOcrCodes.has(value as BillPostOcrErrorCode);
}

export function billOcrErrorCode(error: unknown): BillOcrErrorCode | null {
  const raw = error instanceof BillIngestionError ? error.code : error instanceof Error ? error.message : null;
  if (!raw) return null;
  if (isBillOcrErrorCode(raw)) return raw;
  return providerErrorMap[raw] ?? null;
}

export function billOcrError(error: unknown): BillIngestionError {
  return new BillIngestionError(billOcrErrorCode(error) ?? "BILL_OCR_PROVIDER_FAILED");
}

export function billErrorCode(error: unknown): BillErrorCode {
  const ocrCode = billOcrErrorCode(error);
  if (ocrCode) return ocrCode;
  const raw = error instanceof BillIngestionError ? error.code : error instanceof Error ? error.message : null;
  if (raw?.startsWith("BILL_WIRE_VALIDATION_FAILED")) return "BILL_OCR_RESPONSE_INVALID";
  if (raw?.startsWith("BILL_STRUCTURED_")) return "BILL_EXTRACTION_VALUE_INVALID";
  switch (raw) {
    case "BILL_VECTOR_UNKNOWN": return "BILL_VECTOR_UNKNOWN";
    case "EXTRACTION_REQUIRED_FIELD_MISSING": return "BILL_EXTRACTION_REQUIRED_FIELD_MISSING";
    case "EXTRACTION_VALUE_INVALID": return "BILL_EXTRACTION_VALUE_INVALID";
    case "EXTRACTION_METADATA_INVALID":
    case "METADATA_INVALID": return "BILL_METADATA_INVALID";
    case "BILL_MAPPING_FAILED": return "BILL_MAPPING_FAILED";
    case "BILL_RETRY_FAILED": return "BILL_RETRY_FAILED";
    default:
      return error instanceof Error && error.name === "EnergyContractValidationError"
        ? "BILL_CONTRACT_VALIDATION_FAILED"
        : "BILL_MAPPING_FAILED";
  }
}

export function billErrorField(error: unknown): BillExtractionField | undefined {
  if (!(error instanceof BillIngestionError) || !error.field || !billExtractionFields.has(error.field)) return undefined;
  return error.field;
}

export function billOcrHttpStatus(code: string): number {
  if (code === "BILL_OCR_PROVIDER_RATE_LIMITED") return 503;
  if (["BILL_OCR_PROVIDER_TIMEOUT", "BILL_OCR_RESPONSE_INVALID", "BILL_OCR_OUTPUT_TRUNCATED", "BILL_OCR_PROVIDER_REFUSAL", "BILL_OCR_PROVIDER_FAILED", "BILL_OCR_REQUEST_INVALID", "BILL_OCR_BILLING_ERROR", "BILL_OCR_NOT_FOUND", "BILL_OCR_REQUEST_TOO_LARGE", "BILL_OCR_PROVIDER_UNAVAILABLE", "BILL_OCR_NETWORK_ERROR"].includes(code)) return 502;
  return 503;
}

export function billOcrUserMessage(code: string): string {
  switch (code) {
    case "BILL_OCR_PROVIDER_NOT_CONFIGURED": return "Servizio di lettura non disponibile. Riprovare più tardi.";
    case "BILL_OCR_PROVIDER_CONFIGURATION_INVALID": return "Servizio di lettura non configurato correttamente.";
    case "BILL_OCR_PROVIDER_AUTH_FAILED": return "Servizio di lettura non disponibile. Riprovare più tardi.";
    case "BILL_OCR_PROVIDER_RATE_LIMITED": return "Servizio di lettura temporaneamente occupato. Riprovare più tardi.";
    case "BILL_OCR_REQUEST_INVALID": return "Il servizio di lettura ha rifiutato la richiesta.";
    case "BILL_OCR_BILLING_ERROR": return "Il servizio di lettura non è disponibile per un problema di credito o fatturazione.";
    case "BILL_OCR_NOT_FOUND": return "Il servizio di lettura configurato non è disponibile.";
    case "BILL_OCR_REQUEST_TOO_LARGE": return "Il documento supera i limiti del servizio di lettura.";
    case "BILL_OCR_PROVIDER_UNAVAILABLE": return "Il servizio di lettura è temporaneamente non disponibile.";
    case "BILL_OCR_NETWORK_ERROR": return "Non è stato possibile raggiungere il servizio di lettura.";
    case "BILL_OCR_PROVIDER_TIMEOUT": return "La lettura del documento ha impiegato troppo tempo. Riprova.";
    case "BILL_OCR_OUTPUT_TRUNCATED": return "La lettura del documento non è stata completata. Riprova.";
    case "BILL_OCR_PROVIDER_REFUSAL": return "Il servizio di lettura ha rifiutato l'estrazione del documento.";
    case "BILL_OCR_RESPONSE_INVALID": return "La risposta del servizio di lettura non è utilizzabile. Riprova.";
    case "BILL_OCR_PROVIDER_FAILED": return "Il servizio di lettura non è riuscito a elaborare il documento. Riprova.";
    default: return "Errore del servizio di lettura.";
  }
}

export function billOcrPublicError(code: string): { readonly code: BillOcrErrorCode; readonly message: string; readonly status: number } | null {
  if (!isBillOcrErrorCode(code)) return null;
  return { code, message: billOcrUserMessage(code), status: billOcrHttpStatus(code) };
}

export function billErrorHttpStatus(code: string): number {
  return isBillOcrErrorCode(code) ? billOcrHttpStatus(code) : 422;
}

export function billErrorUserMessage(code: string): string {
  switch (code) {
    case "BILL_VECTOR_UNKNOWN": return "Il vettore della bolletta non è stato riconosciuto.";
    case "BILL_EXTRACTION_REQUIRED_FIELD_MISSING": return "Mancano dati obbligatori nella bolletta.";
    case "BILL_EXTRACTION_VALUE_INVALID": return "Un dato estratto dalla bolletta non è valido.";
    case "BILL_CONTRACT_VALIDATION_FAILED": return "I dati estratti dalla bolletta non superano la validazione.";
    case "BILL_METADATA_INVALID": return "I metadati della bolletta non sono validi.";
    case "BILL_MAPPING_FAILED": return "I dati della bolletta non sono interpretabili.";
    case "BILL_RETRY_FAILED": return "La rielaborazione della bolletta non è disponibile.";
    default: return billOcrUserMessage(code);
  }
}

export function billPublicError(code: string): { readonly code: BillErrorCode; readonly message: string; readonly status: number } | null {
  if (!isBillErrorCode(code)) return null;
  return { code, message: isBillOcrErrorCode(code) ? billOcrUserMessage(code) : billErrorUserMessage(code), status: billErrorHttpStatus(code) };
}

export const ingestionErrorCode = (error: unknown): string => {
  if (error instanceof BillIngestionError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/.test(error.message)) return error.message;
  return "EXTRACTION_FAILED";
};
