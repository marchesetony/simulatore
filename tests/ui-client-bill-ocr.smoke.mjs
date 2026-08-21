import assert from "node:assert/strict";
import { requestForm, requestJson, UiApiError } from "../app/lib/ui/client.ts";

const messages = {
  PDF_REQUIRED: "Selezionare un file PDF.",
  PDF_MIME_INVALID: "Il file selezionato non è un PDF valido.",
  PDF_SIGNATURE_INVALID: "La firma del PDF non è valida.",
  PDF_TOO_LARGE: "Il PDF supera il limite consentito.",
  BILL_VECTOR_UNKNOWN: "Il vettore della bolletta non è stato riconosciuto.",
  EXTRACTION_REQUIRED_FIELD_MISSING: "La bolletta non contiene tutti i dati obbligatori.",
  EXTRACTION_VALUE_INVALID: "I dati della bolletta non sono validi.",
  INGESTION_FAILED: "Caricamento bolletta non disponibile.",
  BILL_OPERATION_FAILED: "Operazione bolletta non disponibile.",
  BILL_OCR_PROVIDER_NOT_CONFIGURED: "Servizio di lettura non configurato.",
  BILL_OCR_PROVIDER_CONFIGURATION_INVALID: "Servizio di lettura non configurato correttamente.",
  BILL_OCR_PROVIDER_AUTH_FAILED: "Servizio di lettura non disponibile per un problema di configurazione.",
  BILL_OCR_REQUEST_INVALID: "Il servizio di lettura ha rifiutato la richiesta.",
  BILL_OCR_BILLING_ERROR: "Il servizio di lettura non è disponibile per un problema di credito o fatturazione.",
  BILL_OCR_NOT_FOUND: "Il servizio di lettura configurato non è disponibile.",
  BILL_OCR_REQUEST_TOO_LARGE: "Il documento supera i limiti del servizio di lettura.",
  BILL_OCR_PROVIDER_UNAVAILABLE: "Il servizio di lettura è temporaneamente non disponibile.",
  BILL_OCR_NETWORK_ERROR: "Non è stato possibile raggiungere il servizio di lettura.",
  BILL_OCR_PROVIDER_RATE_LIMITED: "Servizio di lettura temporaneamente limitato. Riprova più tardi.",
  BILL_OCR_PROVIDER_TIMEOUT: "La lettura del documento ha impiegato troppo tempo. Riprova.",
  BILL_OCR_OUTPUT_TRUNCATED: "La lettura del documento non è stata completata. Riprova.",
  BILL_OCR_RESPONSE_INVALID: "La risposta del servizio di lettura non è valida.",
  BILL_OCR_PROVIDER_FAILED: "Servizio di lettura temporaneamente non disponibile.",
};

const previousFetch = globalThis.fetch;
try {
  for (const [code, message] of Object.entries(messages)) {
    globalThis.fetch = async () => Response.json({ error: { code, message: "raw provider response with API key, model, endpoint and prompt" } }, { status: code.includes("TIMEOUT") || code.includes("RESPONSE") || code.includes("TRUNCATED") || code.includes("FAILED") ? 502 : 503 });
    await assert.rejects(
      () => requestJson("/api/bills/fixture/retry", { method: "POST" }),
      (error) => {
        assert.equal(error instanceof UiApiError, true);
        assert.equal(error.name, "UiApiError");
        assert.equal(error.code, code);
        assert.equal(error.message, message);
        assert.notEqual(error.code, "HTTP_502");
        assert.doesNotMatch(error.message, /API key|model|endpoint|prompt|token|raw provider/i);
        return true;
      },
    );
  }
} finally {
  globalThis.fetch = previousFetch;
}

for (const code of ["INGESTION_FAILED", "BILL_OPERATION_FAILED", "BILL_OCR_REQUEST_INVALID", "EXTRACTION_REQUIRED_FIELD_MISSING", "PDF_MIME_INVALID"]) {
  globalThis.fetch = async () => Response.json({ error: { code, message: "bounded upload error" } }, { status: 400 });
  const form = new FormData();
  form.set("file", new Blob(["fixture"], { type: "application/pdf" }), "upload-test.pdf");
  await assert.rejects(
    () => requestForm("/api/bills", form),
    (error) => {
      assert.equal(error instanceof UiApiError, true);
      assert.equal(error.code, code);
      assert.equal(error.message, messages[code]);
      return true;
    },
  );
}
globalThis.fetch = previousFetch;

console.log("ui client bill OCR smoke: ok");
