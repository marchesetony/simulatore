import { requestPrincipal } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../../../lib/persistence/audit";
import { publicAnalysis, requestCancel } from "../../../../../lib/reading/bill-analysis";
import { analysisError, ANALYSIS_HEADERS } from "../../../../../lib/reading/bill-analysis-http";

export const runtime = "nodejs";

/** Tony (24/11/2026, "ANALISI BOLLETTE"): "Interrompi analisi". The running upload sees the stop at its next phase. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const record = await requestCancel(runtimeRepositories().billAnalyses, principal, id);
    await recordRuntimeAudit({ principal, action: "BILL_ANALYSIS_STOP_REQUESTED", resourceType: "BILL_ANALYSIS", resourceId: record.analysisId, outcome: "ALLOWED", correlationId: "bill-analysis", metadata: { state: record.state } });
    return Response.json({ analysis: publicAnalysis(record) }, { headers: ANALYSIS_HEADERS });
  } catch (error) { return analysisError(error); }
}
