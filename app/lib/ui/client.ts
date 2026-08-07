export interface ApiErrorData {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly correlationId?: unknown;
}

export class UiApiError extends Error {
  readonly code: string;
  readonly correlationId: string | null;

  constructor(code: string, message: string, correlationId: string | null = null) {
    super(message);
    this.name = "UiApiError";
    this.code = code;
    this.correlationId = correlationId;
  }
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,80}$/;
const SAFE_CORRELATION = /^[A-Za-z0-9._:-]{1,80}$/;
const messages: Readonly<Record<string, string>> = {
  AUTH_CONFIGURATION_INVALID: "La configurazione non consente l'accesso operativo",
  AUTH_ADAPTER_UNAVAILABLE: "Autenticazione non disponibile",
  AUTH_AUDIT_UNAVAILABLE: "Autenticazione non disponibile",
  AUTHENTICATION_REQUIRED: "Autenticazione richiesta",
  AUTHENTICATION_EXPIRED: "Sessione non più valida",
  AUTHENTICATION_INVALID: "Sessione non valida",
  AUTHORIZATION_DENIED: "Operazione non autorizzata",
  TENANT_MISMATCH: "Contesto tenant non valido",
  ROLE_INSUFFICIENT: "Ruolo non abilitato per questa operazione",
  DOCUMENT_NOT_FOUND: "Documento non trovato",
  BILL_LIST_UNAVAILABLE: "Elenco bollette non disponibile",
  BILL_LIST_TOO_LARGE: "Elenco bollette temporaneamente non disponibile",
  BILL_OPERATION_INVALID: "Operazione bolletta non valida",
  APPROVAL_REQUIRED_FIELDS_MISSING: "Mancano campi obbligatori per l'approvazione",
  APPROVAL_FIELDS_UNCONFIRMED: "Confermare i campi richiesti prima dell'approvazione",
  CORRECTION_INVALID: "Correzione non valida",
  DOCUMENT_VERSION_STALE: "La versione del documento non è più aggiornata",
  DOCUMENT_VERSION_NOT_CURRENT: "La versione selezionata non è corrente",
  DOCUMENT_VERSION_ALREADY_APPROVED: "La versione è già approvata",
  DOCUMENT_NO_CHANGES: "La correzione non contiene modifiche",
  METADATA_INVALID: "Metadati documento non validi",
  CTE_OCR_PROVIDER_NOT_CONFIGURED: "Provider Anthropic non configurato",
  ANTHROPIC_API_KEY_MISSING: "Configurazione Anthropic incompleta: chiave server mancante",
  ANTHROPIC_MODEL_MISSING: "Configurazione Anthropic incompleta: modello server mancante",
  ANTHROPIC_CTE_MAX_TOKENS_INVALID: "Configurazione server Anthropic non valida",
  CTE_OCR_PROVIDER_AUTH_FAILED: "Autenticazione del provider Anthropic non riuscita",
  CTE_OCR_PROVIDER_RATE_LIMITED: "Provider Anthropic temporaneamente limitato",
  CTE_OCR_PROVIDER_TIMEOUT: "Il provider Anthropic non ha risposto in tempo",
  CTE_OCR_PROVIDER_FAILED: "Elaborazione Anthropic non disponibile",
  CTE_OCR_RESPONSE_INVALID: "Risposta Anthropic non valida",
  CTE_OCR_TOOL_USE_MISSING: "Estrazione Anthropic mancante",
  CTE_OCR_OUTPUT_TRUNCATED: "Risposta Anthropic troncata prima dell’estrazione completa",
  CTE_OCR_PROVIDER_REFUSAL: "Il provider Anthropic ha rifiutato l’estrazione",
  CTE_OCR_PROVIDER_RESPONSE_UNKNOWN: "Risposta Anthropic non riconosciuta",
  CTE_OCR_NO_USABLE_EVIDENCE: "Nessuna evidenza estraibile sufficiente",
  CTE_EXTRACTION_SCHEMA_INVALID: "Schema di estrazione non valido",
  CTE_EXTRACTION_CONTRACT_INVALID: "Contratto estratto non valido",
  CTE_VECTOR_FIELD_MIXED: "Campi EE/GAS incompatibili",
  CTE_APPROVAL_BLOCKED: "Approvazione non disponibile: completare i campi obbligatori e la revisione",
  PROPOSAL_RESPONSE_INVALID: "Risposta proposta non valida",
  CALCULATION_RESPONSE_INVALID: "Risposta calcolo non valida",
  COMPARISON_RESPONSE_INVALID: "Risposta confronto non valida",
  EXPORT_CONTENT_TYPE_INVALID: "Tipo contenuto export non valido",
  EXPORT_FILENAME_INVALID: "Nome file export non valido",
  UI_REQUEST_FAILED: "Operazione non disponibile. Codice UI_REQUEST_FAILED",
};

function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_CODE.test(value) && Object.prototype.hasOwnProperty.call(messages, value) ? value : fallback;
}

function safeCorrelation(value: unknown): string | null {
  return typeof value === "string" && SAFE_CORRELATION.test(value) && !/secret|token|cookie|password|bearer|path|stack|trace/i.test(value) ? value : null;
}

function messageFor(code: string): string { return messages[code] ?? `Operazione non disponibile. Codice ${code}`; }

function errorFrom(value: unknown, fallback: string): UiApiError {
  if (typeof value !== "object" || value === null) return new UiApiError(fallback, messageFor(fallback));
  const item = value as ApiErrorData;
  const code = safeCode(item.code, fallback);
  return new UiApiError(code, messageFor(code), safeCorrelation(item.correlationId));
}

export function toUiError(error: unknown, fallback = "UI_REQUEST_FAILED"): UiApiError {
  if (error instanceof UiApiError) return error;
  const code = error instanceof Error ? safeCode(error.message, fallback) : fallback;
  return new UiApiError(code, messageFor(code));
}

export async function requestJson<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { ...init, signal, credentials: "same-origin", headers: { ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = typeof body === "object" && body !== null && "error" in body ? (body as { readonly error?: unknown }).error : body;
    throw errorFrom(errorBody, `HTTP_${response.status}`);
  }
  return body as T;
}

export async function requestForm<T>(path: string, form: FormData, signal?: AbortSignal, headers: HeadersInit = {}): Promise<T> {
  const response = await fetch(path, { method: "POST", body: form, signal, credentials: "same-origin", headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = typeof body === "object" && body !== null && "error" in body ? (body as { readonly error?: unknown }).error : body;
    throw errorFrom(errorBody, `HTTP_${response.status}`);
  }
  return body as T;
}

function safeFilename(value: string | null, extension: string): string {
  if (value === null || /[\\/\r\n]/.test(value) || !value.toLowerCase().endsWith(extension)) throw new UiApiError("EXPORT_FILENAME_INVALID", "Nome file export non valido");
  return value;
}

export async function downloadExport(path: string, payload: unknown, format: "JSON" | "CSV" | "HTML"): Promise<void> {
  const response = await fetch(path, { method: "POST", body: JSON.stringify(payload), credentials: "same-origin", headers: { "content-type": "application/json" } });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const errorBody = typeof body === "object" && body !== null && "error" in body ? (body as { readonly error?: unknown }).error : body;
    throw errorFrom(errorBody, `HTTP_${response.status}`);
  }
  const expected = format === "JSON" ? "application/json" : format === "CSV" ? "text/csv" : "text/html";
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith(expected)) throw new UiApiError("EXPORT_CONTENT_TYPE_INVALID", "Tipo contenuto export non valido");
  const extension = format === "JSON" ? ".json" : format === "CSV" ? ".csv" : ".html";
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  const filename = safeFilename(match?.[1] ?? null, extension);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
