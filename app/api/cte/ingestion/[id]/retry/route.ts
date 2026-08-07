import { requestPrincipal } from "../../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { getConfiguredCteOcrProvider, retryCteIngestion, toPublicCteIngestion, type CteIngestionRepository, type CteProviderConfigurationError } from "../../../../../lib/cte/ingestion";
import { cteError, CTE_INGESTION_HEADERS } from "../../../../../lib/cte/ingestion-api";

export const runtime = "nodejs";
type Context = { readonly params: Promise<{ readonly id: string }> };

function providerConfigurationCode(error: unknown): CteProviderConfigurationError {
  const code = error instanceof Error ? error.message : "CTE_OCR_PROVIDER_NOT_CONFIGURED";
  return ["CTE_OCR_PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY_MISSING", "ANTHROPIC_MODEL_MISSING", "ANTHROPIC_CTE_MAX_TOKENS_INVALID"].includes(code)
    ? code as CteProviderConfigurationError
    : "CTE_OCR_PROVIDER_NOT_CONFIGURED";
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    const repositories = runtimeRepositories();
    let provider;
    let providerErrorCode: CteProviderConfigurationError | undefined;
    try { provider = getConfiguredCteOcrProvider(); } catch (error) { providerErrorCode = providerConfigurationCode(error); }
    const result = await retryCteIngestion({ tenantId: principal.tenantId, ingestionId: id, repository: repositories.cteArchives as CteIngestionRepository, storage: repositories.documentStorage, provider, providerErrorCode });
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "CTE_OCR_RETRY", resourceType: "CTE_INGESTION", resourceId: id, outcome: result.payload.status === "REVIEW_REQUIRED" ? "ALLOWED" : "FAILED", correlationId: "cte-ocr-ingestion-v1", metadata: { status: result.payload.status, errorCode: result.payload.errorCode } });
    return Response.json({ ingestion: toPublicCteIngestion(result) }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}
