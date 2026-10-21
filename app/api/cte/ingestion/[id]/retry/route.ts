import { requestPrincipal } from "../../../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { getConfiguredCteOcrProvider, retryCteIngestion, toPublicCteIngestion, type CteIngestionRepository, type CteOcrProvider, type CteProviderConfigurationError } from "../../../../../lib/cte/ingestion";
import { cteError, CTE_INGESTION_HEADERS } from "../../../../../lib/cte/ingestion-api";
import { isRetryableAutomationError } from "../../../../../lib/automation/retry";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { readonly params: Promise<{ readonly id: string }> };

function providerConfigurationCode(error: unknown): CteProviderConfigurationError {
  const code = error instanceof Error ? error.message : "CTE_OCR_PROVIDER_NOT_CONFIGURED";
  return ["CTE_OCR_PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY_MISSING", "ANTHROPIC_MODEL_MISSING", "ANTHROPIC_CTE_MAX_TOKENS_INVALID", "ANTHROPIC_CTE_TIMEOUT_INVALID"].includes(code)
    ? code as CteProviderConfigurationError
    : "CTE_OCR_PROVIDER_NOT_CONFIGURED";
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const { id } = await context.params;
    const repositories = runtimeRepositories();
    let provider: CteOcrProvider | undefined;
    let providerErrorCode: CteProviderConfigurationError | undefined;
    try { provider = getConfiguredCteOcrProvider(); } catch (error) { providerErrorCode = providerConfigurationCode(error); }
    // Transient provider failures get up to three attempts; the last outcome is returned as is, so the
    // review screen shows the real error code instead of a generic retry-exhausted failure.
    const attempt = () => retryCteIngestion({ tenantId: principal.tenantId, ingestionId: id, repository: repositories.cteArchives as CteIngestionRepository, storage: repositories.documentStorage, provider, providerErrorCode });
    let result = await attempt();
    for (let tries = 1; tries < 3 && result.payload.status === "FAILED" && isRetryableAutomationError(new Error(result.payload.errorCode ?? "")); tries += 1) {
      try { result = await attempt(); } catch (error) { console.error("CTE retry attempt failed", error instanceof Error ? `${error.name}: ${error.message}` : typeof error); break; }
    }
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "CTE_OCR_RETRY", resourceType: "CTE_INGESTION", resourceId: id, outcome: result.payload.status === "REVIEW_REQUIRED" ? "ALLOWED" : "FAILED", correlationId: "cte-ocr-ingestion-v1", metadata: { status: result.payload.status, errorCode: result.payload.errorCode } });
    return Response.json({ ingestion: toPublicCteIngestion(result) }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) {
    console.error("CTE retry failed", error instanceof Error ? `${error.name}: ${error.message}` : typeof error);
    return cteError(error);
  }
}
