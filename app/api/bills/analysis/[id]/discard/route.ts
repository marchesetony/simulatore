import { requestPrincipal } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { getBillInScope } from "../../../../../lib/foundation/bill-visibility";
import { analysisBillDiscardable } from "../../../../../lib/reading/bill-analysis-discard";
import { deleteArchivedBill } from "../../../../../lib/foundation/bill-archive";
import { getAnalysis, markDiscarded, publicAnalysis } from "../../../../../lib/reading/bill-analysis";
import { analysisError, ANALYSIS_HEADERS } from "../../../../../lib/reading/bill-analysis-http";

export const runtime = "nodejs";

/**
 * Tony (24/11/2026, "ANALISI BOLLETTE"): "Annulla" once the reading is shown. It removes only the bill this same analysis
 * created, for the user who started it, while that bill is exactly as read: never approved, never corrected, with no
 * simulation, proposal or customer link (analysisBillDiscardable). Any other bill is deleted from the archive as before, with its own permissions.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const repositories = runtimeRepositories();
    const record = await getAnalysis(repositories.billAnalyses, principal, id);
    if (record.state !== "COMPLETED" || !record.billId) throw new Error("BILL_ANALYSIS_NOT_DISCARDABLE");
    const document = await getBillInScope(principal, repositories, record.billId);
    if (!document) throw new Error("BILL_ANALYSIS_NOT_DISCARDABLE");
    if (!(await analysisBillDiscardable(repositories, principal.tenantId, document))) throw new Error("BILL_ANALYSIS_NOT_DISCARDABLE");
    await deleteArchivedBill(principal, repositories, document, "bill-analysis-discard");
    return Response.json({ analysis: publicAnalysis(await markDiscarded(repositories.billAnalyses, principal.tenantId, record.analysisId)) }, { headers: ANALYSIS_HEADERS });
  } catch (error) { return analysisError(error); }
}
