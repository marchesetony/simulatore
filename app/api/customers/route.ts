import { requestPrincipal } from "../../lib/auth/request";
import { AuthenticationError } from "../../lib/auth/errors";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { billInScope, billVisibilityScope } from "../../lib/foundation/bill-visibility";
import { buildCustomerRegistry, customerBillFact } from "../../lib/foundation/customer-registry";

// Tony (24/11/2026, "COMPLETAMENTO APPLICAZIONE"): anagrafica cliente e POD, read only. Identity, company and commercial
// branch are checked on every request: the registry is built only from the bills of the user's company the user may see.
const CORRELATION_ID = "foundation-customer-registry";
const MAX_BILLS = 500;
const NO_STORE = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const AUTH_STATUS: Readonly<Record<string, number>> = { AUTHENTICATION_REQUIRED: 401, AUTHENTICATION_EXPIRED: 401, AUTHENTICATION_INVALID: 401, AUTHORIZATION_DENIED: 403, TENANT_MISMATCH: 403, ROLE_INSUFFICIENT: 403 };

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const repositories = runtimeRepositories();
    const scope = await billVisibilityScope(principal, repositories);
    const documents = (await repositories.billRepository.list(principal.tenantId)).filter((document) => document.tenantId === principal.tenantId && billInScope(document, scope));
    // Never a partial registry: over the limit it says so instead of leaving customers out.
    if (documents.length > MAX_BILLS) return Response.json({ error: { code: "CUSTOMER_REGISTRY_TOO_LARGE", message: `Le bollette superano ${MAX_BILLS}: l'anagrafica non viene mostrata per non presentarla incompleta.`, correlationId: CORRELATION_ID } }, { status: 503, headers: NO_STORE });
    return Response.json(buildCustomerRegistry(principal.tenantId, documents.map(customerBillFact)), { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof AuthenticationError ? error.code : error instanceof Error && error.message in AUTH_STATUS ? error.message : "CUSTOMER_REGISTRY_UNAVAILABLE";
    return Response.json({ error: { code, message: code === "CUSTOMER_REGISTRY_UNAVAILABLE" ? "Anagrafica clienti non disponibile: riprova." : "Accesso non consentito.", correlationId: CORRELATION_ID } }, { status: AUTH_STATUS[code] ?? 503, headers: NO_STORE });
  }
}
