import { archiveError, localTenant } from "../../../../lib/archive/api";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { requestPrincipal } from "../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../lib/persistence/audit";
import { deleteCteArchive } from "../../../../lib/cte/archive/service";
import { toPublicCteApprovedArchiveDetail } from "../../../../lib/cte/archive/service";
import { type CteIngestionRepository } from "../../../../lib/cte/ingestion";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { legacyCteApprovedSnapshot } from "../../../../lib/cte/approved-snapshot.ts";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const tenantId = await localTenant(request, "READ");
    const repository = runtimeRepositories().cteArchiveRepository;
    const { id } = await context.params;
    const record = await repository.get(tenantId, id);
    if (!record) throw new Error("CTE_ARCHIVE_NOT_FOUND");
    if (new URL(request.url).searchParams.get("view") === "approved") {
      const repositories = runtimeRepositories();
      const ingestion = (await (repositories.cteArchives as CteIngestionRepository).list(tenantId)).find((item) => item.payload.status === "APPROVED" && item.payload.approvedArchiveId === id);
      const approved = record.currentApprovedVersionId ? record.versions.find((version) => version.versionId === record.currentApprovedVersionId && version.status === "APPROVED") : null;
      const snapshot = ingestion?.payload.approvedSnapshot ?? (ingestion && approved ? legacyCteApprovedSnapshot({ record: ingestion.payload, tenantId, contract: approved.contract }) : undefined);
      const detail = toPublicCteApprovedArchiveDetail(record, snapshot);
      if (!detail) throw new Error("CTE_ARCHIVE_NOT_FOUND");
      return Response.json({ record: detail }, { headers: { "cache-control": "no-store, private" } });
    }
    return Response.json({ record });
  } catch (error) { return archiveError(error); }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    const record = await deleteCteArchive(runtimeRepositories().cteArchiveRepository, principal.tenantId, id, principal.userId);
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "CTE_COMMERCIAL_DELETE", resourceType: "CTE_ARCHIVE", resourceId: id, outcome: "ALLOWED", correlationId: "cte-commercial-lifecycle-v1", metadata: { commercialStatus: record.commercialStatus ?? "ACTIVE" } });
    return Response.json({ deleted: true, record });
  } catch (error) { return archiveError(error); }
}
