import { createClaudeBillReader } from "../../../../lib/reading/bill-reader";
import { requestPrincipal } from "../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../../lib/persistence/audit";
import { AuthenticationError } from "../../../../lib/auth/errors";
import { BillDetailLinkError, linkBillDetail, toPublicDocument } from "../../../../lib/foundation/real-bill";
import { MAX_UPLOAD_BYTES, uploadedFile } from "../../../../lib/foundation/large-upload";
import { attachOfficialPun } from "../../../../lib/market/pun-reference";
import { billVisibilityScope, getBillInScope } from "../../../../lib/foundation/bill-visibility";
import { resolveBillFeaturePermissions, sanitizeBillForFeatureAccess } from "../../../../lib/foundation/bill-feature-permissions";

const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const MESSAGES: Readonly<Record<string, readonly [number, string]>> = {
  DOCUMENT_NOT_FOUND: [404, "Bolletta non trovata."],
  BILL_NOT_ACTIVE: [409, "La bolletta è in cancellazione: non si può collegare la fattura di dettaglio."],
  BILL_NOT_READ: [409, "La bolletta non è stata letta: collega la fattura di dettaglio dopo la lettura."],
  DETAIL_ALREADY_LINKED: [409, "Alla bolletta è già collegata un'altra fattura di dettaglio."],
  DETAIL_NOT_COHERENT: [422, "La fattura di dettaglio non risulta della stessa fattura e dello stesso punto di fornitura: nessun collegamento eseguito."],
};

/** Tony (19/11/2026): link the fattura di dettaglio (a separate PDF) to the sintetica already registered, in the same tenant. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const repositories = runtimeRepositories();
    const access = await resolveBillFeaturePermissions(principal, repositories, await billVisibilityScope(principal, repositories));
    if (!await getBillInScope(principal, repositories, id)) return Response.json({ error: { code: "DOCUMENT_NOT_FOUND", message: MESSAGES.DOCUMENT_NOT_FOUND[1] } }, { status: 404, headers: HEADERS });
    const file = await uploadedFile(request, repositories.documentStorage, principal.tenantId);
    if (!file) return Response.json({ error: { code: "PDF_REQUIRED", message: "Serve il PDF della fattura di dettaglio." } }, { status: 400, headers: HEADERS });
    const result = await linkBillDetail({
      tenantId: principal.tenantId, documentId: id, fileName: file.fileName, contentType: file.contentType, bytes: file.bytes, maxBytes: MAX_UPLOAD_BYTES,
      storage: repositories.documentStorage, repository: repositories.billRepository, structuredExtractor: createClaudeBillReader(), actorId: principal.userId,
      audit: { async record(event) { await recordRuntimeAudit({ principal, action: `BILL_${event.type}`, resourceType: "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "DENIED", correlationId: "foundation-bill-detail" }); } },
    });
    return Response.json({ outcome: result.outcome, checks: result.checks, document: sanitizeBillForFeatureAccess(await attachOfficialPun(toPublicDocument(result.document), repositories.marketArchiveRepository), access) }, { status: result.outcome === "LINKED" ? 201 : 200, headers: HEADERS });
  } catch (error) {
    if (error instanceof BillDetailLinkError) {
      const [status, message] = MESSAGES[error.code];
      // The checks that failed, in words, so the operator sees why (no customer data: only which item differs).
      const failed = error.checks.filter((check) => check.outcome === "FAILED").map((check) => check.message).join("; ").slice(0, 240);
      return Response.json({ error: { code: error.code, message, ...(failed ? { detail: failed } : {}) }, checks: error.checks }, { status, headers: HEADERS });
    }
    if (error instanceof AuthenticationError) {
      const status = /^AUTHENTICATION_/.test(error.code) ? 401 : /^AUTH_/.test(error.code) ? 503 : 403;
      return Response.json({ error: { code: error.code, message: "Accesso non consentito." } }, { status, headers: HEADERS });
    }
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "BILL_DETAIL_LINK_FAILED";
    const status = code === "TENANT_ACCESS_DENIED" ? 403 : /^PDF_|^DOCUMENT_/.test(code) ? 400 : code === "DOCUMENT_VERSION_STALE" ? 409 : 422;
    return Response.json({ error: { code, message: "Collegamento della fattura di dettaglio non riuscito." } }, { status, headers: HEADERS });
  }
}

export const maxDuration = 300;
