import { AuthenticationError } from "../auth/errors";

export const CTE_INGESTION_CORRELATION_ID = "cte-ocr-ingestion-v1";
export const CTE_INGESTION_HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };

const publicCodes = new Set([
  "AUTH_CONFIGURATION_INVALID", "AUTH_ADAPTER_UNAVAILABLE", "AUTH_AUDIT_UNAVAILABLE", "AUTHENTICATION_REQUIRED", "AUTHENTICATION_EXPIRED", "AUTHENTICATION_INVALID", "AUTHORIZATION_DENIED", "TENANT_MISMATCH", "ROLE_INSUFFICIENT",
  "CTE_FILE_REQUIRED", "CTE_FILE_TYPE_UNSUPPORTED", "CTE_FILE_TOO_LARGE", "CTE_FILE_SIGNATURE_INVALID", "CTE_FILE_NAME_INVALID", "CTE_OCR_PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY_MISSING", "ANTHROPIC_MODEL_MISSING", "ANTHROPIC_CTE_MAX_TOKENS_INVALID", "CTE_OCR_PROVIDER_AUTH_FAILED", "CTE_OCR_PROVIDER_RATE_LIMITED", "CTE_OCR_PROVIDER_TIMEOUT", "CTE_OCR_PROVIDER_FAILED", "CTE_OCR_RESPONSE_INVALID", "CTE_OCR_TOOL_USE_MISSING", "CTE_OCR_TOOL_NAME_MISMATCH", "CTE_OCR_TOOL_CALL_MULTIPLE", "CTE_OCR_TOOL_INPUT_MALFORMED", "CTE_OCR_OUTPUT_TRUNCATED", "CTE_OCR_PROVIDER_REFUSAL", "CTE_OCR_PROVIDER_RESPONSE_UNKNOWN", "CTE_OCR_NO_USABLE_EVIDENCE", "CTE_EXTRACTION_SCHEMA_INVALID", "CTE_EXTRACTION_CONTRACT_INVALID", "CTE_EXTRACTION_FINAL_DOMAIN_EARLY", "CTE_VECTOR_FIELD_MIXED", "CTE_VECTOR_MISMATCH", "CTE_APPROVAL_BLOCKED", "CTE_INGESTION_NOT_FOUND", "CTE_ORIGINAL_DOCUMENT_UNAVAILABLE", "CTE_OCR_RETRY_IN_PROGRESS", "CTE_RETRY_STATE_INVALID", "CTE_CORRECTION_FIELD_UNSUPPORTED", "CTE_CORRECTION_VALUE_INVALID", "CTE_REVIEW_CANDIDATE_UNAVAILABLE", "CTE_REVIEW_REQUIRED", "CTE_ARCHIVE_ALREADY_EXISTS", "CTE_VERSION_STALE", "PERSISTENCE_VERSION_CONFLICT", "PERSISTENCE_RECORD_NOT_FOUND", "CTE_INGESTION_APPROVED_IMMUTABLE",
]);

export function boundedCteCode(error: unknown, fallback = "CTE_INGESTION_FAILED"): string {
  const candidate = error instanceof AuthenticationError ? error.code : error instanceof Error ? error.message : "";
  return publicCodes.has(candidate) ? candidate : fallback;
}

export function cteStatus(code: string): number {
  if (["AUTHENTICATION_REQUIRED", "AUTHENTICATION_EXPIRED", "AUTHENTICATION_INVALID"].includes(code)) return 401;
  if (["AUTHORIZATION_DENIED", "TENANT_MISMATCH", "ROLE_INSUFFICIENT"].includes(code)) return 403;
  if (["AUTH_CONFIGURATION_INVALID", "AUTH_ADAPTER_UNAVAILABLE", "AUTH_AUDIT_UNAVAILABLE", "CTE_OCR_PROVIDER_AUTH_FAILED", "CTE_OCR_PROVIDER_RATE_LIMITED", "CTE_OCR_PROVIDER_TIMEOUT", "CTE_OCR_PROVIDER_FAILED", "CTE_OCR_OUTPUT_TRUNCATED", "CTE_INGESTION_FAILED"].includes(code)) return 503;
  if (["CTE_OCR_PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY_MISSING", "ANTHROPIC_MODEL_MISSING", "ANTHROPIC_CTE_MAX_TOKENS_INVALID"].includes(code)) return 422;
  if (code === "CTE_INGESTION_NOT_FOUND" || code === "PERSISTENCE_RECORD_NOT_FOUND") return 404;
  if (code === "CTE_OCR_RETRY_IN_PROGRESS" || code === "CTE_INGESTION_APPROVED_IMMUTABLE") return 409;
  if (code === "CTE_REVIEW_REQUIRED" || code === "CTE_REVIEW_CANDIDATE_UNAVAILABLE" || code === "CTE_APPROVAL_BLOCKED") return 409;
  return 400;
}

export function cteMessage(code: string): string {
  if (code === "CTE_OCR_PROVIDER_NOT_CONFIGURED") return "Provider Anthropic non configurato: nessun dato è stato estratto.";
  if (code === "ANTHROPIC_API_KEY_MISSING") return "Configurazione Anthropic incompleta: chiave server mancante.";
  if (code === "ANTHROPIC_MODEL_MISSING") return "Configurazione Anthropic incompleta: modello server mancante.";
  if (code === "CTE_OCR_PROVIDER_AUTH_FAILED") return "Autenticazione del provider Anthropic non riuscita.";
  if (code === "CTE_OCR_PROVIDER_RATE_LIMITED") return "Provider Anthropic temporaneamente limitato; riprovare più tardi.";
  if (code === "CTE_OCR_PROVIDER_TIMEOUT") return "Il provider Anthropic non ha risposto in tempo.";
  if (code === "CTE_OCR_RESPONSE_INVALID") return "Risposta del provider Anthropic non valida.";
  if (code === "CTE_OCR_TOOL_USE_MISSING") return "Il provider Anthropic non ha restituito l'estrazione richiesta.";
  if (code === "CTE_OCR_OUTPUT_TRUNCATED") return "La risposta Anthropic è stata troncata prima di completare l'estrazione.";
  if (code === "CTE_OCR_PROVIDER_REFUSAL") return "Il provider Anthropic ha rifiutato l'estrazione.";
  if (code === "CTE_OCR_NO_USABLE_EVIDENCE") return "Il documento non contiene evidenza estraibile sufficiente.";
  if (code === "CTE_APPROVAL_BLOCKED") return "Approvazione non disponibile: completare i campi obbligatori e la revisione.";
  if (code === "CTE_ORIGINAL_DOCUMENT_UNAVAILABLE") return "Il documento originale non è più disponibile per l'analisi.";
  if (code === "CTE_OCR_RETRY_IN_PROGRESS") return "L'analisi del documento è già in corso.";
  if (code === "CTE_RETRY_STATE_INVALID") return "Il documento non è in uno stato riprovabile.";
  switch (code) {
    case "CTE_FILE_REQUIRED": return "Selezionare un documento CTE.";
    case "CTE_FILE_TYPE_UNSUPPORTED": return "Formato non supportato. Usare PDF, JPG, JPEG o PNG.";
    case "CTE_FILE_TOO_LARGE": return "Il documento supera la dimensione massima consentita.";
    case "CTE_FILE_SIGNATURE_INVALID": return "Il contenuto del documento non corrisponde al formato dichiarato.";
    case "CTE_OCR_PROVIDER_NOT_CONFIGURED": return "Provider OCR/AI non configurato: nessun dato è stato estratto.";
    case "CTE_EXTRACTION_SCHEMA_INVALID": return "Risposta di estrazione non valida.";
    case "CTE_OCR_TOOL_NAME_MISMATCH": return "Il provider Anthropic ha restituito uno strumento inatteso.";
    case "CTE_OCR_TOOL_CALL_MULTIPLE": return "Il provider Anthropic ha restituito più estrazioni concorrenti.";
    case "CTE_OCR_TOOL_INPUT_MALFORMED": return "L'input strutturato del provider Anthropic non è valido.";
    case "CTE_OCR_TOOL_USE_MISSING": return "Il provider Anthropic non ha restituito la tool call richiesta.";
    case "CTE_OCR_PROVIDER_RESPONSE_UNKNOWN": return "Il provider Anthropic ha restituito una risposta non riconosciuta.";
    case "ANTHROPIC_CTE_MAX_TOKENS_INVALID": return "Configurazione server Anthropic non valida.";
    case "CTE_EXTRACTION_FINAL_DOMAIN_EARLY": return "L'estrazione non può essere validata come contratto prima della revisione.";
    case "CTE_REVIEW_REQUIRED": return "Completare la revisione prima dell'approvazione.";
    case "CTE_REVIEW_CANDIDATE_UNAVAILABLE": return "La correzione non è disponibile senza un candidato estratto.";
    case "CTE_INGESTION_NOT_FOUND": return "Processo di ingestione non trovato.";
    case "CTE_INGESTION_APPROVED_IMMUTABLE": return "Una CTE approvata non può essere modificata o cancellata.";
    case "CTE_ARCHIVE_ALREADY_EXISTS": return "Il contratto è già presente nell'archivio.";
    default: return "Ingestione CTE non disponibile.";
  }
}

export function cteError(error: unknown, fallback = "CTE_INGESTION_FAILED"): Response {
  const code = boundedCteCode(error, fallback);
  return Response.json({ error: { code, message: cteMessage(code), correlationId: CTE_INGESTION_CORRELATION_ID } }, { status: cteStatus(code), headers: CTE_INGESTION_HEADERS });
}
