import { requestPrincipal } from "../../../../lib/auth/request";
import { AuthenticationError } from "../../../../lib/auth/errors";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { getBillInScope } from "../../../../lib/foundation/bill-visibility";
import { deleteBillSelection, parseDeleteSelection } from "../../../../lib/foundation/bill-archive";
import { BULK_DELETE_LIMIT } from "../../../../lib/ui/bill-archive-month";

// Tony (20/11/2026, point 4): one bill, a selection or the bills of a month, deleted in one call after an explicit
// confirmation. WRITE (company administrator, director, area manager) is checked before any bill is read; then each bill is
// read with the user's company only, checked against the commercial branch and its proposals, and reported on its own.
const CORRELATION_ID = "foundation-bill-archive-delete";
const NO_STORE = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const STATUS: Readonly<Record<string, number>> = { AUTHENTICATION_REQUIRED: 401, AUTHENTICATION_EXPIRED: 401, AUTHENTICATION_INVALID: 401, AUTHORIZATION_DENIED: 403, TENANT_MISMATCH: 403, ROLE_INSUFFICIENT: 403, BILL_DELETE_CONFIRMATION_REQUIRED: 400, BILL_DELETE_SELECTION_INVALID: 400, BILL_DELETE_SELECTION_TOO_LARGE: 400 };
const MESSAGE: Readonly<Record<string, string>> = {
  BILL_DELETE_CONFIRMATION_REQUIRED: "Conferma esplicita richiesta: nessuna bolletta è stata eliminata.",
  BILL_DELETE_SELECTION_INVALID: "Selezione non valida: nessuna bolletta è stata eliminata.",
  BILL_DELETE_SELECTION_TOO_LARGE: `Puoi eliminare al massimo ${BULK_DELETE_LIMIT} bollette per volta: nessuna bolletta è stata eliminata.`,
};

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const ids = parseDeleteSelection(await request.json().catch(() => null), BULK_DELETE_LIMIT);
    const repositories = runtimeRepositories();
    const results = await deleteBillSelection(principal, repositories, { inScope: (id) => getBillInScope(principal, repositories, id) }, ids, CORRELATION_ID);
    return Response.json({ results }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof AuthenticationError ? error.code : error instanceof Error && error.message in STATUS ? error.message : "BILL_DELETE_UNAVAILABLE";
    return Response.json({ error: { code, message: MESSAGE[code] ?? (STATUS[code] ? "Accesso non consentito: nessuna bolletta è stata eliminata." : "Eliminazione non disponibile: riprova."), correlationId: CORRELATION_ID } }, { status: STATUS[code] ?? 503, headers: NO_STORE });
  }
}
