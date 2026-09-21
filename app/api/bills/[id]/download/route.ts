import { requestPrincipal } from "../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { getBillInScope } from "../../../../lib/foundation/bill-visibility";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const { id } = await context.params;
    const repositories = runtimeRepositories();
    const document = await getBillInScope(principal, repositories, id);
    if (!document) return Response.json({ error: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    const bytes = await repositories.documentStorage.read(principal.tenantId, document.id);
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${id}.pdf"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DOCUMENT_DOWNLOAD_FAILED";
    if (code === "AUTHENTICATION_REQUIRED" || code === "AUTHENTICATION_INVALID") return Response.json({ error: code }, { status: 401 });
    if (code === "TENANT_MISMATCH" || code === "AUTHORIZATION_DENIED" || code === "DOCUMENT_STORAGE_TENANT_MISMATCH") return Response.json({ error: "DOCUMENT_ACCESS_DENIED" }, { status: 403 });
    if (code === "DOCUMENT_NOT_FOUND" || code === "DOCUMENT_STORAGE_NOT_FOUND") return Response.json({ error: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    return Response.json({ error: "DOCUMENT_DOWNLOAD_UNAVAILABLE" }, { status: 503 });
  }
}
