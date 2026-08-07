import { requestPrincipal } from "../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { deleteCteIngestion, toPublicCteIngestion, type CteIngestionRepository } from "../../../../lib/cte/ingestion";
import { cteError, CTE_INGESTION_HEADERS } from "../../../../lib/cte/ingestion-api";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const { id } = await context.params;
    const ingestion = await (runtimeRepositories().cteArchives as CteIngestionRepository).get(principal.tenantId, id);
    if (!ingestion) throw new Error("CTE_INGESTION_NOT_FOUND");
    return Response.json({ ingestion: toPublicCteIngestion(ingestion) }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    const repositories = runtimeRepositories();
    await deleteCteIngestion({ tenantId: principal.tenantId, ingestionId: id, repository: repositories.cteArchives as CteIngestionRepository, storage: repositories.documentStorage });
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "CTE_INGESTION_DELETION", resourceType: "CTE_INGESTION", resourceId: id, outcome: "ALLOWED", correlationId: "cte-ocr-ingestion-v1" });
    return Response.json({ deleted: true }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}
