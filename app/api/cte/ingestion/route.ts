import { requestPrincipal } from "../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { CTE_MAX_DOCUMENT_BYTES, createCteIngestion, getConfiguredCteOcrProvider, toPublicCteIngestion, type CteIngestionRepository } from "../../../lib/cte/ingestion";
import { cteError, CTE_INGESTION_HEADERS } from "../../../lib/cte/ingestion-api";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const records = await (runtimeRepositories().cteArchives as CteIngestionRepository).list(principal.tenantId);
    const requestedVector = new URL(request.url).searchParams.get("vector");
    const filtered = records.filter((record) => record.payload.status !== "APPROVED" && (requestedVector === null || requestedVector === "" || record.payload.vector === requestedVector || record.payload.vector === "UNKNOWN"));
    return Response.json({ ingestions: filtered.map(toPublicCteIngestion) }, { headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return cteError(new Error("CTE_FILE_REQUIRED"));
    let provider;
    let providerErrorCode;
    try { provider = getConfiguredCteOcrProvider(); } catch (error) { provider = undefined; const code = error instanceof Error ? error.message : ""; providerErrorCode = ["CTE_OCR_PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY_MISSING", "ANTHROPIC_MODEL_MISSING", "ANTHROPIC_CTE_MAX_TOKENS_INVALID"].includes(code) ? code as "CTE_OCR_PROVIDER_NOT_CONFIGURED" | "ANTHROPIC_API_KEY_MISSING" | "ANTHROPIC_MODEL_MISSING" | "ANTHROPIC_CTE_MAX_TOKENS_INVALID" : "CTE_OCR_PROVIDER_NOT_CONFIGURED"; }
    const repositories = runtimeRepositories();
    const ingestionRepository = repositories.cteArchives as CteIngestionRepository;
    const ingestion = await createCteIngestion({
      tenantId: principal.tenantId,
      fileName: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      maxBytes: (() => { const configured = Number(process.env.CTE_MAX_DOCUMENT_BYTES ?? CTE_MAX_DOCUMENT_BYTES); return Number.isSafeInteger(configured) && configured > 0 && configured <= CTE_MAX_DOCUMENT_BYTES ? configured : CTE_MAX_DOCUMENT_BYTES; })(),
      repository: ingestionRepository,
      storage: repositories.documentStorage,
      provider,
      providerErrorCode,
      idempotencyKey: request.headers.get("x-idempotency-key") ?? undefined,
    });
    await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "CTE_DOCUMENT_UPLOAD", resourceType: "CTE_INGESTION", resourceId: ingestion.recordId, outcome: "ALLOWED", correlationId: "cte-ocr-ingestion-v1" });
    return Response.json({ ingestion: toPublicCteIngestion(ingestion) }, { status: 201, headers: CTE_INGESTION_HEADERS });
  } catch (error) { return cteError(error); }
}
