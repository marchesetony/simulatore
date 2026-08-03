import { jsonBody } from "../../lib/archive/api";
import { requestPrincipal } from "../../lib/auth/request";
import { calculationError } from "../../lib/calculation/api";
import { parseSimulationRequest } from "../../lib/calculation/input";
import { compareApprovedOffers } from "../../lib/comparison/service";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const body = await jsonBody(request);
    const simulation = parseSimulationRequest(body.simulation ?? body, tenantId);
    const result = await compareApprovedOffers(repositories.cteArchiveRepository, repositories.marketArchiveRepository, simulation);
    await repositories.comparisonResults.put({ tenantId, recordId: result.comparisonId, payload: { comparisonId: result.comparisonId, fingerprint: result.fingerprint, result }, idempotencyKey: result.fingerprint });
    await recordRuntimeAudit({ principal, action: "COMPARISON", resourceType: "COMPARISON", resourceId: result.comparisonId, outcome: "ALLOWED", correlationId: "comparison-v1", metadata: { fingerprint: result.fingerprint } });
    return Response.json({ result });
  } catch (error) { return calculationError(error); }
}
