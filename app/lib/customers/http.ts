import type { AuthenticatedPrincipal } from "../auth/types";
import type { RuntimeRepositories } from "../persistence/adapter";
import type { RegistryContext } from "./registry";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billVisibilityScope } from "../foundation/bill-visibility.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { addSupply, changeHolder, createCustomer, createFromBill, linkBill, RegistryError, updateCustomer, updateSupply } from "./registry.ts";

// Tony (24/11/2026, "FASE 2: ANAGRAFICA CLIENTI E POD"): what the /api/customers route runs, kept apart so it is tested as served.

export const CUSTOMER_CORRELATION_ID = "foundation-customer-registry";
export const CUSTOMER_NO_STORE = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const AUTH_STATUS: Readonly<Record<string, number>> = { AUTHENTICATION_REQUIRED: 401, AUTHENTICATION_EXPIRED: 401, AUTHENTICATION_INVALID: 401, AUTHORIZATION_DENIED: 403, TENANT_MISMATCH: 403, ROLE_INSUFFICIENT: 403 };

export const REGISTRY_MESSAGES: Readonly<Record<string, string>> = {
  AUTHORIZATION_DENIED: "Operazione non consentita al tuo ruolo per questo cliente.",
  CUSTOMER_NOT_FOUND: "Cliente non trovato.", SUPPLY_NOT_FOUND: "POD/PDR non trovato.", BILL_NOT_FOUND: "Bolletta non trovata.",
  CUSTOMER_NAME_REQUIRED: "Indica la ragione sociale o il nominativo.", CUSTOMER_KIND_INVALID: "Indica se è persona fisica o giuridica.",
  CUSTOMER_TAX_CODE_INVALID: "Codice fiscale non valido (16 caratteri, o 11 cifre per le società).", CUSTOMER_VAT_NUMBER_INVALID: "Partita IVA non valida (11 cifre).",
  CUSTOMER_CATEGORY_INVALID: "Tipologia cliente non valida.", CUSTOMER_EMAIL_INVALID: "Email non valida.", CUSTOMER_PHONE_INVALID: "Telefono non valido.",
  CUSTOMER_FIELD_INVALID: "Dato non valido.", CUSTOMER_FIELD_TOO_LONG: "Testo troppo lungo.", SUPPLY_FIELD_INVALID: "Dato tecnico non valido.", SUPPLY_NUMBER_INVALID: "Valore numerico non valido.",
  CUSTOMER_ALREADY_REGISTERED: "Codice fiscale o partita IVA già registrati per un altro cliente: usa quello esistente (i clienti non vengono uniti automaticamente).",
  SUPPLY_REFERENCE_REQUIRED: "Indica il POD o il PDR.", SUPPLY_POD_INVALID: "POD non valido (es. IT001E12345678).", SUPPLY_PDR_INVALID: "PDR non valido (14 cifre).", SUPPLY_VECTOR_INVALID: "Indica energia elettrica o gas.",
  SUPPLY_ALREADY_REGISTERED: "POD/PDR già registrato: se è cambiato l'intestatario registra il cambio di intestatario.",
  HOLDER_CHANGE_DATE_REQUIRED: "Indica la data del cambio di intestatario.", HOLDER_CHANGE_REASON_REQUIRED: "Indica il motivo del cambio (es. voltura, subentro).",
  HOLDER_UNCHANGED: "Il cliente indicato è già l'intestatario attuale.", HOLDER_CHANGE_DATE_BEFORE_CURRENT: "La data del cambio deve essere successiva all'inizio dell'intestatario attuale.",
  DATE_INVALID: "Data non valida.", SUPPLY_NOT_HELD_BY_CUSTOMER: "Il POD/PDR non è (né è stato) intestato a questo cliente.",
  BILL_SUPPLY_MISMATCH: "Il POD letto nella bolletta è diverso da quello scelto: la bolletta non viene collegata.",
  BILL_HOLDER_NOT_READ: "Intestatario non letto nella bolletta: crea il cliente a mano.", BILL_SUPPLY_NOT_READ: "POD/PDR non letto nella bolletta: crea il cliente e il POD a mano.",
  CUSTOMER_ACTION_INVALID: "Operazione non riconosciuta.", PERSISTENCE_VERSION_CONFLICT: "Il dato è stato modificato da un altro utente: ricarica e riprova.",
  HIERARCHY_STORAGE_UNAVAILABLE: "Archivio anagrafica non disponibile.",
};

export async function registryContext(principal: AuthenticatedPrincipal, repositories: RuntimeRepositories, now: () => string = () => new Date().toISOString()): Promise<RegistryContext> {
  const scope = await billVisibilityScope(principal, repositories);
  return {
    principal, scope, now,
    repositories: { customers: repositories.customers, customerSupplies: repositories.customerSupplies, customerBillLinks: repositories.customerBillLinks, billRepository: repositories.billRepository, comparisonResults: repositories.comparisonResults, proposals: repositories.proposals },
    // The audit is written before the record: if it cannot be written nothing changes.
    audit: async (event) => { await recordRuntimeAudit({ principal, action: event.action, resourceType: event.resourceType, resourceId: event.resourceId, outcome: "ALLOWED", correlationId: CUSTOMER_CORRELATION_ID, metadata: event.metadata }); },
  };
}

/** One registry command: { action, ...fields }. */
export async function runRegistryAction(context: RegistryContext, body: unknown): Promise<unknown> {
  const input = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  switch (input.action) {
    case "CREATE_CUSTOMER": return { customer: await createCustomer(context, input) };
    case "UPDATE_CUSTOMER": return { customer: await updateCustomer(context, String(input.customerId ?? ""), input) };
    case "ADD_SUPPLY": return { supply: await addSupply(context, String(input.customerId ?? ""), input) };
    case "UPDATE_SUPPLY": return { supply: await updateSupply(context, String(input.supplyId ?? ""), input) };
    case "CHANGE_HOLDER": return { supply: await changeHolder(context, String(input.supplyId ?? ""), input) };
    case "LINK_BILL": return { link: await linkBill(context, input) };
    case "CREATE_FROM_BILL": return await createFromBill(context, input);
    default: throw new RegistryError("CUSTOMER_ACTION_INVALID", 400);
  }
}

export function registryErrorResponse(error: unknown, AuthError: abstract new (...args: never[]) => Error & { code: string }): Response {
  const code = error instanceof AuthError ? error.code : error instanceof Error ? (/PERSISTENCE_VERSION_CONFLICT/.test(error.message) ? "PERSISTENCE_VERSION_CONFLICT" : error.message) : "CUSTOMER_REGISTRY_UNAVAILABLE";
  const status = error instanceof RegistryError ? error.status : AUTH_STATUS[code] ?? (code === "PERSISTENCE_VERSION_CONFLICT" ? 409 : 503);
  const known = error instanceof RegistryError || code in AUTH_STATUS || code === "PERSISTENCE_VERSION_CONFLICT";
  const message = known ? REGISTRY_MESSAGES[code] ?? (code in AUTH_STATUS ? "Accesso non consentito." : code) : "Anagrafica clienti non disponibile: riprova.";
  return Response.json({ error: { code: known ? code : "CUSTOMER_REGISTRY_UNAVAILABLE", message, correlationId: CUSTOMER_CORRELATION_ID, ...(error instanceof RegistryError ? error.detail : {}) } }, { status, headers: CUSTOMER_NO_STORE });
}
