import { billOcrErrorCode, billOcrPublicError, billOcrUserMessage, billPublicError, retryEnergyBill } from "../../../../lib/ingestion";
import { createAnthropicTwoStageBillSdkAdapter } from "../../../../lib/ingestion/anthropic-bill-sdk";
// createAnthropicBillSdkAdapter remains the legacy compatibility adapter; retries use two-stage.
import { requestPrincipal } from "../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../../lib/persistence/audit";
import { toPublicDocument } from "../../../../lib/foundation/real-bill";
import { attachOfficialPun } from "../../../../lib/market/pun-reference";

const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const repositories = runtimeRepositories();
    const document = await repositories.billRepository.get(principal.tenantId, id);
    if (!document) return Response.json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Bill document not found" } }, { status: 404, headers: HEADERS });
    const result = await retryEnergyBill({ tenantId: principal.tenantId, document, storage: repositories.documentStorage, repository: repositories.billRepository, authenticated: true, structuredProviderFactory: () => createAnthropicTwoStageBillSdkAdapter(), audit: { async record(event) { await recordRuntimeAudit({ principal, action: `BILL_${event.type}`, resourceType: "BILL", resourceId: event.documentId, outcome: event.outcome === "ALLOWED" ? "ALLOWED" : "FAILED", correlationId: "foundation-bills" }); } } });
    const currentVersion = result.document.versions.find((version) => version.versionId === result.document.currentVersionId);
    const errorCode = currentVersion?.errorCode ?? result.errorCode;
    if (result.status === "FAILED") {
      const code = errorCode && billPublicError(errorCode) ? errorCode : "BILL_MAPPING_FAILED";
      const publicError = billPublicError(code)!;
      return Response.json({ error: { code: publicError.code, message: publicError.message }, document: await attachOfficialPun(toPublicDocument(result.document), repositories.marketArchiveRepository), status: result.status, errorCode: publicError.code }, { status: publicError.status, headers: HEADERS });
    }
    return Response.json({ document: await attachOfficialPun(toPublicDocument(result.document), repositories.marketArchiveRepository), status: result.status, errorCode: result.errorCode }, { headers: HEADERS });
  } catch (error) {
    const providerCode = billOcrErrorCode(error);
    const publicError = providerCode ? billOcrPublicError(providerCode) : null;
    const rawCode = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : null;
    const code = providerCode ?? (rawCode === "BILL_APPROVED_RETRY_FORBIDDEN" || rawCode === "TENANT_ACCESS_DENIED" ? rawCode : "BILL_RETRY_FAILED");
    const boundedError = billPublicError(code);
    const status = publicError?.status ?? boundedError?.status ?? (code === "BILL_APPROVED_RETRY_FORBIDDEN" ? 409 : code === "TENANT_ACCESS_DENIED" ? 403 : 422);
    const message = providerCode ? billOcrUserMessage(providerCode) : code === "BILL_APPROVED_RETRY_FORBIDDEN" ? "La bolletta approvata non può essere rielaborata." : code === "TENANT_ACCESS_DENIED" ? "Accesso al tenant negato." : "Riprova lettura non disponibile.";
    return Response.json({ error: { code, message } }, { status, headers: HEADERS });
  }
}
