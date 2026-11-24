import { requestPrincipal } from "../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../lib/persistence/adapter";
import { getAnalysis, publicAnalysis } from "../../../../lib/reading/bill-analysis";
import { analysisError, ANALYSIS_HEADERS } from "../../../../lib/reading/bill-analysis-http";

export const runtime = "nodejs";

/** Tony (24/11/2026, "ANALISI BOLLETTE"): the phase the server is really in, for the user who started the analysis only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    return Response.json({ analysis: publicAnalysis(await getAnalysis(runtimeRepositories().billAnalyses, principal, id)) }, { headers: ANALYSIS_HEADERS });
  } catch (error) { return analysisError(error); }
}
