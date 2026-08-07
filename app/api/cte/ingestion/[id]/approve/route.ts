import { requestPrincipal } from "../../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { approveCteArchive, createCteArchive } from "../../../../../lib/cte/archive/service";
import { approveCteIngestion, toPublicCteIngestion, type CteIngestionRepository } from "../../../../../lib/cte/ingestion";
import { cteError, CTE_INGESTION_HEADERS } from "../../../../../lib/cte/ingestion-api";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    const repositories = runtimeRepositories();
    const result = await approveCteIngestion({
      tenantId: principal.tenantId,
      ingestionId: id,
      actor: principal.userId,
      repository: repositories.cteArchives as CteIngestionRepository,
      archive: {
        create: (input) => createCteArchive(repositories.cteArchiveRepository, input),
        approve: (tenantId, archiveId, versionId, actor, decisionId) => approveCteArchive(repositories.cteArchiveRepository, tenantId, archiveId, versionId, actor, decisionId),
      },
    });
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: result.alreadyApproved ? "CTE_INGESTION_APPROVAL_IDEMPOTENT" : "CTE_INGESTION_APPROVAL", resourceType: "CTE_INGESTION", resourceId: id, outcome: "ALLOWED", correlationId: "cte-ocr-ingestion-v1" });
    return Response.json({ ingestion: toPublicCteIngestion(result.record), approval: result.alreadyApproved ? "already-approved" : "approved" }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}
