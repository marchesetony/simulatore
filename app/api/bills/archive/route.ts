import { requestPrincipal } from "../../../lib/auth/request";
import { authorizePrincipal } from "../../../lib/auth/authorization";
import { AuthenticationError } from "../../../lib/auth/errors";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { billInScope, billVisibilityScope } from "../../../lib/foundation/bill-visibility";
import { romeToday } from "../../../lib/market/operational-window";
import { proposalsFromBill } from "../../../lib/foundation/bill-delete";
import { billArchiveRow } from "../../../lib/foundation/bill-archive";

// Tony (20/11/2026, "AVVIO FASE 2: ARCHIVIO BOLLETTE"): the company bill archive. Identity, company and commercial branch are
// checked here, on every request: the list holds only the bills of the user's company that the user may see.
const CORRELATION_ID = "foundation-bill-archive";
const MAX_ARCHIVE_RESULTS = 500;
const NO_STORE = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const AUTH_STATUS: Readonly<Record<string, number>> = { AUTHENTICATION_REQUIRED: 401, AUTHENTICATION_EXPIRED: 401, AUTHENTICATION_INVALID: 401, AUTHORIZATION_DENIED: 403, TENANT_MISMATCH: 403, ROLE_INSUFFICIENT: 403 };

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const repositories = runtimeRepositories();
    const scope = await billVisibilityScope(principal, repositories);
    // Tony (20/11/2026, "CHIUSURA FASE 2", punto 1): the archive shows every bill of the company in the user's branch, whatever
    // its age; whether it can still be quoted is only a mark on the row (the simulation keeps its own window).
    const today = romeToday();
    const documents = (await repositories.billRepository.list(principal.tenantId)).filter((document) => document.tenantId === principal.tenantId && billInScope(document, scope));
    // Never a partial list: over the limit the archive says so instead of hiding bills.
    if (documents.length > MAX_ARCHIVE_RESULTS) return Response.json({ error: { code: "BILL_LIST_TOO_LARGE", message: `L'archivio supera ${MAX_ARCHIVE_RESULTS} bollette: l'elenco non viene mostrato per non presentarlo incompleto.`, correlationId: CORRELATION_ID } }, { status: 503, headers: NO_STORE });
    const proposals = await repositories.proposals.list(principal.tenantId);
    const rows = documents.map((document) => billArchiveRow(document, proposalsFromBill(proposals, principal.tenantId, document.id), today));
    return Response.json({ rows, canDelete: authorizePrincipal(principal, "WRITE").allowed }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof AuthenticationError ? error.code : error instanceof Error && error.message in AUTH_STATUS ? error.message : "BILL_ARCHIVE_UNAVAILABLE";
    return Response.json({ error: { code, message: code === "BILL_ARCHIVE_UNAVAILABLE" ? "Archivio bollette non disponibile: riprova." : "Accesso non consentito.", correlationId: CORRELATION_ID } }, { status: AUTH_STATUS[code] ?? 503, headers: NO_STORE });
  }
}
