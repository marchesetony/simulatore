import { AuthenticationError } from "../auth/errors";

export const ANALYSIS_HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };

const MESSAGES: Readonly<Record<string, string>> = {
  BILL_ANALYSIS_NOT_FOUND: "Analisi non trovata.",
  BILL_ANALYSIS_ID_INVALID: "Analisi non valida: ricomincia.",
  BILL_ANALYSIS_BUSY: "L'analisi è occupata: riprova tra un istante.",
  BILL_ANALYSIS_NOT_DISCARDABLE: "Questa bolletta non si può più annullare da qui: è stata modificata, approvata o usata per una proposta.",
};

export function analysisError(error: unknown): Response {
  if (error instanceof AuthenticationError) {
    const status = error.code === "AUTHORIZATION_DENIED" || error.code === "TENANT_MISMATCH" ? 403 : error.code.startsWith("AUTH_") ? 503 : 401;
    return Response.json({ error: { code: error.code, message: "Accesso non consentito." } }, { status, headers: ANALYSIS_HEADERS });
  }
  const code = error instanceof Error && MESSAGES[error.message] ? error.message : "BILL_ANALYSIS_FAILED";
  const status = code === "BILL_ANALYSIS_NOT_FOUND" ? 404 : code === "BILL_ANALYSIS_ID_INVALID" ? 400 : code === "BILL_ANALYSIS_FAILED" ? 500 : 409;
  if (code === "BILL_ANALYSIS_FAILED") console.error("BILL_ANALYSIS_FAILED", error instanceof Error ? error.message : String(error));
  return Response.json({ error: { code, message: MESSAGES[code] ?? "Operazione non riuscita: riprova." } }, { status, headers: ANALYSIS_HEADERS });
}
