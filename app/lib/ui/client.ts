export interface ApiErrorData {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly correlationId?: unknown;
  readonly detail?: unknown;
}

export class UiApiError extends Error {
  readonly code: string;
  readonly correlationId: string | null;
  readonly detail: string | null;

  constructor(code: string, message: string, correlationId: string | null = null, detail: string | null = null) {
    super(message);
    this.name = "UiApiError";
    this.code = code;
    this.correlationId = correlationId;
    this.detail = detail;
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
  BILL_APPROVED_DELETE_FORBIDDEN: "Le bollette approvate non possono essere cancellate.",
  BILL_DELETE_UNAVAILABLE: "La cancellazione della bolletta non è disponibile.",
  APPROVAL_REQUIRED_FIELDS_MISSING: "Mancano campi obbligatori per l'approvazione",
  APPROVAL_FIELDS_UNCONFIRMED: "Confermare i campi richiesti prima dell'approvazione",
  CORRECTION_INVALID: "Correzione non valida",
  DOCUMENT_VERSION_STALE: "La versione del documento non è più aggiornata",
  DOCUMENT_VERSION_NOT_CURRENT: "La versione selezionata non è corrente",
  DOCUMENT_VERSION_ALREADY_APPROVED: "La versione è già approvata",
  DOCUMENT_NO_CHANGES: "La correzione non contiene modifiche",
  METADATA_INVALID: "Metadati documento non validi",
  PDF_REQUIRED: "Selezionare un file PDF.",
  PDF_MIME_INVALID: "Il file selezionato non è un PDF valido.",
  PDF_SIGNATURE_INVALID: "La firma del PDF non è valida.",
  PDF_TOO_LARGE: "Il PDF supera il limite consentito.",
  PDF_EMPTY: "Il file caricato è vuoto.",
  PDF_FILENAME_INVALID: "Il nome del file non è valido: rinominalo in modo semplice (es. bolletta.pdf).",
  OVERRIDE_AUTHORIZATION_DENIED: "Non hai il permesso di autorizzare CTE: chiedilo al tuo responsabile o all'amministratore.",
  OVERRIDE_NOT_REQUESTABLE: "Questa CTE non si può autorizzare per la bolletta: il motivo dell'esclusione impedisce il calcolo.",
  OVERRIDE_REASON_REQUIRED: "Scrivi il motivo dell'autorizzazione.",
  ORG_CTE_AUTHORIZATION_GRANT_DENIED: "Solo chi può autorizzare CTE può dare questo permesso.",
  ORG_CTE_AUTHORIZATION_PARENT_MISSING: "Il responsabile di questa persona non può autorizzare CTE: dai prima il permesso al responsabile.",
  BILL_EXTRACTION_REQUIRED_FIELD_MISSING: "Mancano dati obbligatori nella bolletta.",
  BILL_EXTRACTION_VALUE_INVALID: "Un dato estratto dalla bolletta non è valido.",
  BILL_CONTRACT_VALIDATION_FAILED: "I dati estratti dalla bolletta non superano la validazione.",
  BILL_METADATA_INVALID: "I metadati della bolletta non sono validi.",
  BILL_MAPPING_FAILED: "I dati della bolletta non sono interpretabili.",
  BILL_RETRY_FAILED: "La rielaborazione della bolletta non è disponibile.",
  BILL_VECTOR_UNKNOWN: "Il vettore della bolletta non è stato riconosciuto.",
  EXTRACTION_REQUIRED_FIELD_MISSING: "La bolletta non contiene tutti i dati obbligatori.",
  EXTRACTION_VALUE_INVALID: "I dati della bolletta non sono validi.",
  INGESTION_FAILED: "Caricamento bolletta non disponibile.",
  BILL_OPERATION_FAILED: "Operazione bolletta non disponibile.",
  BILL_OCR_PROVIDER_NOT_CONFIGURED: "Servizio di lettura non configurato.",
  BILL_OCR_PROVIDER_CONFIGURATION_INVALID: "Servizio di lettura non configurato correttamente.",
  BILL_OCR_PROVIDER_AUTH_FAILED: "Servizio di lettura non disponibile per un problema di configurazione.",
  BILL_OCR_PROVIDER_RATE_LIMITED: "Servizio di lettura temporaneamente limitato. Riprova più tardi.",
  BILL_OCR_REQUEST_INVALID: "Il servizio di lettura ha rifiutato la richiesta.",
  BILL_OCR_BILLING_ERROR: "Il servizio di lettura non è disponibile per un problema di credito o fatturazione.",
  BILL_OCR_NOT_FOUND: "Il servizio di lettura configurato non è disponibile.",
  BILL_OCR_REQUEST_TOO_LARGE: "Il documento supera i limiti del servizio di lettura.",
  BILL_OCR_PROVIDER_UNAVAILABLE: "Il servizio di lettura è temporaneamente non disponibile.",
  BILL_OCR_NETWORK_ERROR: "Non è stato possibile raggiungere il servizio di lettura.",
  BILL_OCR_PROVIDER_TIMEOUT: "La lettura del documento ha impiegato troppo tempo. Riprova.",
  BILL_OCR_OUTPUT_TRUNCATED: "La lettura del documento non è stata completata. Riprova.",
  BILL_OCR_RESPONSE_INVALID: "La risposta del servizio di lettura non è valida.",
  BILL_OCR_PROVIDER_REFUSAL: "Il servizio di lettura ha rifiutato l'estrazione.",
  BILL_OCR_PROVIDER_FAILED: "Servizio di lettura temporaneamente non disponibile.",
  CTE_EXPIRY_DATE_INVALID: "Data di scadenza non valida: deve essere oggi o successiva e non prima dell'inizio di validità.",
  CTE_OCR_PROVIDER_NOT_CONFIGURED: "Provider Anthropic non configurato",
  ANTHROPIC_API_KEY_MISSING: "Configurazione Anthropic incompleta: chiave server mancante",
  ANTHROPIC_MODEL_MISSING: "Configurazione Anthropic incompleta: modello server mancante",
  ANTHROPIC_CTE_MAX_TOKENS_INVALID: "Configurazione server Anthropic non valida",
  ANTHROPIC_CTE_TIMEOUT_INVALID: "Configurazione timeout Anthropic non valida",
  CTE_OCR_PROVIDER_AUTH_FAILED: "Autenticazione del provider Anthropic non riuscita",
  CTE_OCR_PROVIDER_RATE_LIMITED: "Provider Anthropic temporaneamente limitato",
  CTE_OCR_PROVIDER_TIMEOUT: "Il provider Anthropic non ha risposto in tempo",
  CTE_OCR_PROVIDER_FAILED: "Elaborazione Anthropic non disponibile",
  CTE_OCR_RESPONSE_INVALID: "Risposta Anthropic non valida",
  CTE_OCR_TOOL_USE_MISSING: "Estrazione Anthropic mancante",
  CTE_INGESTION_FAILED: "Analisi del documento non riuscita",
  CTE_OCR_OUTPUT_TRUNCATED: "Risposta Anthropic troncata prima dell’estrazione completa",
  CTE_OCR_PROVIDER_REFUSAL: "Il provider Anthropic ha rifiutato l’estrazione",
  CTE_OCR_PROVIDER_RESPONSE_UNKNOWN: "Risposta Anthropic non riconosciuta",
  CTE_OCR_NO_USABLE_EVIDENCE: "Nessuna evidenza estraibile sufficiente",
  CTE_EXTRACTION_SCHEMA_INVALID: "Schema di estrazione non valido",
  CTE_EXTRACTION_CONTRACT_INVALID: "Contratto estratto non valido",
  CTE_VECTOR_FIELD_MIXED: "Campi EE/GAS incompatibili",
  CTE_CORRECTION_VALUE_INVALID: "Valore non valido: controlla il dato inserito (per le date usa gg/mm/aaaa).",
  CTE_CORRECTION_FIELD_UNSUPPORTED: "Questo dato non si può correggere da qui.",
  CTE_ARCHIVE_ALREADY_EXISTS: "Questa CTE è già presente in Archivio approvato.",
  CTE_APPROVED_VALIDITY_OVERLAP: "La stessa offerta è già in Archivio approvato per un periodo che si sovrappone: cancella il doppione oppure blocca o cancella quella già approvata.",
  SOURCE_BILL_VECTOR_UNKNOWN: "Dalla bolletta non si capisce se è luce o gas. Ricarica un PDF più leggibile.",
  SOURCE_BILL_SUPPLIER_MISSING: "Nella bolletta non abbiamo trovato il fornitore attuale. Correggilo nei dati e riprova.",
  SOURCE_BILL_PERIOD_MISSING: "Nella bolletta non abbiamo trovato il periodo fatturato. Ricarica un PDF completo.",
  SOURCE_BILL_CUSTOMER_TYPE_MISSING: "Dalla bolletta non si capisce se il cliente è Consumer o Business. Ricarica il PDF completo, con la pagina delle caratteristiche della fornitura.",
  SOURCE_BILL_POD_MISSING: "Nella bolletta non abbiamo trovato un POD valido (IT…). Ricarica il PDF completo.",
  SOURCE_BILL_PDR_MISSING: "Nella bolletta non abbiamo trovato un PDR valido (14 cifre). Ricarica il PDF completo.",
  SOURCE_BILL_VOLTAGE_MISSING: "Nella bolletta non abbiamo trovato la tensione di alimentazione (BT, MT). Ricarica il PDF completo.",
  SOURCE_BILL_CONSUMPTION_INCONSISTENT: "I consumi F1, F2 e F3 letti non tornano con il consumo totale della bolletta. Ricarica il PDF.",
  SOURCE_BILL_CONTEXT_UNAVAILABLE: "Non riusciamo a usare questa bolletta per il confronto: ricaricala come nuovo PDF.",
  CTE_INGESTION_NOT_FOUND: "Il documento non è più presente (già cancellato o approvato): ricarica l'elenco.",
  CTE_EXPIRED: "La CTE risulta già scaduta: aggiorna la scadenza prima di approvarla.",
  CTE_VERSION_STALE: "La CTE è stata modificata nel frattempo: ricarica la pagina e riprova.",
  CTE_INGESTION_APPROVED_IMMUTABLE: "Questa CTE è già approvata e non può essere modificata.",
  CTE_APPROVAL_BLOCKED: "Approvazione non disponibile: completare i campi obbligatori e la revisione",
  PROPOSAL_RESPONSE_INVALID: "Risposta proposta non valida",
  PROPOSAL_ID_REQUIRED: "La proposta archiviata non è disponibile",
  PROPOSAL_NOT_FOUND: "Proposta non trovata",
  PROPOSAL_RECORD_INVALID: "La proposta archiviata non è coerente",
  CALCULATION_RESPONSE_INVALID: "Risposta calcolo non valida",
  COMPARISON_RESPONSE_INVALID: "Risposta confronto non valida",
  EXPORT_CONTENT_TYPE_INVALID: "Tipo contenuto export non valido",
  EXPORT_FILENAME_INVALID: "Nome file export non valido",
  SOURCE_BILL_TOO_OLD: "La bolletta si riferisce a un periodo di fornitura di oltre 4 mesi fa: carica una bolletta più recente.",
  MARKET_OFFICIAL_DATA_READ_ONLY: "PUN e PSV sono dati ufficiali: arrivano in automatico da GME e ARERA e non si modificano a mano.",
  ACCESS_DENIED: "Non hai i permessi per questa operazione.",
  ACCESS_PARENT_REQUIRED: "Scegli sotto a chi lavora la persona.",
  ACCESS_PARENT_NOT_FOUND: "Il responsabile scelto non è nella catena.",
  ACCESS_PARENT_LEVEL_INVALID: "Il responsabile deve avere un ruolo più alto di quello che stai creando.",
  ACCESS_EMAIL_TAKEN: "Esiste già un accesso con questa email.",
  ACCESS_EMAIL_INVALID: "Email non valida.",
  ACCESS_PASSWORD_WEAK: "La password deve avere almeno 10 caratteri, con lettere e numeri.",
  ACCESS_PASSWORD_INCORRECT: "La password attuale non è corretta.",
  ACCESS_PASSWORD_UNCHANGED: "La nuova password deve essere diversa da quella attuale.",
  ACCESS_NAME_INVALID: "Inserisci nome e cognome.",
  ACCESS_COMPANY_NAME_INVALID: "Inserisci la ragione sociale.",
  ACCESS_COMPANY_EXISTS: "Esiste già un'azienda con questo nome.",
  ACCESS_SELF_EDIT_DENIED: "Non puoi sospendere il tuo stesso accesso.",
  ACCESS_DIRECTORY_UNAVAILABLE: "Servizio accessi non disponibile. Riprova.",
  PERSISTENCE_VERSION_CONFLICT: "Qualcun altro ha modificato questo accesso. Ricarica la pagina.",
  UI_REQUEST_FAILED: "Operazione non disponibile. Codice UI_REQUEST_FAILED",
};

function safeCode(value: unknown, fallback: string): string {
  // Any well-formed server code is shown, so an error is never reduced to a bare HTTP status.
  return typeof value === "string" && SAFE_CODE.test(value) ? value : fallback;
}

function safeCorrelation(value: unknown): string | null {
  return typeof value === "string" && SAFE_CORRELATION.test(value) && !/secret|token|cookie|password|bearer|path|stack|trace/i.test(value) ? value : null;
}

function messageFor(code: string): string {
  if (!messages[code] && code.startsWith("SOURCE_BILL_CONTRACT_")) return `Un dato letto dalla bolletta non è valido (${code.slice("SOURCE_BILL_CONTRACT_".length)}): controllalo in "Dati letti" e riprova.`;
  return messages[code] ?? `Operazione non disponibile. Codice ${code}`;
}

function errorFrom(value: unknown, fallback: string): UiApiError {
  if (typeof value !== "object" || value === null) return new UiApiError(fallback, messageFor(fallback));
  const item = value as ApiErrorData;
  const code = safeCode(item.code, fallback);
  const detail = typeof item.detail === "string" && item.detail.trim() ? item.detail.trim().slice(0, 240) : null;
  return new UiApiError(code, messageFor(code), safeCorrelation(item.correlationId), detail);
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

/** Tony (31/10): "IL LIMITE DI 10 MB BISOGNA ALZARLO". Files up to 20 MB; above 4 MB the browser sends them straight to storage, because the hosting refuses request bodies over about 4,5 MB. */
export const MAX_UPLOAD_BYTES = 20_000_000;
const DIRECT_UPLOAD_THRESHOLD_BYTES = 4_000_000;

export async function requestUpload<T>(path: string, file: File, headers: Record<string, string> = {}): Promise<T> {
  if (file.size <= DIRECT_UPLOAD_THRESHOLD_BYTES) { const form = new FormData(); form.append("file", file); return requestForm<T>(path, form, undefined, headers); }
  const target = await requestJson<{ readonly uploadId: string; readonly signedUrl: string }>("/api/uploads/target", { method: "POST", body: "{}" });
  const sent = await fetch(target.signedUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" } }).catch(() => null);
  if (!sent?.ok) throw new UiApiError("UPLOAD_TRANSFER_FAILED", "Invio del file non riuscito: riprova");
  return requestJson<T>(path, { method: "POST", body: JSON.stringify({ uploadId: target.uploadId, fileName: file.name, contentType: file.type }), headers });
}

function safeFilename(value: string | null, extension: string): string {
  if (value === null || /[\\/\r\n]/.test(value) || !value.toLowerCase().endsWith(extension)) throw new UiApiError("EXPORT_FILENAME_INVALID", "Nome file export non valido");
  return value;
}

export async function downloadExport(path: string, payload: unknown, format: "JSON" | "CSV" | "HTML" | "PDF"): Promise<void> {
  const response = await fetch(path, { method: "POST", body: JSON.stringify(payload), credentials: "same-origin", headers: { "content-type": "application/json" } });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const errorBody = typeof body === "object" && body !== null && "error" in body ? (body as { readonly error?: unknown }).error : body;
    throw errorFrom(errorBody, `HTTP_${response.status}`);
  }
  const expected = format === "JSON" ? "application/json" : format === "CSV" ? "text/csv" : format === "HTML" ? "text/html" : "application/pdf";
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith(expected)) throw new UiApiError("EXPORT_CONTENT_TYPE_INVALID", "Tipo contenuto export non valido");
  const extension = format === "JSON" ? ".json" : format === "CSV" ? ".csv" : format === "HTML" ? ".html" : ".pdf";
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
