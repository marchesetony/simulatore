import { requestPrincipal } from "../../../../../lib/auth/request";
import { jsonBody } from "../../../../../lib/archive/api";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { confirmCteIngestion, correctCteIngestion, toPublicCteIngestion, type CteIngestionRepository } from "../../../../../lib/cte/ingestion";
import { cteError, CTE_INGESTION_HEADERS } from "../../../../../lib/cte/ingestion-api";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    const body = await jsonBody(request);
    if (typeof body.fieldPath !== "string") throw new Error("CTE_CORRECTION_VALUE_INVALID");
    const repository = runtimeRepositories().cteArchives as CteIngestionRepository;
    const result = body.action === "confirm"
      ? await confirmCteIngestion({ tenantId: principal.tenantId, ingestionId: id, fieldPath: body.fieldPath, actor: principal.userId, repository })
      : typeof body.value === "string"
        ? await correctCteIngestion({ tenantId: principal.tenantId, ingestionId: id, fieldPath: body.fieldPath, value: body.value, actor: principal.userId, repository })
        : (() => { throw new Error("CTE_CORRECTION_VALUE_INVALID"); })();
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: body.action === "confirm" ? "CTE_REVIEW_CONFIRMATION" : "CTE_REVIEW_CORRECTION", resourceType: "CTE_INGESTION", resourceId: id, outcome: "ALLOWED", correlationId: "cte-ocr-ingestion-v1" });
    return Response.json({ ingestion: toPublicCteIngestion(result) }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}
