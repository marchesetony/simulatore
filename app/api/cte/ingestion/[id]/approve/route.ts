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
        // A previous attempt may have created the archive record and then stopped: reuse it instead of failing as a duplicate.
        create: async (input) => {
          try { return await createCteArchive(repositories.cteArchiveRepository, input); } catch (error) {
            const existing = error instanceof Error && error.message === "CTE_ARCHIVE_ALREADY_EXISTS" ? await repositories.cteArchiveRepository.get(input.tenantId, input.contract.cteId) : null;
            if (existing && !existing.deletedAt) return existing;
            throw error;
          }
        },
        approve: async (tenantId, archiveId, versionId, actor, decisionId, audit) => {
          const existing = await repositories.cteArchiveRepository.get(tenantId, archiveId);
          if (existing?.currentApprovedVersionId === versionId) return existing;
          return approveCteArchive(repositories.cteArchiveRepository, tenantId, archiveId, versionId, actor, decisionId, undefined, audit);
        },
      },
      approvalAudit: async (event) => { await recordRuntimeAudit({ tenantId: event.tenantId, principal, action: "CTE_STATUS_CHANGE", resourceType: "CTE_ARCHIVE", resourceId: event.archiveId, outcome: "ALLOWED", correlationId: "cte-ocr-ingestion-v1", metadata: { cteId: event.cteId, versionId: event.versionId, previousState: event.previousState, newState: event.newState, actor: event.actor, timestamp: event.timestamp } }); },
    });
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: result.alreadyApproved ? "CTE_INGESTION_APPROVAL_IDEMPOTENT" : "CTE_INGESTION_APPROVAL", resourceType: "CTE_INGESTION", resourceId: id, outcome: "ALLOWED", correlationId: "cte-ocr-ingestion-v1" });
    return Response.json({ ingestion: toPublicCteIngestion(result.record), approval: result.alreadyApproved ? "already-approved" : "approved" }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}
